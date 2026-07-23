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
from app.services.shared.constants import BUILTIN_ROLES
from app.services.shared.dag_builder import DAGBuilder
from app.services.shared.role_dag import add_role_ancestry, build_role_hierarchy_from_grants, role_category
from app.utils.cache import make_ttl_cache
from app.utils.role_helpers import (
    collect_all_roles_via_grants,
    get_parent_roles,
    get_user_roles,
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

    result = build_role_hierarchy_from_grants(conn, username)

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
