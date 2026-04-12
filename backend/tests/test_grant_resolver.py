"""Unit tests for app.services.common.grant_resolver."""

from __future__ import annotations

from unittest.mock import patch

from app.models.schemas import PrivilegeGrant
from app.services.common.grant_classifier import ObjectQuery
from app.services.common.grant_resolver import GrantResolver
from app.services.grant_collector import CollectedGrants
from tests.conftest import FakeConnection


# ── Helpers ──


def _grant(**kw) -> PrivilegeGrant:
    defaults = dict(
        grantee="u",
        grantee_type="USER",
        object_catalog=None,
        object_database=None,
        object_name=None,
        object_type="TABLE",
        privilege_type="SELECT",
        is_grantable=False,
        source="direct",
    )
    return PrivilegeGrant(**{**defaults, **kw})


def _collected(grants, role_chain=None, role_child_map=None, all_users=None):
    return CollectedGrants(
        grants=grants,
        user_role_chain=role_chain or {},
        role_child_map=role_child_map or {},
        all_users=all_users or set(),
    )


# ── for_user tests ──


def test_for_user_filters_by_username():
    """for_user: filters by username."""
    g1 = _grant(grantee="alice", privilege_type="SELECT")
    g2 = _grant(grantee="bob", privilege_type="INSERT")
    g3 = _grant(grantee="alice", privilege_type="DELETE")
    c = _collected([g1, g2, g3])
    resolver = GrantResolver(c)
    result = resolver.for_user("alice")
    assert len(result) == 2
    assert all(g.grantee == "alice" for g in result)


def test_for_user_empty_grants():
    """for_user: empty grants -> empty result."""
    c = _collected([])
    resolver = GrantResolver(c)
    result = resolver.for_user("alice")
    assert result == []


# ── for_user_effective tests ──


def test_for_user_effective_direct_plus_role():
    """for_user_effective: direct + role chain grants, source attributed."""
    g_direct = _grant(grantee="alice", privilege_type="SELECT")
    g_role = _grant(grantee="analyst_role", grantee_type="ROLE", privilege_type="INSERT")
    c = _collected(
        grants=[g_direct, g_role],
        role_chain={"analyst_role": "analyst_role"},
    )
    resolver = GrantResolver(c)
    result = resolver.for_user_effective("alice")
    assert len(result) == 2
    direct_grants = [g for g in result if g.grantee == "alice"]
    role_grants = [g for g in result if g.grantee == "analyst_role"]
    assert len(direct_grants) == 1
    assert direct_grants[0].source == "direct"
    assert len(role_grants) == 1
    assert role_grants[0].source == "analyst_role"


def test_for_user_effective_no_roles():
    """for_user_effective: no roles -> only direct grants."""
    g_direct = _grant(grantee="alice", privilege_type="SELECT")
    g_other = _grant(grantee="role_a", grantee_type="ROLE", privilege_type="INSERT")
    c = _collected(grants=[g_direct, g_other], role_chain={})
    resolver = GrantResolver(c)
    result = resolver.for_user_effective("alice")
    assert len(result) == 1
    assert result[0].grantee == "alice"


# ── for_role tests ──


def test_for_role_direct_grants_no_conn():
    """for_role: direct grants only (no conn)."""
    g1 = _grant(grantee="analyst_role", grantee_type="ROLE", privilege_type="SELECT")
    g2 = _grant(grantee="other_role", grantee_type="ROLE", privilege_type="INSERT")
    c = _collected([g1, g2])
    resolver = GrantResolver(c, conn=None)
    result = resolver.for_role("analyst_role")
    assert len(result) == 1
    assert result[0].grantee == "analyst_role"
    assert result[0].source == "direct"


@patch("app.services.common.grant_resolver.get_parent_roles")
def test_for_role_with_parents(mock_parents):
    """for_role: with conn + parent roles via BFS."""
    mock_parents.side_effect = lambda conn, role: {
        "analyst_role": ["parent_role"],
        "parent_role": [],
    }.get(role, [])

    g_child = _grant(grantee="analyst_role", grantee_type="ROLE", privilege_type="SELECT")
    g_parent = _grant(grantee="parent_role", grantee_type="ROLE", privilege_type="INSERT")
    c = _collected([g_child, g_parent])
    conn = FakeConnection({})
    resolver = GrantResolver(c, conn=conn)
    result = resolver.for_role("analyst_role")
    assert len(result) == 2
    grantees = {g.grantee for g in result}
    assert grantees == {"analyst_role", "parent_role"}


# ── for_object tests ──


def test_for_object_exact_match():
    """for_object: basic classification (EXACT match)."""
    g = _grant(
        grantee="role_a",
        grantee_type="ROLE",
        object_database="db1",
        object_name="tbl1",
        object_type="TABLE",
        privilege_type="SELECT",
    )
    c = _collected([g])
    resolver = GrantResolver(c)
    q = ObjectQuery(catalog=None, database="db1", name="tbl1", object_type="TABLE")
    result = resolver.for_object(q)
    assert len(result) == 1
    assert result[0].privilege_type == "SELECT"


def test_for_object_bfs_child_roles():
    """for_object: BFS child roles (role_child_map populated)."""
    g = _grant(
        grantee="parent_role",
        grantee_type="ROLE",
        object_database="db1",
        object_name="tbl1",
        object_type="TABLE",
        privilege_type="SELECT",
    )
    c = _collected(
        grants=[g],
        role_child_map={"parent_role": ["child_role"]},
    )
    resolver = GrantResolver(c)
    q = ObjectQuery(catalog=None, database="db1", name="tbl1", object_type="TABLE")
    result = resolver.for_object(q)
    # parent_role's grant + child_role inherits via BFS
    grantees = {g.grantee for g in result}
    assert "parent_role" in grantees
    assert "child_role" in grantees


def test_for_object_non_admin_path():
    """for_object: non-admin path - user_role_chain set, all_users empty."""
    g_role = _grant(
        grantee="analyst_role",
        grantee_type="ROLE",
        object_database="db1",
        object_name="tbl1",
        object_type="TABLE",
        privilege_type="SELECT",
    )
    g_user = _grant(
        grantee="alice",
        grantee_type="USER",
        object_database="db1",
        object_name="tbl1",
        object_type="TABLE",
        privilege_type="INSERT",
    )
    c = _collected(
        grants=[g_role, g_user],
        role_chain={"analyst_role": "analyst_role"},
        all_users=set(),  # non-admin: empty
    )
    resolver = GrantResolver(c, conn=None)
    q = ObjectQuery(catalog=None, database="db1", name="tbl1", object_type="TABLE")
    result = resolver.for_object(q)
    # Both role and user grants should be present; user inherits from role chain
    grantees = {g.grantee for g in result}
    assert "analyst_role" in grantees
    assert "alice" in grantees


def test_for_object_empty_grants():
    """for_object: empty grants -> empty result."""
    c = _collected([])
    resolver = GrantResolver(c)
    q = ObjectQuery(catalog=None, database="db1", name="tbl1", object_type="TABLE")
    result = resolver.for_object(q)
    assert result == []
