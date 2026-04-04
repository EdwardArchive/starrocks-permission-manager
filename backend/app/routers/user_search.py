"""Router for /api/user/search/* endpoints.

Non-admin search using only INFORMATION_SCHEMA + SHOW commands (no sys.* tables).
"""

from __future__ import annotations

import logging
import time

from cachetools import TTLCache
from fastapi import APIRouter, Depends, Query

from app.dependencies import get_credentials, get_db
from app.services.starrocks_client import execute_query, parallel_queries
from app.utils.role_helpers import collect_all_roles_via_grants

router = APIRouter()
logger = logging.getLogger("search")

# Track catalogs that failed (connection timeout etc.) — skip for 5 min
_failed_catalogs: TTLCache = TTLCache(maxsize=64, ttl=300)


@router.get("")
def search(
    q: str = Query(..., min_length=1, description="Search keyword"),
    limit: int = Query(50, ge=1, le=200),
    conn=Depends(get_db),
    credentials: dict = Depends(get_credentials),
):
    """
    Search across all catalogs: tables, views, databases, roles.
    Uses only INFORMATION_SCHEMA + SHOW commands (no sys.* tables).
    Roles are filtered to only the current user's own roles via SHOW GRANTS.
    """
    username = credentials["username"]
    keyword = f"%{q}%"
    results = []

    # 0. Search user's own roles (via SHOW GRANTS recursive traversal)
    try:
        user_roles = collect_all_roles_via_grants(conn, username)
        for name in sorted(user_roles):
            if q.lower() in name.lower():
                results.append({"name": name, "type": "role", "catalog": "", "database": "", "path": f"role:{name}"})
    except Exception:
        logger.debug("Failed to collect roles for user %s", username)

    # 1. Get catalog list
    catalogs = []
    try:
        cat_rows = execute_query(conn, "SHOW CATALOGS")
        for r in cat_rows:
            name = r.get("Catalog") or r.get("catalog") or ""
            if name:
                catalogs.append(name)
    except Exception as e:
        logger.warning(f"SHOW CATALOGS failed: {e}")

    # 2. Helper: search one catalog using INFORMATION_SCHEMA
    def _search_catalog(c, cat: str, kw: str, lim: int) -> list[dict]:
        cat_results = []
        execute_query(c, f"SET CATALOG `{cat}`")
        # Search tables and views
        try:
            rows = execute_query(
                c,
                "SELECT TABLE_SCHEMA, TABLE_NAME, TABLE_TYPE "
                "FROM information_schema.tables "
                "WHERE (TABLE_NAME LIKE %s OR TABLE_SCHEMA LIKE %s) "
                "AND TABLE_TYPE != 'SYSTEM VIEW' "
                "ORDER BY TABLE_NAME LIMIT %s",
                (kw, kw, lim),
            )
            for r in rows:
                db = r.get("TABLE_SCHEMA") or r.get("table_schema") or ""
                name = r.get("TABLE_NAME") or r.get("table_name") or ""
                ttype = (r.get("TABLE_TYPE") or r.get("table_type") or "").upper()
                obj_type = "view" if "VIEW" in ttype else "table"
                cat_results.append(
                    {"name": name, "type": obj_type, "catalog": cat, "database": db, "path": f"{cat}.{db}.{name}"}
                )
        except Exception:
            logger.debug("Failed to search tables in catalog %s", cat)
        # Search databases
        try:
            rows = execute_query(
                c,
                "SELECT SCHEMA_NAME FROM information_schema.schemata "
                "WHERE SCHEMA_NAME LIKE %s AND SCHEMA_NAME != 'information_schema' "
                "ORDER BY SCHEMA_NAME LIMIT %s",
                (kw, lim),
            )
            for r in rows:
                name = r.get("SCHEMA_NAME") or r.get("schema_name") or ""
                cat_results.append(
                    {"name": name, "type": "database", "catalog": cat, "database": "", "path": f"{cat}.{name}"}
                )
        except Exception:
            logger.debug("Failed to search databases in catalog %s", cat)
        return cat_results

    # 3. Search default_catalog first on main connection (fast, no extra connection)
    if "default_catalog" in catalogs:
        try:
            results.extend(_search_catalog(conn, "default_catalog", keyword, limit))
        except Exception:
            logger.debug("Failed to search default_catalog")
        # Restore for subsequent queries
        try:
            execute_query(conn, "SET CATALOG `default_catalog`")
        except Exception:
            logger.debug("Failed to restore catalog context to default_catalog")

    # 4. Search remaining catalogs in parallel (skip failed ones)
    other_cats = [c for c in catalogs if c != "default_catalog" and c not in _failed_catalogs]
    if other_cats:

        def _make_search_fn(cat: str, kw: str, lim: int):
            def fn(c):
                t = time.monotonic()
                try:
                    return _search_catalog(c, cat, kw, lim)
                except Exception:
                    # Mark as failed if it took too long
                    if time.monotonic() - t > 3:
                        _failed_catalogs[cat] = True
                    return []

            return fn

        tasks = [(cat, _make_search_fn(cat, keyword, limit)) for cat in other_cats]
        cat_results = parallel_queries(credentials, tasks, timeout=3.0)
        for cat in other_cats:
            if cat in cat_results:
                results.extend(cat_results[cat])
            else:
                # Timed out — blacklist for 5 min
                _failed_catalogs[cat] = True

    # Deduplicate by path and limit
    seen = set()
    unique = []
    for r in results:
        if r["path"] not in seen:
            seen.add(r["path"])
            unique.append(r)
        if len(unique) >= limit:
            break

    return unique
