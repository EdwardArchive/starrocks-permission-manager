"""Unit tests for app.services.admin.bfs_resolver."""

from __future__ import annotations

from unittest.mock import patch

from app.models.schemas import PrivilegeGrant
from app.services.admin.bfs_resolver import (
    _bfs_child_roles,
    _bfs_user_privs,
    _finalize,
    _find_ancestors_with_grants,
)
from app.services.common.grant_classifier import ObjectQuery, Relevance
from tests.conftest import FakeConnection


# ── _bfs_child_roles tests ──


def test_bfs_child_roles_simple_chain():
    """Simple chain: A->B->C, A has SELECT -> B and C get SELECT."""
    role_privs = {"A": {"SELECT"}}
    children_of = {"A": ["B"], "B": ["C"]}
    result = _bfs_child_roles(role_privs, children_of)
    assert "B" in result
    assert "C" in result
    assert "SELECT" in result["B"][0]
    assert "SELECT" in result["C"][0]


def test_bfs_child_roles_diamond():
    """Diamond: A->B, A->C, B->D, C->D -> D gets all privs from A."""
    role_privs = {"A": {"SELECT", "INSERT"}}
    children_of = {"A": ["B", "C"], "B": ["D"], "C": ["D"]}
    result = _bfs_child_roles(role_privs, children_of)
    assert "D" in result
    assert "SELECT" in result["D"][0]
    assert "INSERT" in result["D"][0]


def test_bfs_child_roles_empty_role_privs():
    """Empty role_privs -> empty result."""
    result = _bfs_child_roles({}, {"A": ["B"]})
    assert result == {}


def test_bfs_child_roles_cycle():
    """Cycle: A->B->A -> terminates via visited set."""
    role_privs = {"A": {"SELECT"}}
    children_of = {"A": ["B"], "B": ["A"]}
    result = _bfs_child_roles(role_privs, children_of)
    # Should not hang; B inherits from A
    assert "B" in result
    assert "SELECT" in result["B"][0]


# ── _bfs_user_privs tests ──


@patch("app.services.admin.bfs_resolver.get_user_roles")
def test_bfs_user_privs_fast_path(mock_user_roles):
    """Fast path: user has role directly in role_privs -> returns immediately."""
    mock_user_roles.return_value = ["role_a"]
    conn = FakeConnection({})
    role_privs = {"role_a": {"SELECT", "INSERT"}}
    result = _bfs_user_privs(conn, "user1", role_privs)
    assert "SELECT" in result
    assert "INSERT" in result


@patch("app.services.admin.bfs_resolver.get_parent_roles")
@patch("app.services.admin.bfs_resolver.get_user_roles")
def test_bfs_user_privs_slow_path(mock_user_roles, mock_parents):
    """Slow path: user's direct role not in role_privs, but parent is -> BFS finds it."""
    mock_user_roles.return_value = ["role_a"]
    mock_parents.side_effect = lambda conn, role: {
        "role_a": ["role_b"],
        "role_b": [],
    }.get(role, [])
    conn = FakeConnection({})
    role_privs = {"role_b": {"DELETE"}}
    result = _bfs_user_privs(conn, "user1", role_privs)
    assert "DELETE" in result


@patch("app.services.admin.bfs_resolver.get_user_roles")
def test_bfs_user_privs_no_roles(mock_user_roles):
    """No roles -> returns empty dict."""
    mock_user_roles.return_value = []
    conn = FakeConnection({})
    result = _bfs_user_privs(conn, "user1", {"role_a": {"SELECT"}})
    assert result == {}


# ── _finalize tests ──


def test_finalize_implicit_usage_conversion():
    """IMPLICIT_USAGE grants converted to USAGE, deduped per grantee."""
    g1 = PrivilegeGrant(
        grantee="role_a",
        grantee_type="ROLE",
        object_catalog=None,
        object_database="db1",
        object_name="tbl1",
        object_type="TABLE",
        privilege_type="SELECT",
        is_grantable=False,
        source="direct",
    )
    g2 = PrivilegeGrant(
        grantee="role_a",
        grantee_type="ROLE",
        object_catalog=None,
        object_database="db1",
        object_name="tbl2",
        object_type="TABLE",
        privilege_type="INSERT",
        is_grantable=False,
        source="direct",
    )
    q = ObjectQuery(catalog=None, database="db1", name=None, object_type="DATABASE")

    classified = [(g1, Relevance.IMPLICIT_USAGE), (g2, Relevance.IMPLICIT_USAGE)]
    result = _finalize(classified, q)
    # Both IMPLICIT_USAGE from same grantee -> one USAGE grant
    assert len(result) == 1
    assert result[0].privilege_type == "USAGE"
    assert result[0].grantee == "role_a"
    assert result[0].object_type == "DATABASE"


# ── _find_ancestors_with_grants tests ──


@patch("app.services.admin.bfs_resolver.get_parent_roles")
def test_find_ancestors_grandparent(mock_parents):
    """Grandparent has grants -> found via BFS upward."""
    mock_parents.side_effect = lambda conn, role: {
        "role_a": ["role_b"],
        "role_b": ["role_c"],
        "role_c": [],
    }.get(role, [])
    conn = FakeConnection({})
    grants_map = {"role_c": [{"priv": "SELECT"}]}
    result = _find_ancestors_with_grants(conn, "role_a", grants_map)
    assert "role_c" in result
