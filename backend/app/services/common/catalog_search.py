"""Layer 1 cross-catalog search engine (SHOW + INFORMATION_SCHEMA only).

Shared by ``/api/user/search`` and ``/api/admin/search``. Given a catalog list,
searches tables/views/databases in each catalog and returns object result dicts.

The per-tier bits stay in the routers: the user tier collects the caller's own
roles via SHOW GRANTS and guards its ``SHOW CATALOGS``; the admin tier searches
users/roles via ``sys.*`` and lists catalogs unguarded. Only the catalog fan-out
below — which was byte-for-byte duplicated between the two routers — lives here.

``parallel_fn`` and ``failed_catalogs`` are injected by the caller so each tier
keeps its own registered TTL blacklist and its own (test-patchable)
``parallel_queries`` reference.
"""

from __future__ import annotations

import logging
import time
from collections.abc import Callable, MutableMapping
from typing import Any

from app.services.shared.row_utils import col
from app.services.starrocks_client import execute_query
from app.utils.sql_safety import restore_default_catalog, set_catalog

logger = logging.getLogger("search")


def search_catalog(conn, cat: str, keyword: str, limit: int) -> list[dict]:
    """Search one catalog for tables/views + databases via INFORMATION_SCHEMA.

    Switches the session's active catalog on ``conn`` as a side effect, then runs
    the two searches. A failed search is swallowed (logged at debug) so one bad
    catalog does not sink the whole request.
    """
    cat_results = []
    set_catalog(conn, cat)
    # Search tables and views
    try:
        rows = execute_query(
            conn,
            "SELECT TABLE_SCHEMA, TABLE_NAME, TABLE_TYPE "
            "FROM information_schema.tables "
            "WHERE (TABLE_NAME LIKE %s OR TABLE_SCHEMA LIKE %s) "
            "AND TABLE_TYPE != 'SYSTEM VIEW' "
            "ORDER BY TABLE_NAME LIMIT %s",
            (keyword, keyword, limit),
        )
        for r in rows:
            db = col(r, "TABLE_SCHEMA") or ""
            name = col(r, "TABLE_NAME") or ""
            ttype = (col(r, "TABLE_TYPE") or "").upper()
            obj_type = "view" if "VIEW" in ttype else "table"
            cat_results.append(
                {"name": name, "type": obj_type, "catalog": cat, "database": db, "path": f"{cat}.{db}.{name}"}
            )
    except Exception:
        logger.debug("Failed to search tables in catalog %s", cat)
    # Search databases
    try:
        rows = execute_query(
            conn,
            "SELECT SCHEMA_NAME FROM information_schema.schemata "
            "WHERE SCHEMA_NAME LIKE %s AND SCHEMA_NAME != 'information_schema' "
            "ORDER BY SCHEMA_NAME LIMIT %s",
            (keyword, limit),
        )
        for r in rows:
            name = col(r, "SCHEMA_NAME") or ""
            cat_results.append(
                {"name": name, "type": "database", "catalog": cat, "database": "", "path": f"{cat}.{name}"}
            )
    except Exception:
        logger.debug("Failed to search databases in catalog %s", cat)
    return cat_results


def search_all_catalogs(
    conn,
    catalogs: list[str],
    keyword: str,
    limit: int,
    *,
    credentials: dict,
    failed_catalogs: MutableMapping[str, bool],
    parallel_fn: Callable[..., dict[str, Any]],
) -> list[dict]:
    """Search every catalog and return deduplicated, limited object results.

    ``default_catalog`` is searched first on the main connection (fast, no extra
    connection); the rest fan out in parallel via ``parallel_fn``. A catalog that
    recently failed is skipped for the TTL of ``failed_catalogs`` (the caller's
    own registered per-tier blacklist).
    """
    results = []

    # Search default_catalog first on main connection (fast, no extra connection)
    if "default_catalog" in catalogs:
        try:
            results.extend(search_catalog(conn, "default_catalog", keyword, limit))
        except Exception:
            logger.debug("Failed to search default_catalog")
        # Restore for subsequent queries
        try:
            restore_default_catalog(conn)
        except Exception:
            logger.debug("Failed to restore catalog context to default_catalog")

    # Search remaining catalogs in parallel (skip failed ones)
    other_cats = [c for c in catalogs if c != "default_catalog" and c not in failed_catalogs]
    if other_cats:

        def _make_search_fn(cat: str, kw: str, lim: int):
            def fn(c):
                t = time.monotonic()
                try:
                    return search_catalog(c, cat, kw, lim)
                except Exception:
                    # Mark as failed if it took too long
                    if time.monotonic() - t > 3:
                        failed_catalogs[cat] = True
                    return []

            return fn

        tasks = [(cat, _make_search_fn(cat, keyword, limit)) for cat in other_cats]
        cat_results = parallel_fn(credentials, tasks, timeout=3.0)
        for cat in other_cats:
            if cat in cat_results:
                results.extend(cat_results[cat])
            else:
                # Timed out — blacklist for 5 min
                failed_catalogs[cat] = True

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
