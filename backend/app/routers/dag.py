from __future__ import annotations

import logging

from cachetools import TTLCache
from fastapi import APIRouter, Depends, Query

from app.config import settings
from app.dependencies import get_credentials, get_db
from app.models.schemas import DAGEdge, DAGGraph, DAGNode
from app.services.starrocks_client import execute_query, parallel_queries
from app.services.user_service import get_all_users
from app.utils.sql_safety import safe_identifier

router = APIRouter()
logger = logging.getLogger(__name__)

# Server-side TTL cache for DAG results
_dag_cache: TTLCache = TTLCache(maxsize=64, ttl=settings.cache_ttl_seconds)

NODE_COLORS = {
    "system": "#6b7280",
    "catalog": "#3b82f6",
    "database": "#22c55e",
    "table": "#6366f1",
    "view": "#a855f7",
    "mv": "#f59e0b",
    "function": "#14b8a6",
    "user": "#0ea5e9",
    "role": "#f97316",
}

PRIV_EDGE_TYPES = {
    "SELECT": "select",
    "INSERT": "insert",
    "DELETE": "delete",
    "ALTER": "alter",
    "DROP": "drop",
    "UPDATE": "update",
    "USAGE": "usage",
    "ALL": "select",
}


@router.get("/object-hierarchy", response_model=DAGGraph)
def get_object_hierarchy(
    catalog: str = Query("default_catalog", description="Catalog to load (default: default_catalog)"),
    depth: str = Query("full", description="'shallow' = catalogs+DBs only, 'full' = include objects"),
    conn=Depends(get_db),
    credentials: dict = Depends(get_credentials),
):
    # Check cache
    cache_key = f"obj_hier_{catalog}_{depth}"
    if cache_key in _dag_cache:
        return _dag_cache[cache_key]

    nodes = []
    edges = []
    edge_idx = [0]

    def _add(nid, label, ntype, catalog=None, database=None, **kw):
        meta = {}
        if catalog:
            meta["catalog"] = catalog
        if database:
            meta["database"] = database
        nodes.append(
            DAGNode(id=nid, label=label, type=ntype, color=NODE_COLORS.get(ntype), metadata=meta or None, **kw)
        )

    def _edge(src, tgt, etype="hierarchy"):
        edges.append(DAGEdge(id=f"e{edge_idx[0]}", source=src, target=tgt, edge_type=etype))
        edge_idx[0] += 1

    # SYSTEM node
    _add("sys", "SYSTEM", "system")

    # Catalogs
    cat_rows = execute_query(conn, "SHOW CATALOGS")
    catalogs = []
    for r in cat_rows:
        name = r.get("Catalog") or r.get("catalog") or ""
        if catalog and name != catalog:
            continue
        catalogs.append(name)
        cid = f"c_{name}"
        _add(cid, name, "catalog", catalog=name)
        _edge("sys", cid)

    # Databases per catalog
    db_list: list[tuple[str, str]] = []  # (catalog, db)
    for cat in catalogs:
        try:
            execute_query(conn, f"SET CATALOG `{cat}`")
            db_rows = execute_query(conn, "SHOW DATABASES")
        except Exception:
            logger.debug("Failed to list databases for catalog %s", cat)
            continue

        _SKIP_DBS = {"information_schema", "_statistics_", "sys"}
        for dr in db_rows:
            db = dr.get("Database") or dr.get("database") or ""
            if db in _SKIP_DBS:
                continue
            did = f"d_{cat}_{db}"
            _add(did, db, "database", catalog=cat, database=db)
            _edge(f"c_{cat}", did)
            if depth != "shallow":
                db_list.append((cat, db))

    # Bulk object loading: single query per catalog instead of per-DB
    if db_list:
        _SKIP_SCHEMAS = {"information_schema", "_statistics_", "sys"}
        db_set_per_cat: dict[str, set[str]] = {}
        for cat_name, db_name in db_list:
            db_set_per_cat.setdefault(cat_name, set()).add(db_name)

        for cat_name, db_names in db_set_per_cat.items():
            try:
                execute_query(conn, f"SET CATALOG `{cat_name}`")
            except Exception:
                logger.debug("Failed to set catalog %s for object loading", cat_name)
                continue

            # All tables/views in one query
            all_tables = execute_query(
                conn,
                "SELECT TABLE_SCHEMA, TABLE_NAME, TABLE_TYPE "
                "FROM information_schema.tables "
                "WHERE TABLE_TYPE != 'SYSTEM VIEW' "
                "AND TABLE_SCHEMA NOT IN ('information_schema', '_statistics_', 'sys')",
            )

            # All MVs in one query
            all_mvs: set[tuple[str, str]] = set()
            try:
                mv_rows = execute_query(
                    conn, "SELECT TABLE_SCHEMA, TABLE_NAME FROM information_schema.materialized_views"
                )
                all_mvs = {(r.get("TABLE_SCHEMA") or "", r.get("TABLE_NAME") or "") for r in mv_rows}
            except Exception:
                logger.debug("Failed to query materialized views for catalog %s", cat_name)

            # Group by DB → type
            db_objects: dict[str, dict[str, list[str]]] = {}
            for o in all_tables:
                schema = o.get("TABLE_SCHEMA") or o.get("table_schema") or ""
                if schema not in db_names:
                    continue
                name = o.get("TABLE_NAME") or o.get("table_name") or ""
                ttype = o.get("TABLE_TYPE") or o.get("table_type") or ""
                groups = db_objects.setdefault(schema, {"table": [], "view": [], "mv": [], "function": []})
                if (schema, name) in all_mvs:
                    groups["mv"].append(name)
                elif "VIEW" in ttype.upper():
                    groups["view"].append(name)
                else:
                    groups["table"].append(name)

            # Functions: per-DB query, run in parallel
            def _make_fn_task(cat_n: str, db_n: str):
                def fn(c):
                    execute_query(c, f"SET CATALOG `{safe_identifier(cat_n)}`")
                    fn_rows = execute_query(c, f"SHOW FUNCTIONS FROM `{safe_identifier(db_n)}`")
                    fns = []
                    for fr in fn_rows:
                        sig = fr.get("Signature") or fr.get("signature") or ""
                        if "(" in sig:
                            sig = sig.split("(")[0]
                        fns.append(sig)
                    return fns

                return fn

            fn_tasks = [(db_n, _make_fn_task(cat_name, db_n)) for db_n in db_names]
            fn_results = parallel_queries(credentials, fn_tasks)
            for db_name, fns in fn_results.items():
                if fns:
                    db_objects.setdefault(db_name, {"table": [], "view": [], "mv": [], "function": []})["function"] = (
                        fns
                    )

            # Build nodes/edges
            for db_name in db_names:
                if db_name not in db_objects:
                    continue
                did = f"d_{cat_name}_{db_name}"
                obj_data = db_objects[db_name]
                type_map = {
                    "table": ("Tables", obj_data.get("table", [])),
                    "view": ("Views", obj_data.get("view", [])),
                    "mv": ("MVs", obj_data.get("mv", [])),
                    "function": ("Functions", obj_data.get("function", [])),
                }
                for obj_type, (group_label, items) in type_map.items():
                    if not items:
                        continue
                    gid = f"g_{cat_name}_{db_name}_{obj_type}"
                    _add(
                        gid,
                        f"{group_label} ({len(items)})",
                        obj_type,
                        catalog=cat_name,
                        database=db_name,
                        node_role="group",
                    )
                    _edge(did, gid)
                    for item_name in items:
                        oid = f"o_{cat_name}_{db_name}_{item_name}"
                        _add(oid, item_name, obj_type, catalog=cat_name, database=db_name)
                        _edge(gid, oid)

    result = DAGGraph(nodes=nodes, edges=edges)
    _dag_cache[cache_key] = result
    return result


@router.get("/role-hierarchy", response_model=DAGGraph)
def get_role_hierarchy(conn=Depends(get_db)):
    cache_key = "role_hier"
    if cache_key in _dag_cache:
        return _dag_cache[cache_key]
    from app.routers.roles import get_role_hierarchy as _get

    result = _get(conn=conn)
    _dag_cache[cache_key] = result
    return result


@router.get("/full", response_model=DAGGraph)
def get_full_graph(catalog: str = Query(None), conn=Depends(get_db)):
    """Combined: users → roles → objects with privilege edges."""
    cache_key = f"full_{catalog}"
    if cache_key in _dag_cache:
        return _dag_cache[cache_key]
    nodes = []
    edges = []
    node_ids = set()
    edge_idx = [0]

    def _add(nid, label, ntype, **kw):
        if nid not in node_ids:
            nodes.append(DAGNode(id=nid, label=label, type=ntype, color=NODE_COLORS.get(ntype), **kw))
            node_ids.add(nid)

    def _edge(src, tgt, etype):
        if src in node_ids and tgt in node_ids:
            edges.append(DAGEdge(id=f"e{edge_idx[0]}", source=src, target=tgt, edge_type=etype))
            edge_idx[0] += 1

    # 1. Get all users and roles from role_edges + grants_to_users
    try:
        role_rows = execute_query(conn, "SELECT * FROM sys.role_edges")
    except Exception:
        role_rows = []

    roles_set = set()
    users_set = set()
    user_roles_map: dict[str, set[str]] = {}
    for r in role_rows:
        parent = r.get("FROM_ROLE") or r.get("PARENT_ROLE_NAME") or ""
        child = r.get("TO_ROLE") or r.get("ROLE_NAME") or ""
        user = r.get("TO_USER") or r.get("USER_NAME") or ""
        if parent:
            roles_set.add(parent)
        if child:
            roles_set.add(child)
        if user:
            users_set.add(user)
            user_roles_map.setdefault(user, set()).add(parent)

    # Supplement users from grants_to_users via shared service
    users_set.update(get_all_users(conn))

    for u in users_set:
        _add(f"u_{u}", u, "user")
    for r in roles_set:
        _add(f"r_{r}", r, "role")

    # Role→Role edges
    for r in role_rows:
        parent = r.get("FROM_ROLE") or r.get("PARENT_ROLE_NAME") or ""
        child = r.get("TO_ROLE") or r.get("ROLE_NAME") or ""
        user = r.get("TO_USER") or r.get("USER_NAME") or ""
        if user and parent:
            _edge(f"r_{parent}", f"u_{user}", "assignment")
        elif parent and child:
            _edge(f"r_{parent}", f"r_{child}", "inheritance")

    # Users not in role_edges → connect to public
    all_roles_rows = execute_query(conn, "SHOW ROLES") if True else []
    all_role_names = {r.get("Name") or r.get("name") or "" for r in all_roles_rows}
    if "public" in all_role_names:
        _add("r_public", "public", "role")
        for u in users_set:
            if u not in user_roles_map:
                _edge("r_public", f"u_{u}", "assignment")

    # 2. Get privilege grants → create object nodes + privilege edges
    for table in ("sys.grants_to_users", "sys.grants_to_roles"):
        try:
            grant_rows = execute_query(conn, f"SELECT * FROM {table}")
        except Exception:
            logger.debug("Failed to query grants from %s", table)
            continue

        for g in grant_rows:
            grantee = g.get("GRANTEE") or g.get("grantee") or ""
            obj_cat = g.get("OBJECT_CATALOG") or g.get("object_catalog") or ""
            obj_db = g.get("OBJECT_DATABASE") or g.get("object_database") or ""
            obj_name = g.get("OBJECT_NAME") or g.get("object_name") or ""
            obj_type = (g.get("OBJECT_TYPE") or g.get("object_type") or "").upper()
            priv = (g.get("PRIVILEGE_TYPE") or g.get("privilege_type") or "").upper()

            if catalog and obj_cat and obj_cat != catalog:
                continue

            # Map object type to node type
            type_map = {
                "TABLE": "table",
                "VIEW": "view",
                "MATERIALIZED VIEW": "mv",
                "DATABASE": "database",
                "CATALOG": "catalog",
                "FUNCTION": "function",
                "SYSTEM": "system",
                "RESOURCE GROUP": "system",
                "RESOURCE": "system",
                "USER": "user",
                "STORAGE VOLUME": "system",
                "GLOBAL FUNCTION": "function",
            }
            ntype = type_map.get(obj_type, "system")

            # Create object node
            label = obj_name or obj_db or obj_cat or obj_type
            # Build unique ID avoiding empty segments
            parts = [p for p in [obj_cat, obj_db, obj_name] if p]
            oid = f"o_{'_'.join(parts)}" if parts else f"o_{obj_type}"
            _add(oid, label, ntype)

            # Ensure grantee node exists (may not be in role_edges)
            grantee_prefix = "u_" if "grants_to_users" in table else "r_"
            grantee_id = f"{grantee_prefix}{grantee}"
            if grantee_id not in node_ids:
                gtype = "user" if "grants_to_users" in table else "role"
                _add(grantee_id, grantee, gtype)

            # Privilege edge
            edge_type = PRIV_EDGE_TYPES.get(priv, "select")
            _edge(grantee_id, oid, edge_type)

    result = DAGGraph(nodes=nodes, edges=edges)
    _dag_cache[cache_key] = result
    return result
