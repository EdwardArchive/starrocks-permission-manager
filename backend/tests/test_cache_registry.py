"""The self-registering cache factory: register, unique names, clear-everything.

These tests exercise the registry through its own probe caches (unique names) so
they don't depend on which of the 11 real app caches happen to be registered.
The point being verified is structural: clear_all_caches() wipes every cache the
factory created, including ones registered after import — with no per-cache
hardcoding in cache.py.
"""
from __future__ import annotations

import pytest
from app.utils import cache as cache_mod
from app.utils.cache import clear_all_caches, make_ttl_cache


def test_make_ttl_cache_registers_and_returns_a_working_cache():
    c = make_ttl_cache("test_registry.basic", maxsize=8, ttl=60)

    # Registered under its name…
    assert cache_mod._CACHE_REGISTRY["test_registry.basic"] is c
    # …and behaves like a normal TTLCache.
    c["k"] = "v"
    assert c["k"] == "v"


def test_duplicate_name_asserts():
    make_ttl_cache("test_registry.dup", maxsize=1, ttl=60)
    with pytest.raises(AssertionError):
        make_ttl_cache("test_registry.dup", maxsize=1, ttl=60)


def test_clear_all_caches_empties_every_registered_cache():
    a = make_ttl_cache("test_registry.clear_a", maxsize=8, ttl=60)
    b = make_ttl_cache("test_registry.clear_b", maxsize=8, ttl=60)
    a["x"] = 1
    b["y"] = 2
    assert len(a) == 1 and len(b) == 1

    clear_all_caches()

    assert len(a) == 0 and len(b) == 0


def test_cache_registered_after_import_is_still_cleared():
    """The whole point: a cache created late — not hardcoded anywhere — is cleared too."""
    late = make_ttl_cache("test_registry.late", maxsize=4, ttl=60)
    late["fresh"] = object()
    assert len(late) == 1

    clear_all_caches()

    assert len(late) == 0
