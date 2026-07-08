"""Central TTL cache factory + registry.

Every server-side TTL cache is created via :func:`make_ttl_cache`, which registers
it in a module-level registry. :func:`clear_all_caches` then wipes every cache by
iterating that registry — so adding a new cache is just another ``make_ttl_cache``
call, with no edit to this file (previously each cache had to be imported and
cleared here by hand).
"""

from __future__ import annotations

from cachetools import TTLCache

# name → cache. Names are unique (asserted at registration) so the registry
# doubles as a human-readable map of every cache in the app.
_CACHE_REGISTRY: dict[str, TTLCache] = {}


def make_ttl_cache(name: str, maxsize: int, ttl: float) -> TTLCache:
    """Create a :class:`~cachetools.TTLCache`, register it under ``name``, and return it.

    Registration is what lets :func:`clear_all_caches` wipe every cache without
    importing each one. ``name`` must be unique — a duplicate is almost always a
    copy-paste bug, so it trips an assertion rather than silently shadowing.
    """
    assert name not in _CACHE_REGISTRY, f"duplicate cache name: {name!r}"
    cache: TTLCache = TTLCache(maxsize=maxsize, ttl=ttl)
    _CACHE_REGISTRY[name] = cache
    return cache


def clear_all_caches() -> None:
    """Clear every registered server-side TTL cache (DAG, roles, users, cluster, …)."""
    for cache in _CACHE_REGISTRY.values():
        cache.clear()
