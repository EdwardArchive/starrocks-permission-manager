"""for_object resolves inherited users from the in-memory user_role_map,
without a per-user DB query (no N+1 over org users)."""

from __future__ import annotations

import pytest

import app.services.admin.bfs_resolver as bfs
from app.models.schemas import PrivilegeGrant
from app.services.common.grant_classifier import ObjectQuery
from app.services.common.grant_resolver import GrantResolver
from app.services.grant_collector import CollectedGrants


def test_invert_child_map():
    parents = bfs.invert_child_map({"root": ["db_admin", "user_admin"], "db_admin": ["analyst_role"]})
    assert parents == {"db_admin": ["root"], "user_admin": ["root"], "analyst_role": ["db_admin"]}
    assert bfs.invert_child_map({}) == {}


def _role_grant() -> PrivilegeGrant:
    return PrivilegeGrant(
        grantee="analyst_role",
        grantee_type="ROLE",
        object_catalog="default_catalog",
        object_database="analytics_db",
        object_name="user_events",
        object_type="TABLE",
        privilege_type="SELECT",
    )


def test_for_object_resolves_inherited_user_in_memory(monkeypatch):
    # Fail loudly if the resolver falls back to a per-user query.
    def _boom(*a, **k):
        raise AssertionError("get_user_roles called — N+1 not eliminated")

    monkeypatch.setattr(bfs, "get_user_roles", _boom)

    collected = CollectedGrants(
        grants=[_role_grant()],
        all_users={"analyst_kim", "someone_else", "ghost"},
        role_child_map={},  # analyst_role has no children
        user_role_map={"analyst_kim": ["analyst_role", "public"], "someone_else": ["public"]},
    )
    q = ObjectQuery(catalog="default_catalog", database="analytics_db", name="user_events", object_type="TABLE")

    # conn=None on purpose: in-memory maps must carry the whole resolution.
    result = GrantResolver(collected, conn=None).for_object(q)

    users = {g.grantee for g in result if g.grantee_type == "USER"}
    assert "analyst_kim" in users  # inherits SELECT via analyst_role
    assert "someone_else" not in users  # only has 'public', which has no grant here
    assert "ghost" not in users  # not in user_role_map → no roles → resolves to nothing
    kim = next(g for g in result if g.grantee == "analyst_kim")
    assert kim.privilege_type == "SELECT"
    assert kim.source == "analyst_role"


def test_for_object_without_maps_uses_conn_fallback(monkeypatch):
    # No user_role_map → resolver must use get_user_roles (conn path) as before.
    calls = []
    monkeypatch.setattr(bfs, "get_user_roles", lambda conn, user: calls.append(user) or ["analyst_role"])

    collected = CollectedGrants(
        grants=[_role_grant()],
        all_users={"analyst_kim"},
        role_child_map={},
        user_role_map={},  # empty → fallback
    )
    q = ObjectQuery(catalog="default_catalog", database="analytics_db", name="user_events", object_type="TABLE")
    result = GrantResolver(collected, conn=object()).for_object(q)

    assert calls == ["analyst_kim"]  # fell back to per-user query
    assert "analyst_kim" in {g.grantee for g in result if g.grantee_type == "USER"}
