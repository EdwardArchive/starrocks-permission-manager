"""Router for /api/user/roles/* endpoints.

Non-admin role endpoints using only SHOW GRANTS (no sys.* tables).
"""

from __future__ import annotations

import logging
import threading

from cachetools import TTLCache
from fastapi import APIRouter, Depends

from app.config import settings
from fastapi import Query

from app.dependencies import get_credentials, get_db
from app.models.schemas import DAGEdge, DAGGraph, DAGNode, RoleItem
from app.services.shared.constants import BUILTIN_ROLES
from app.utils.role_helpers import collect_all_roles_via_grants, get_parent_roles, get_user_roles, parse_role_assignments

router = APIRouter()
logger = logging.getLogger(__name__)

# ── TTL cache for roles (keyed by username) ──
_role_cache: TTLCache = TTLCache(maxsize=64, ttl=settings.cache_ttl_seconds)
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
    nodes: list[DAGNode] = []
    edges: list[DAGEdge] = []
    node_ids: set[str] = set()
    edge_idx = 0

    def add_node(nid: str, label: str, ntype: str, color: str, highlight: bool = False):
        if nid not in node_ids:
            nodes.append(DAGNode(id=nid, label=label, type=ntype, color=color, metadata={"highlight": highlight}))
            node_ids.add(nid)

    def add_edge(src: str, tgt: str, etype: str):
        nonlocal edge_idx
        edges.append(DAGEdge(id=f"e{edge_idx}", source=src, target=tgt, edge_type=etype))
        edge_idx += 1

    if type == "user":
        add_node(f"u_{name}", name, "user", "#0ea5e9", highlight=True)
        direct_roles = get_user_roles(conn, name)
        if not direct_roles:
            direct_roles = ["public"]
        for role in direct_roles:
            color = "#ef4444" if role == "root" else "#6366f1" if role in BUILTIN_ROLES else "#f97316"
            add_node(f"r_{role}", role, "role", color)
            add_edge(f"r_{role}", f"u_{name}", "assignment")
        # BFS upward only
        queue = list(direct_roles)
        visited: set[str] = set(direct_roles)
        while queue:
            current = queue.pop(0)
            parents = get_parent_roles(conn, current)
            for p in parents:
                if p not in visited:
                    visited.add(p)
                    queue.append(p)
                color = "#ef4444" if p == "root" else "#6366f1" if p in BUILTIN_ROLES else "#f97316"
                add_node(f"r_{p}", p, "role", color)
                add_edge(f"r_{p}", f"r_{current}", "inheritance")
    else:
        add_node(
            f"r_{name}", name, "role",
            "#ef4444" if name == "root" else "#6366f1" if name in BUILTIN_ROLES else "#f97316",
            highlight=True,
        )
        # BFS upward only (no downward — requires sys.role_edges)
        queue = [name]
        visited_up: set[str] = {name}
        while queue:
            current = queue.pop(0)
            parents = get_parent_roles(conn, current)
            for p in parents:
                if p not in visited_up:
                    visited_up.add(p)
                    queue.append(p)
                color = "#ef4444" if p == "root" else "#6366f1" if p in BUILTIN_ROLES else "#f97316"
                add_node(f"r_{p}", p, "role", color)
                add_edge(f"r_{p}", f"r_{current}", "inheritance")

    return DAGGraph(nodes=nodes, edges=edges)


def _build_role_hierarchy_from_grants(conn, username: str) -> DAGGraph:
    """Build role hierarchy DAG for non-admin using only SHOW GRANTS."""
    nodes: list[DAGNode] = []
    edges: list[DAGEdge] = []
    node_ids: set[str] = set()
    edge_idx = 0

    def add_node(nid: str, label: str, ntype: str, color: str):
        if nid not in node_ids:
            nodes.append(DAGNode(id=nid, label=label, type=ntype, color=color))
            node_ids.add(nid)

    def add_edge(src: str, tgt: str, etype: str):
        nonlocal edge_idx
        edges.append(DAGEdge(id=f"e{edge_idx}", source=src, target=tgt, edge_type=etype))
        edge_idx += 1

    # User node
    add_node(f"u_{username}", username, "user", "#0ea5e9")

    # BFS through role chain
    direct_roles = parse_role_assignments(conn, username, "USER")
    for role in direct_roles:
        color = "#ef4444" if role == "root" else "#6366f1" if role in BUILTIN_ROLES else "#f97316"
        add_node(f"r_{role}", role, "role", color)
        add_edge(f"r_{role}", f"u_{username}", "assignment")

    visited: set[str] = set()
    queue = list(direct_roles)
    while queue and len(visited) < 100:
        role = queue.pop(0)
        if role in visited:
            continue
        visited.add(role)
        parent_roles = parse_role_assignments(conn, role, "ROLE")
        for parent in parent_roles:
            if parent not in visited:
                queue.append(parent)
            color = "#ef4444" if parent == "root" else "#6366f1" if parent in BUILTIN_ROLES else "#f97316"
            add_node(f"r_{parent}", parent, "role", color)
            add_edge(f"r_{parent}", f"r_{role}", "inheritance")

    return DAGGraph(nodes=nodes, edges=edges)
