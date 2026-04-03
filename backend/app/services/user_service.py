"""Shared helpers for user/role discovery from StarRocks system tables."""
from __future__ import annotations

import threading

from cachetools import TTLCache

from app.config import settings
from app.services.starrocks_client import execute_query

# ── TTL cache for users ──
_user_cache: TTLCache = TTLCache(maxsize=1, ttl=settings.cache_ttl_seconds)
_user_cache_lock = threading.Lock()


def get_all_users(conn) -> set[str]:
    """Collect all known users from role_edges and grants_to_users.

    Returns a set of unique user names gathered from:
    - ``sys.role_edges`` (TO_USER column)
    - ``sys.grants_to_users`` (GRANTEE column, as supplementary source)
    """
    cache_key = "all_users"
    with _user_cache_lock:
        if cache_key in _user_cache:
            return _user_cache[cache_key]

    users: set[str] = set()

    # Primary: users from role_edges
    try:
        rows = execute_query(conn, "SELECT DISTINCT TO_USER FROM sys.role_edges WHERE TO_USER IS NOT NULL AND TO_USER != ''")
        for r in rows:
            u = r.get("TO_USER") or r.get("to_user") or ""
            if u:
                users.add(u)
    except Exception:
        pass

    # Supplement: users from grants_to_users (role_edges may be incomplete)
    try:
        grant_user_rows = execute_query(
            conn, "SELECT DISTINCT GRANTEE FROM sys.grants_to_users"
        )
        for r in grant_user_rows:
            u = r.get("GRANTEE") or r.get("grantee") or ""
            if u:
                users.add(u)
    except Exception:
        pass

    with _user_cache_lock:
        _user_cache[cache_key] = users

    return users
