from __future__ import annotations

import logging
import threading

from cachetools import TTLCache
from fastapi import APIRouter, Depends

from app.config import settings
from app.dependencies import get_credentials, get_db
from app.models.schemas import DAGEdge, DAGGraph, DAGNode, RoleItem
from app.services.starrocks_client import execute_query
from app.services.user_service import get_all_users
from app.utils.role_helpers import collect_all_roles_via_grants, parse_role_assignments

router = APIRouter()
logger = logging.getLogger(__name__)

BUILTIN_ROLES = {"root", "db_admin", "user_admin", "cluster_admin", "security_admin", "public"}

# ── TTL cache for roles ──
_role_cache: TTLCache = TTLCache(maxsize=1, ttl=settings.cache_ttl_seconds)
_role_cache_lock = threading.Lock()


@router.get("", response_model=list[RoleItem])
def list_roles(conn=Depends(get_db), credentials: dict = Depends(get_credentials)):
    is_admin = credentials.get("is_admin", False)
    cache_key = f"roles_{is_admin}"
    with _role_cache_lock:
        if cache_key in _role_cache:
            return _role_cache[cache_key]
    if is_admin:
        rows = execute_query(conn, "SHOW ROLES")
        result = []
        for r in rows:
            name = r.get("Name") or r.get("name") or ""
            result.append(RoleItem(name=name, is_builtin=name in BUILTIN_ROLES))
    else:
        # Non-admin: return only the user's own roles via SHOW GRANTS recursive
        result = []
        username = credentials["username"]
        visited = collect_all_roles_via_grants(conn, username)
        for name in sorted(visited):
            result.append(RoleItem(name=name, is_builtin=name in BUILTIN_ROLES))
    with _role_cache_lock:
        _role_cache[cache_key] = result
    return result


@router.get("/hierarchy", response_model=DAGGraph)
def get_role_hierarchy(conn=Depends(get_db), credentials: dict = Depends(get_credentials)):
    """Build role hierarchy DAG. Admin: full graph. Non-admin: own role chain."""
    if not credentials.get("is_admin", False):
        return _build_role_hierarchy_from_grants(conn, credentials["username"])

    # ── Admin path: full graph from sys.role_edges ──
    roles_rows = execute_query(conn, "SHOW ROLES")
    roles = []
    for r in roles_rows:
        name = r.get("Name") or r.get("name") or ""
        if name:
            roles.append(name)

    edges_data = []
    try:
        edge_rows = execute_query(conn, "SELECT * FROM sys.role_edges")
        for e in edge_rows:
            parent = e.get("FROM_ROLE") or e.get("PARENT_ROLE_NAME") or ""
            child = e.get("TO_ROLE") or e.get("ROLE_NAME") or ""
            user = e.get("TO_USER") or e.get("USER_NAME") or ""
            if parent and (child or user):
                edges_data.append({"parent": parent, "child": child, "user": user})
    except Exception:
        logger.debug("Failed to query sys.role_edges for role hierarchy")

    all_users = get_all_users(conn)
    for e in edges_data:
        if e["user"]:
            all_users.add(e["user"])

    user_roles: dict[str, set[str]] = {}
    for e in edges_data:
        if e["user"]:
            user_roles.setdefault(e["user"], set()).add(e["parent"])

    nodes = []
    node_ids = set()
    for role in roles:
        nid = f"r_{role}"
        color = "#ef4444" if role == "root" else "#6366f1" if role in BUILTIN_ROLES else "#f97316"
        nodes.append(DAGNode(id=nid, label=role, type="role", color=color))
        node_ids.add(nid)

    for u in all_users:
        uid = f"u_{u}"
        if uid not in node_ids:
            nodes.append(DAGNode(id=uid, label=u, type="user", color="#0ea5e9"))
            node_ids.add(uid)

    dag_edges = []
    edge_idx = 0
    for e in edges_data:
        if e["parent"] and e["child"]:
            dag_edges.append(
                DAGEdge(id=f"e{edge_idx}", source=f"r_{e['parent']}", target=f"r_{e['child']}", edge_type="inheritance")
            )
            edge_idx += 1

    added_user_edges: set[tuple[str, str]] = set()
    for e in edges_data:
        if e["user"] and e["parent"]:
            key = (e["parent"], e["user"])
            if key not in added_user_edges:
                dag_edges.append(
                    DAGEdge(
                        id=f"e{edge_idx}", source=f"r_{e['parent']}", target=f"u_{e['user']}", edge_type="assignment"
                    )
                )
                added_user_edges.add(key)
                edge_idx += 1

    for u in all_users:
        if u not in user_roles and "public" in roles:
            key = ("public", u)
            if key not in added_user_edges:
                dag_edges.append(DAGEdge(id=f"e{edge_idx}", source="r_public", target=f"u_{u}", edge_type="assignment"))
                added_user_edges.add(key)
                edge_idx += 1

    return DAGGraph(nodes=nodes, edges=dag_edges)


@router.get("/inheritance-dag", response_model=DAGGraph)
def get_inheritance_dag(name: str = "", type: str = "user", conn=Depends(get_db)):
    """Build a focused inheritance DAG for a specific user or role.
    Shows only the selected entity and its role inheritance chain upward."""
    from app.utils.role_helpers import get_user_roles, get_parent_roles

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
        eid = f"e{edge_idx}"
        edges.append(DAGEdge(id=eid, source=src, target=tgt, edge_type=etype))
        edge_idx += 1

    if type == "user":
        # Add user node
        add_node(f"u_{name}", name, "user", "#0ea5e9", highlight=True)

        # Get directly assigned roles
        direct_roles = get_user_roles(conn, name)
        if not direct_roles:
            # fallback: all users have public
            direct_roles = ["public"]

        for role in direct_roles:
            color = "#ef4444" if role == "root" else "#6366f1" if role in BUILTIN_ROLES else "#f97316"
            add_node(f"r_{role}", role, "role", color)
            add_edge(f"r_{role}", f"u_{name}", "assignment")

        # BFS upward through role hierarchy
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
        # Role: show selected role + parent chain + child roles + assigned users
        add_node(
            f"r_{name}",
            name,
            "role",
            "#ef4444" if name == "root" else "#6366f1" if name in BUILTIN_ROLES else "#f97316",
            highlight=True,
        )

        # BFS upward
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

        # BFS downward: child roles + users (recursive)
        down_queue = [name]
        down_visited: set[str] = set()
        while down_queue:
            current_role = down_queue.pop(0)
            if current_role in down_visited:
                continue
            down_visited.add(current_role)
            try:
                rows = execute_query(
                    conn,
                    "SELECT TO_ROLE, TO_USER FROM sys.role_edges WHERE FROM_ROLE = %s",
                    (current_role,),
                )
                for r in rows:
                    child = r.get("TO_ROLE") or ""
                    user = r.get("TO_USER") or ""
                    if child and child not in down_visited:
                        color = "#ef4444" if child == "root" else "#6366f1" if child in BUILTIN_ROLES else "#f97316"
                        add_node(f"r_{child}", child, "role", color)
                        add_edge(f"r_{current_role}", f"r_{child}", "inheritance")
                        down_queue.append(child)
                    if user:
                        add_node(f"u_{user}", user, "user", "#0ea5e9")
                        add_edge(f"r_{current_role}", f"u_{user}", "assignment")
            except Exception:
                logger.debug("Failed to query children for role %s", current_role)

    return DAGGraph(nodes=nodes, edges=edges)


@router.get("/{role_name}/users", response_model=list[str])
def get_role_users(role_name: str, conn=Depends(get_db)):
    users = []
    try:
        rows = execute_query(
            conn,
            "SELECT TO_USER FROM sys.role_edges WHERE FROM_ROLE = %s AND TO_USER IS NOT NULL AND TO_USER != ''",
            (role_name,),
        )
        for r in rows:
            u = r.get("TO_USER") or r.get("USER_NAME") or r.get("user_name")
            if u:
                users.append(u)
    except Exception:
        logger.debug("Failed to query users for role %s", role_name)
    return users


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
