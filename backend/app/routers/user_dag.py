"""Router for /api/user/dag/* endpoints.

Non-admin DAG endpoints using only SHOW + INFORMATION_SCHEMA (no sys.* tables).
"""

from __future__ import annotations

import logging

from cachetools import TTLCache
from fastapi import APIRouter, Depends, Query

from app.config import settings
from app.dependencies import get_credentials, get_db
from app.models.schemas import DAGEdge, DAGGraph, DAGNode
from app.services.shared.name_utils import normalize_fn_name
from app.services.starrocks_client import execute_query, parallel_queries
from app.utils.sql_safety import safe_identifier

router = APIRouter()
logger = logging.getLogger(__name__)

# Server-side TTL cache for DAG results
_dag_cache: TTLCache = TTLCache(maxsize=64, ttl=settings.cache_ttl_seconds)

@router.get("/object-hierarchy", response_model=DAGGraph)
def get_object_hierarchy(
    catalog: str = Query("default_catalog", description="Catalog to load (default: default_catalog)"),
    depth: str = Query("full", description="'shallow' = catalogs+DBs only, 'full' = include objects"),
    conn=Depends(get_db),
    credentials: dict = Depends(get_credentials),
):
    """Build object hierarchy DAG using only SHOW + INFORMATION_SCHEMA."""
    username = credentials["username"]
    cache_key = f"user_obj_hier_{username}_{catalog}_{depth}"
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
            DAGNode(id=nid, label=label, type=ntype, color=None, metadata=meta or None, **kw)
        )

    def _edge(src, tgt, etype="hierarchy"):
        edges.append(DAGEdge(id=f"e{edge_idx[0]}", source=src, target=tgt, edge_type=etype))
        edge_idx[0] += 1

    # Activate all roles so information_schema shows all accessible objects
    try:
        execute_query(conn, "SET ROLE ALL")
    except Exception:
        logger.debug("Failed to SET ROLE ALL")

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
                        sig = fr.get("Signature") or fr.get("signature") or fr.get("Function Name") or ""
                        sig = normalize_fn_name(sig)
                        if sig and sig not in fns:
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
def get_role_hierarchy(conn=Depends(get_db), credentials: dict = Depends(get_credentials)):
    """Build role hierarchy DAG for the current user. Delegates to user_roles."""
    username = credentials["username"]
    cache_key = f"user_role_hier_dag_{username}"
    if cache_key in _dag_cache:
        return _dag_cache[cache_key]

    from app.routers.user_roles import get_role_hierarchy as _get_role_hierarchy

    result = _get_role_hierarchy(conn=conn, credentials=credentials)
    _dag_cache[cache_key] = result
    return result
