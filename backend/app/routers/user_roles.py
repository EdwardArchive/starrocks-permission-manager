"""Router for /api/user/roles/* endpoints.

Non-admin role endpoints using only SHOW GRANTS (no sys.* tables).
"""

from __future__ import annotations

import logging
import threading

from fastapi import APIRouter, Depends, Query

from app.config import settings
from app.dependencies import get_credentials, get_db
from app.models.schemas import DAGGraph, RoleItem
from app.services.shared.constants import BFS_MAX_DEPTH, BUILTIN_ROLES
from app.services.shared.dag_builder import DAGBuilder
from app.services.shared.role_dag import add_role_ancestry, role_category
from app.utils.cache import make_ttl_cache
from app.utils.role_helpers import (
    collect_all_roles_via_grants,
    get_parent_roles,
    get_user_roles,
    parse_role_assignments,
)

router = APIRouter()
logger = logging.getLogger(__name__)

# ── TTL cache for roles (keyed by username) ──
_role_cache = make_ttl_cache("user_roles.roles", maxsize=64, ttl=settings.cache_ttl_seconds)
_role_cache_lock = threading.Lock()


@router.get("", response_model=list[RoleItem])
def list_roles(conn=Depends(get_db), credentials: dict = Depends(get_credentials)):
    """List roles visible to the current user via SHOW GRANTS recursive traversal."""
    username = credentials["username"]
    cache_key = f"user_roles_{username}"
    with _role_cache_lock:
        if cache_key in _role_cache:
            return _role_cache[cache_key]

    visited = collect_all_roles_via_grants(conn, username)
    result = []
    for name in sorted(visited):
        result.append(RoleItem(name=name, is_builtin=name in BUILTIN_ROLES))

    with _role_cache_lock:
        _role_cache[cache_key] = result
    return result


@router.get("/hierarchy", response_model=DAGGraph)
def get_role_hierarchy(conn=Depends(get_db), credentials: dict = Depends(get_credentials)):
    """Build role hierarchy DAG for the current user using only SHOW GRANTS."""
    username = credentials["username"]
    cache_key = f"user_role_hier_{username}"
    with _role_cache_lock:
        if cache_key in _role_cache:
            return _role_cache[cache_key]

    result = _build_role_hierarchy_from_grants(conn, username)

    with _role_cache_lock:
        _role_cache[cache_key] = result
    return result


@router.get("/inheritance-dag", response_model=DAGGraph)
def get_inheritance_dag(name: str = Query(""), type: str = Query("user"), conn=Depends(get_db)):
    """Build a focused inheritance DAG for a user or role (upward BFS only, no sys.role_edges)."""
    dag = DAGBuilder()

    def meta(role: str) -> dict:
        return {"highlight": False, "role_category": role_category(role)}

    if type == "user":
        dag.add_node(f"u_{name}", name, "user", metadata={"highlight": True})
        direct_roles = get_user_roles(conn, name)
        if not direct_roles:
            direct_roles = ["public"]
        for role in direct_roles:
            dag.add_node(f"r_{role}", role, "role", metadata=meta(role))
            dag.add_edge(f"r_{role}", f"u_{name}", "assignment")
        add_role_ancestry(dag, direct_roles, lambda r: get_parent_roles(conn, r), meta)
    else:
        dag.add_node(f"r_{name}", name, "role", metadata={"highlight": True, "role_category": role_category(name)})
        # BFS upward only (no downward — requires sys.role_edges)
        add_role_ancestry(dag, [name], lambda r: get_parent_roles(conn, r), meta)

    return dag.build()


def _build_role_hierarchy_from_grants(conn, username: str) -> DAGGraph:
    """Build role hierarchy DAG for non-admin using only SHOW GRANTS."""
    dag = DAGBuilder()

    # User node
    dag.add_node(f"u_{username}", username, "user")

    # BFS through role chain
    direct_roles = parse_role_assignments(conn, username, "USER")
    # Every user implicitly has 'public' — SHOW GRANTS omits it but it should appear in the DAG
    if "public" not in direct_roles:
        direct_roles = [*direct_roles, "public"]
    for role in direct_roles:
        dag.add_node(f"r_{role}", role, "role", metadata={"role_category": role_category(role)})
        dag.add_edge(f"r_{role}", f"u_{username}", "assignment")

    visited: set[str] = set()
    queue = list(direct_roles)
    while queue and len(visited) < BFS_MAX_DEPTH:
        role = queue.pop(0)
        if role in visited:
            continue
        visited.add(role)
        parent_roles = parse_role_assignments(conn, role, "ROLE")
        for parent in parent_roles:
            if parent not in visited:
                queue.append(parent)
            dag.add_node(f"r_{parent}", parent, "role", metadata={"role_category": role_category(parent)})
            dag.add_edge(f"r_{parent}", f"r_{role}", "inheritance")

    return dag.build()
