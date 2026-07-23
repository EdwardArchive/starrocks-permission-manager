"""Object-hierarchy DAG builder (Layer 1: SHOW + INFORMATION_SCHEMA only).

Single implementation shared by ``/api/user/dag/object-hierarchy`` and
``/api/admin/dag/object-hierarchy`` — the two routers were 91.5% identical and
now delegate here, keeping only their per-tier cache and auth. Uses no sys.*
tables, so it lives in the Common tier and both routers may import it.
"""

from __future__ import annotations

import logging

from app.models.schemas import DAGGraph
from app.services import starrocks_client
from app.services.shared.dag_builder import DAGBuilder
from app.services.shared.name_utils import normalize_fn_name
from app.services.shared.row_utils import col
from app.services.starrocks_client import execute_query
from app.utils.sql_safety import safe_identifier, set_catalog

logger = logging.getLogger(__name__)


def build_object_hierarchy(conn, credentials: dict, catalog: str, depth: str) -> DAGGraph:
    """Build the object-hierarchy DAG using only SHOW + INFORMATION_SCHEMA.

    ``catalog`` filters to a single catalog; ``depth`` is ``"shallow"`` (catalogs
    + DBs only) or ``"full"`` (also enumerate tables/views/MVs/functions).
    ``credentials`` drives the parallel per-DB SHOW FUNCTIONS fan-out.
    """
    builder = DAGBuilder()

    def _add(nid, label, ntype, catalog=None, database=None, node_role=None):
        meta = {}
        if catalog:
            meta["catalog"] = catalog
        if database:
            meta["database"] = database
        builder.add_node(nid, label, ntype, metadata=meta or None, node_role=node_role, dedup=False)

    def _edge(src, tgt, etype="hierarchy"):
        builder.add_edge(src, tgt, etype)

    # Roles are already activated by the pooled connection reset (get_db).

    # SYSTEM node
    _add("sys", "SYSTEM", "system")

    # Catalogs
    cat_rows = execute_query(conn, "SHOW CATALOGS")
    catalogs = []
    for r in cat_rows:
        name = col(r, "Catalog") or ""
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
            set_catalog(conn, cat)
            db_rows = execute_query(conn, "SHOW DATABASES")
        except Exception:
            logger.debug("Failed to list databases for catalog %s", cat)
            continue

        _SKIP_DBS = {"information_schema", "_statistics_", "sys"}
        for dr in db_rows:
            db = col(dr, "Database") or ""
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
                set_catalog(conn, cat_name)
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

            # Group by DB -> type
            db_objects: dict[str, dict[str, list[str]]] = {}
            for o in all_tables:
                schema = col(o, "TABLE_SCHEMA") or ""
                if schema not in db_names:
                    continue
                name = col(o, "TABLE_NAME") or ""
                ttype = col(o, "TABLE_TYPE") or ""
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
                    set_catalog(c, cat_n)
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
            fn_results = starrocks_client.parallel_queries(credentials, fn_tasks)
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

    return builder.build()
