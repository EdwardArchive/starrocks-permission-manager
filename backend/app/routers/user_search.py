"""Router for /api/user/search/* endpoints.

Non-admin search using only INFORMATION_SCHEMA + SHOW commands (no sys.* tables).
"""

from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, Query

from app.dependencies import get_credentials, get_db
from app.services.common.catalog_search import search_all_catalogs
from app.services.shared.row_utils import col
from app.services.starrocks_client import execute_query, parallel_queries
from app.utils.cache import make_ttl_cache
from app.utils.role_helpers import collect_all_roles_via_grants

router = APIRouter()
logger = logging.getLogger("search")

# Track catalogs that failed (connection timeout etc.) — skip for 5 min
_failed_catalogs = make_ttl_cache("user_search.failed_catalogs", maxsize=64, ttl=300)


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
            name = col(r, "Catalog") or ""
            if name:
                catalogs.append(name)
    except Exception as e:
        logger.warning(f"SHOW CATALOGS failed: {e}")

    # 2. Search catalog objects (tables/views/databases) via the shared engine.
    results.extend(
        search_all_catalogs(
            conn,
            catalogs,
            keyword,
            limit,
            credentials=credentials,
            failed_catalogs=_failed_catalogs,
            parallel_fn=parallel_queries,
        )
    )

    # 3. Merge tail: dedup by path + limit across roles (added first) and objects
    seen = set()
    unique = []
    for r in results:
        if r["path"] not in seen:
            seen.add(r["path"])
            unique.append(r)
        if len(unique) >= limit:
            break

    return unique
