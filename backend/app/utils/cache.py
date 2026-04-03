"""Central cache clearing utility."""

from __future__ import annotations


def clear_all_caches() -> None:
    """Clear all server-side TTL caches (DAG, roles, users)."""
    from app.routers.dag import _dag_cache
    from app.routers.roles import _role_cache, _role_cache_lock
    from app.services.user_service import _user_cache, _user_cache_lock

    _dag_cache.clear()
    with _role_cache_lock:
        _role_cache.clear()
    with _user_cache_lock:
        _user_cache.clear()
