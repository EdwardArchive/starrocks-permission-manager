"""Admin Role API endpoints.

Admin-only endpoints using sys.* tables for full role hierarchy and user assignments.
"""

from __future__ import annotations

import logging
import threading

from fastapi import APIRouter, Depends, Query

from app.config import settings
from app.dependencies import get_db, require_admin
from app.models.schemas import DAGGraph, RoleItem
from app.services.admin.role_hierarchy import build_admin_role_hierarchy
from app.services.shared.constants import BUILTIN_ROLES
from app.services.shared.dag_builder import DAGBuilder
from app.services.shared.role_dag import add_role_ancestry, role_category
from app.services.shared.row_utils import col
from app.services.starrocks_client import execute_query
from app.utils.cache import make_ttl_cache
from app.utils.role_helpers import get_parent_roles, get_user_roles

logger = logging.getLogger("admin_roles")
router = APIRouter(dependencies=[Depends(require_admin)])

# ── TTL cache for admin roles ──
_role_cache = make_ttl_cache("admin_roles.roles", maxsize=4, ttl=settings.cache_ttl_seconds)
_role_cache_lock = threading.Lock()


@router.get("", response_model=list[RoleItem])
def list_roles(conn=Depends(get_db)):
    """List ALL roles via SHOW ROLES (admin only)."""
    cache_key = "admin_roles"
    with _role_cache_lock:
        if cache_key in _role_cache:
            return _role_cache[cache_key]

    rows = execute_query(conn, "SHOW ROLES")
    result = []
    for r in rows:
        name = col(r, "Name") or ""
        result.append(RoleItem(name=name, is_builtin=name in BUILTIN_ROLES))

    with _role_cache_lock:
        _role_cache[cache_key] = result
    return result


@router.get("/hierarchy", response_model=DAGGraph)
def get_role_hierarchy(conn=Depends(get_db)):
    """Build full role hierarchy DAG from sys.role_edges + SHOW ROLES (admin only)."""
    cache_key = "admin_role_hierarchy"
    with _role_cache_lock:
        if cache_key in _role_cache:
            return _role_cache[cache_key]

    result = build_admin_role_hierarchy(conn)

    with _role_cache_lock:
        _role_cache[cache_key] = result
    return result


@router.get("/inheritance-dag", response_model=DAGGraph)
def get_inheritance_dag(name: str = Query(""), type: str = Query("user"), conn=Depends(get_db)):
    """Build a focused inheritance DAG for a specific user or role (admin only).

    Shows the selected entity and its role inheritance chain upward,
    plus child roles and assigned users downward.
    """
    dag = DAGBuilder()

    def meta(role: str) -> dict:
        return {"highlight": False, "role_category": role_category(role)}

    if type == "user":
        # Add user node
        dag.add_node(f"u_{name}", name, "user", metadata={"highlight": True})

        # Get directly assigned roles
        direct_roles = get_user_roles(conn, name)
        if not direct_roles:
            direct_roles = ["public"]

        for role in direct_roles:
            dag.add_node(f"r_{role}", role, "role", metadata=meta(role))
            dag.add_edge(f"r_{role}", f"u_{name}", "assignment")

        # BFS upward through role hierarchy
        add_role_ancestry(dag, direct_roles, lambda r: get_parent_roles(conn, r), meta)
    else:
        # Role: show selected role + parent chain + child roles + assigned users
        dag.add_node(f"r_{name}", name, "role", metadata={"highlight": True, "role_category": role_category(name)})

        # BFS upward
        add_role_ancestry(dag, [name], lambda r: get_parent_roles(conn, r), meta)

        # BFS downward: child roles + users via sys.role_edges
        down_queue = [name]
        down_visited: set[str] = set()
        while down_queue:
            current_role = down_queue.pop(0)
            if current_role in down_visited:
                continue
            down_visited.add(current_role)
            rows = execute_query(
                conn,
                "SELECT TO_ROLE, TO_USER FROM sys.role_edges WHERE FROM_ROLE = %s",
                (current_role,),
            )
            for r in rows:
                child = r.get("TO_ROLE") or ""
                user = r.get("TO_USER") or ""
                if child and child not in down_visited:
                    dag.add_node(f"r_{child}", child, "role", metadata=meta(child))
                    dag.add_edge(f"r_{current_role}", f"r_{child}", "inheritance")
                    down_queue.append(child)
                if user:
                    dag.add_node(f"u_{user}", user, "user", metadata={"highlight": False})
                    dag.add_edge(f"r_{current_role}", f"u_{user}", "assignment")

    return dag.build()


@router.get("/{role_name}/users", response_model=list[str])
def get_role_users(role_name: str, conn=Depends(get_db)):
    """Get users assigned to a role from sys.role_edges (admin only)."""
    rows = execute_query(
        conn,
        "SELECT TO_USER FROM sys.role_edges WHERE FROM_ROLE = %s AND TO_USER IS NOT NULL AND TO_USER != ''",
        (role_name,),
    )
    users = []
    for r in rows:
        u = r.get("TO_USER") or r.get("USER_NAME") or r.get("user_name")
        if u:
            users.append(u)
    return users
