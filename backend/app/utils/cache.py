"""Central cache clearing utility."""

from __future__ import annotations


def clear_all_caches() -> None:
    """Clear all server-side TTL caches (DAG, roles, users)."""
    from app.routers.admin_dag import _dag_cache as admin_dag_cache
    from app.routers.admin_roles import _role_cache as admin_role_cache, _role_cache_lock as admin_role_lock
    from app.routers.user_dag import _dag_cache as user_dag_cache
    from app.routers.user_objects import _catalog_cache, _catalog_cache_lock
    from app.routers.user_roles import _role_cache as user_role_cache, _role_cache_lock as user_role_lock
    from app.services.admin.user_service import _user_cache, _user_cache_lock

    admin_dag_cache.clear()
    user_dag_cache.clear()
    with _catalog_cache_lock:
        _catalog_cache.clear()
    with admin_role_lock:
        admin_role_cache.clear()
    with user_role_lock:
        user_role_cache.clear()
    with _user_cache_lock:
        _user_cache.clear()
