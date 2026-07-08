"""Admin Search API endpoints.

Admin-only search using sys.* tables directly (no silent fallback).
"""

from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, Query

from app.dependencies import get_credentials, get_db, require_admin
from app.services.common.catalog_search import search_all_catalogs
from app.services.shared.row_utils import col
from app.services.starrocks_client import execute_query, parallel_queries
from app.utils.cache import make_ttl_cache

logger = logging.getLogger("admin_search")
router = APIRouter(dependencies=[Depends(require_admin)])

# Track catalogs that failed (connection timeout etc.) — skip for 5 min
_failed_catalogs = make_ttl_cache("admin_search.failed_catalogs", maxsize=64, ttl=300)


@router.get("/users-roles")
def search_users_roles(
    q: str = Query(..., min_length=1),
    limit: int = Query(50, ge=1, le=200),
    conn=Depends(get_db),
):
    """Fast search for users and roles only using sys.* tables (admin only)."""
    keyword = f"%{q}%"
    results = []
    seen_users: set[str] = set()

    # Users from sys.role_edges
    rows = execute_query(
        conn,
        "SELECT DISTINCT TO_USER FROM sys.role_edges "
        "WHERE TO_USER LIKE %s AND TO_USER IS NOT NULL AND TO_USER != '' LIMIT %s",
        (keyword, limit),
    )
    for r in rows:
        name = r.get("TO_USER") or ""
        if name and name not in seen_users:
            seen_users.add(name)
            results.append({"name": name, "type": "user", "catalog": "", "database": "", "path": f"user:{name}"})

    # Users from sys.grants_to_users
    rows = execute_query(
        conn,
        "SELECT DISTINCT GRANTEE FROM sys.grants_to_users WHERE GRANTEE LIKE %s LIMIT %s",
        (keyword, limit),
    )
    for r in rows:
        name = col(r, "GRANTEE") or ""
        if name and name not in seen_users:
            seen_users.add(name)
            results.append({"name": name, "type": "user", "catalog": "", "database": "", "path": f"user:{name}"})

    # Roles from SHOW ROLES
    rows = execute_query(conn, "SHOW ROLES")
    for r in rows:
        name = col(r, "Name") or ""
        if q.lower() in name.lower():
            results.append({"name": name, "type": "role", "catalog": "", "database": "", "path": f"role:{name}"})

    # Deduplicate
    seen = set()
    unique = []
    for r in results:
        if r["path"] not in seen:
            seen.add(r["path"])
            unique.append(r)
        if len(unique) >= limit:
            break
    return unique


@router.get("")
def search(
    q: str = Query(..., min_length=1, description="Search keyword"),
    limit: int = Query(50, ge=1, le=200),
    conn=Depends(get_db),
    credentials: dict = Depends(get_credentials),
):
    """Search across all catalogs using sys.* tables (admin only).

    Searches users, roles, tables, views, and databases.
    Uses parallel connections per catalog for speed.
    """
    keyword = f"%{q}%"
    results = []

    # 0. Search users and roles FIRST (before SET CATALOG changes context)
    seen_users: set[str] = set()

    # 0a. From role_edges
    rows = execute_query(
        conn,
        "SELECT DISTINCT TO_USER FROM sys.role_edges "
        "WHERE TO_USER LIKE %s AND TO_USER IS NOT NULL AND TO_USER != '' "
        "LIMIT %s",
        (keyword, limit),
    )
    for r in rows:
        name = r.get("TO_USER") or ""
        if name and name not in seen_users:
            seen_users.add(name)
            results.append({"name": name, "type": "user", "catalog": "", "database": "", "path": f"user:{name}"})

    # 0b. From grants_to_users
    rows = execute_query(
        conn,
        "SELECT DISTINCT GRANTEE FROM sys.grants_to_users WHERE GRANTEE LIKE %s LIMIT %s",
        (keyword, limit),
    )
    for r in rows:
        name = col(r, "GRANTEE") or ""
        if name and name not in seen_users:
            seen_users.add(name)
            results.append({"name": name, "type": "user", "catalog": "", "database": "", "path": f"user:{name}"})

    # 0c. Roles
    rows = execute_query(conn, "SHOW ROLES")
    for r in rows:
        name = col(r, "Name") or ""
        if q.lower() in name.lower():
            results.append({"name": name, "type": "role", "catalog": "", "database": "", "path": f"role:{name}"})

    # 1. Get catalog list
    catalogs = []
    cat_rows = execute_query(conn, "SHOW CATALOGS")
    for r in cat_rows:
        name = col(r, "Catalog") or ""
        if name:
            catalogs.append(name)

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

    # 3. Merge tail: dedup by path + limit across users/roles (added first) and objects
    seen = set()
    unique = []
    for r in results:
        if r["path"] not in seen:
            seen.add(r["path"])
            unique.append(r)
        if len(unique) >= limit:
            break

    return unique
