from __future__ import annotations

import logging
import threading

from cachetools import TTLCache
from fastapi import APIRouter, Depends

from app.config import settings
from app.dependencies import get_db
from app.models.schemas import DAGEdge, DAGGraph, DAGNode, RoleItem
from app.services.starrocks_client import execute_query
from app.services.user_service import get_all_users

router = APIRouter()
logger = logging.getLogger(__name__)

BUILTIN_ROLES = {"root", "db_admin", "user_admin", "cluster_admin", "security_admin", "public"}

# ── TTL cache for roles ──
_role_cache: TTLCache = TTLCache(maxsize=1, ttl=settings.cache_ttl_seconds)
_role_cache_lock = threading.Lock()


@router.get("", response_model=list[RoleItem])
def list_roles(conn=Depends(get_db)):
    cache_key = "roles"
    with _role_cache_lock:
        if cache_key in _role_cache:
            return _role_cache[cache_key]
    rows = execute_query(conn, "SHOW ROLES")
    result = []
    for r in rows:
        name = r.get("Name") or r.get("name") or ""
        result.append(RoleItem(name=name, is_builtin=name in BUILTIN_ROLES))
    with _role_cache_lock:
        _role_cache[cache_key] = result
    return result


@router.get("/hierarchy", response_model=DAGGraph)
def get_role_hierarchy(conn=Depends(get_db)):
    """Build role hierarchy DAG: root at top → built-in → custom → users."""
    # Get all roles
    roles_rows = execute_query(conn, "SHOW ROLES")
    roles = []
    for r in roles_rows:
        name = r.get("Name") or r.get("name") or ""
        if name:
            roles.append(name)

    # Get role edges from sys.role_edges
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

    # Collect all users from role_edges + grants_to_users
    all_users = get_all_users(conn)
    for e in edges_data:
        if e["user"]:
            all_users.add(e["user"])

    # Determine each user's role assignments from role_edges
    user_roles: dict[str, set[str]] = {}
    for e in edges_data:
        if e["user"]:
            user_roles.setdefault(e["user"], set()).add(e["parent"])

    # Build role nodes
    nodes = []
    node_ids = set()
    for role in roles:
        nid = f"r_{role}"
        color = "#ef4444" if role == "root" else "#6366f1" if role in BUILTIN_ROLES else "#f97316"
        nodes.append(DAGNode(id=nid, label=role, type="role", color=color))
        node_ids.add(nid)

    # Build user nodes
    for u in all_users:
        uid = f"u_{u}"
        if uid not in node_ids:
            nodes.append(DAGNode(id=uid, label=u, type="user", color="#0ea5e9"))
            node_ids.add(uid)

    # Build edges
    dag_edges = []
    edge_idx = 0
    # Role→Role inheritance from role_edges
    for e in edges_data:
        if e["parent"] and e["child"]:
            dag_edges.append(
                DAGEdge(
                    id=f"e{edge_idx}",
                    source=f"r_{e['parent']}",
                    target=f"r_{e['child']}",
                    edge_type="inheritance",
                )
            )
            edge_idx += 1

    # Role→User assignments from role_edges
    added_user_edges: set[tuple[str, str]] = set()
    for e in edges_data:
        if e["user"] and e["parent"]:
            key = (e["parent"], e["user"])
            if key not in added_user_edges:
                dag_edges.append(
                    DAGEdge(
                        id=f"e{edge_idx}",
                        source=f"r_{e['parent']}",
                        target=f"u_{e['user']}",
                        edge_type="assignment",
                    )
                )
                added_user_edges.add(key)
                edge_idx += 1

    # Users not in role_edges → connect to 'public' (all users have public role)
    for u in all_users:
        if u not in user_roles and "public" in roles:
            key = ("public", u)
            if key not in added_user_edges:
                dag_edges.append(
                    DAGEdge(
                        id=f"e{edge_idx}",
                        source="r_public",
                        target=f"u_{u}",
                        edge_type="assignment",
                    )
                )
                added_user_edges.add(key)
                edge_idx += 1

    return DAGGraph(nodes=nodes, edges=dag_edges)


@router.get("/inheritance-dag", response_model=DAGGraph)
def get_inheritance_dag(name: str = "", type: str = "user", conn=Depends(get_db)):
    """Build a focused inheritance DAG for a specific user or role.
    Shows only the selected entity and its role inheritance chain upward."""
    from app.routers.privileges import _get_user_roles, _get_parent_roles

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
        direct_roles = _get_user_roles(conn, name)
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
            parents = _get_parent_roles(conn, current)
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
            parents = _get_parent_roles(conn, current)
            for p in parents:
                if p not in visited_up:
                    visited_up.add(p)
                    queue.append(p)
                color = "#ef4444" if p == "root" else "#6366f1" if p in BUILTIN_ROLES else "#f97316"
                add_node(f"r_{p}", p, "role", color)
                add_edge(f"r_{p}", f"r_{current}", "inheritance")

        # Get child roles (roles that inherit from this role)
        try:
            rows = execute_query(
                conn,
                "SELECT TO_ROLE FROM sys.role_edges WHERE FROM_ROLE = %s AND TO_ROLE IS NOT NULL AND TO_ROLE != ''",
                (name,),
            )
            for r in rows:
                child = r.get("TO_ROLE") or r.get("ROLE_NAME") or ""
                if child:
                    color = "#ef4444" if child == "root" else "#6366f1" if child in BUILTIN_ROLES else "#f97316"
                    add_node(f"r_{child}", child, "role", color)
                    add_edge(f"r_{name}", f"r_{child}", "inheritance")
        except Exception:
            logger.debug("Failed to query child roles for role %s", name)

        # Get users assigned to this role
        try:
            rows = execute_query(
                conn,
                "SELECT TO_USER FROM sys.role_edges WHERE FROM_ROLE = %s AND TO_USER IS NOT NULL AND TO_USER != ''",
                (name,),
            )
            for r in rows:
                u = r.get("TO_USER") or ""
                if u:
                    add_node(f"u_{u}", u, "user", "#0ea5e9")
                    add_edge(f"r_{name}", f"u_{u}", "assignment")
        except Exception:
            logger.debug("Failed to query users assigned to role %s", name)

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
