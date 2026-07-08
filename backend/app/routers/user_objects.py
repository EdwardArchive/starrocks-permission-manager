"""Router for /api/user/objects/* endpoints.

Uses only INFORMATION_SCHEMA + SHOW commands (no sys.* tables).
Mirrors the existing objects.py router for non-admin access.
"""

from __future__ import annotations

import logging
import threading

from fastapi import APIRouter, Depends, Query

from app.config import settings
from app.dependencies import get_credentials, get_db
from app.models.schemas import CatalogItem, DatabaseItem, ObjectItem, TableDetail
from app.services.common.table_ddl import fetch_table_detail
from app.services.shared.name_utils import normalize_fn_name
from app.services.shared.row_utils import col
from app.services.starrocks_client import execute_query
from app.utils.cache import make_ttl_cache
from app.utils.sql_safety import safe_identifier, set_catalog

router = APIRouter()
logger = logging.getLogger(__name__)

# ── TTL cache for catalogs (keyed per user — SHOW CATALOGS is permission-filtered) ──
_catalog_cache = make_ttl_cache("user_objects.catalogs", maxsize=256, ttl=settings.cache_ttl_seconds)
_catalog_cache_lock = threading.Lock()


@router.get("/catalogs", response_model=list[CatalogItem])
def list_catalogs(credentials: dict = Depends(get_credentials), conn=Depends(get_db)):
    # SHOW CATALOGS returns only catalogs the caller can see, so the cache must
    # not be shared across users. Key by (host, username).
    cache_key = (credentials.get("host"), credentials.get("username"))
    with _catalog_cache_lock:
        if cache_key in _catalog_cache:
            return _catalog_cache[cache_key]
    rows = execute_query(conn, "SHOW CATALOGS")
    result = []
    for r in rows:
        name = col(r, "Catalog") or ""
        ctype = col(r, "Type") or "InternalCatalog"
        result.append(CatalogItem(name=name, catalog_type=ctype))
    with _catalog_cache_lock:
        _catalog_cache[cache_key] = result
    return result


@router.get("/databases", response_model=list[DatabaseItem])
def list_databases(catalog: str = Query(...), conn=Depends(get_db)):
    set_catalog(conn, catalog)
    rows = execute_query(conn, "SHOW DATABASES")
    result = []
    for r in rows:
        name = col(r, "Database") or ""
        if name == "information_schema":
            continue
        result.append(DatabaseItem(name=name, catalog=catalog))
    return result


@router.get("/tables", response_model=list[ObjectItem])
def list_tables(
    catalog: str = Query(...),
    database: str = Query(...),
    conn=Depends(get_db),
):
    set_catalog(conn, catalog)
    rows = execute_query(
        conn,
        "SELECT TABLE_NAME, TABLE_TYPE FROM information_schema.tables "
        "WHERE TABLE_SCHEMA = %s AND TABLE_TYPE != 'SYSTEM VIEW'",
        (database,),
    )
    # Also get MVs
    mvs = set()
    try:
        mv_rows = execute_query(
            conn,
            "SELECT TABLE_NAME FROM information_schema.materialized_views WHERE TABLE_SCHEMA = %s",
            (database,),
        )
        mvs = {col(r, "TABLE_NAME") for r in mv_rows}
    except Exception:
        logger.debug("Failed to query materialized views for %s.%s", catalog, database)

    result = []
    for r in rows:
        name = col(r, "TABLE_NAME") or ""
        ttype = col(r, "TABLE_TYPE") or ""
        if name in mvs:
            obj_type = "MATERIALIZED VIEW"
        elif "VIEW" in ttype.upper():
            obj_type = "VIEW"
        else:
            obj_type = "TABLE"
        result.append(ObjectItem(name=name, object_type=obj_type, catalog=catalog, database=database))

    # Functions
    try:
        fn_rows = execute_query(conn, f"SHOW FUNCTIONS FROM `{safe_identifier(database)}`")
        seen_fns: set[str] = set()
        for r in fn_rows:
            name = r.get("Signature") or r.get("signature") or r.get("Function Name") or ""
            name = normalize_fn_name(name)
            if name and name not in seen_fns:
                seen_fns.add(name)
                result.append(ObjectItem(name=name, object_type="FUNCTION", catalog=catalog, database=database))
    except Exception:
        logger.debug("Failed to list functions for %s.%s", catalog, database)

    return result


@router.get("/table-detail", response_model=TableDetail)
def get_table_detail(
    catalog: str = Query(...),
    database: str = Query(...),
    table: str = Query(...),
    conn=Depends(get_db),
):
    return fetch_table_detail(conn, catalog, database, table)
