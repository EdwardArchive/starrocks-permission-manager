"""CollectedGrants caching: served once per key, returned as independent copies."""
from __future__ import annotations

from unittest.mock import patch

from app.models.schemas import PrivilegeGrant
from app.services.grant_collector import CollectedGrants, GrantCollector, _grants_cache


def _sample() -> CollectedGrants:
    return CollectedGrants(
        grants=[
            PrivilegeGrant(
                grantee="alice",
                grantee_type="USER",
                object_type="TABLE",
                privilege_type="SELECT",
            )
        ],
        user_role_chain={"public": "public"},
    )


def test_collect_is_cached_per_key_and_returns_deep_copies():
    _grants_cache.clear()
    calls = {"n": 0}

    def fake_collect_admin(conn, username):
        calls["n"] += 1
        return _sample()

    with patch("app.services.admin.sys_collector.collect_admin", fake_collect_admin):
        c1 = GrantCollector(None, "alice", is_admin=True, host="h1").collect()
        c2 = GrantCollector(None, "alice", is_admin=True, host="h1").collect()

    assert calls["n"] == 1  # second call served from cache
    assert c1 is not c2
    assert c1.grants[0] is not c2.grants[0]  # deep copy, not a shared reference
    assert c1.grants[0].grantee == "alice"


def test_mutating_a_returned_copy_does_not_corrupt_the_cache():
    _grants_cache.clear()

    with patch("app.services.admin.sys_collector.collect_admin", lambda c, u: _sample()):
        first = GrantCollector(None, "alice", is_admin=True, host="h1").collect()
        first.grants[0].source = "mutated-by-resolver"  # mimic GrantResolver mutation
        second = GrantCollector(None, "alice", is_admin=True, host="h1").collect()

    assert second.grants[0].source == "direct"  # default, not the mutation


def test_cache_key_separates_users_and_hosts():
    _grants_cache.clear()
    calls = {"n": 0}

    def fake_collect_admin(conn, username):
        calls["n"] += 1
        return _sample()

    with patch("app.services.admin.sys_collector.collect_admin", fake_collect_admin):
        GrantCollector(None, "alice", is_admin=True, host="h1").collect()
        GrantCollector(None, "bob", is_admin=True, host="h1").collect()
        GrantCollector(None, "alice", is_admin=True, host="h2").collect()

    assert calls["n"] == 3  # three distinct keys, no false sharing
