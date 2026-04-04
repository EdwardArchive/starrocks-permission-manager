"""Unit tests for backend/app/services/admin/bfs_resolver.py"""
from __future__ import annotations

from unittest.mock import patch

import pytest

from app.models.schemas import PrivilegeGrant
from app.services.admin.bfs_resolver import (
    _bfs_child_roles,
    _bfs_user_privs,
    _finalize,
    _find_ancestors_with_grants,
)
from app.services.common.grant_classifier import ObjectQuery, Relevance


# ── Helpers ──

def _grant(
    grantee: str = "role_a",
    grantee_type: str = "ROLE",
    privilege_type: str = "SELECT",
    object_type: str = "TABLE",
    object_catalog: str | None = "cat1",
    object_database: str | None = "db1",
    object_name: str | None = "t1",
    source: str = "direct",
    is_grantable: bool = False,
) -> PrivilegeGrant:
    return PrivilegeGrant(
        grantee=grantee,
        grantee_type=grantee_type,
        privilege_type=privilege_type,
        object_type=object_type,
        object_catalog=object_catalog,
        object_database=object_database,
        object_name=object_name,
        source=source,
        is_grantable=is_grantable,
    )


# ══════════════════════════════════════════════════════════════════════
# _bfs_child_roles
# ══════════════════════════════════════════════════════════════════════


class TestBfsChildRoles:
    def test_simple_chain(self):
        """root -> admin -> analyst: both admin and analyst inherit root's privs."""
        role_privs = {"root": {"SELECT", "INSERT"}}
        children_of = {
            "root": ["admin"],
            "admin": ["analyst"],
        }
        result = _bfs_child_roles(role_privs, children_of)
        assert "admin" in result
        assert "analyst" in result
        assert result["admin"][0] == {"SELECT", "INSERT"}
        assert result["analyst"][0] == {"SELECT", "INSERT"}
        # origin should be root for both
        assert result["admin"][1] == "root"
        assert result["analyst"][1] == "root"

    def test_diamond_inheritance(self):
        """A -> B, A -> C, B -> D, C -> D: D inherits from both paths."""
        role_privs = {"A": {"SELECT", "INSERT"}}
        children_of = {
            "A": ["B", "C"],
            "B": ["D"],
            "C": ["D"],
        }
        result = _bfs_child_roles(role_privs, children_of)
        assert "D" in result
        assert result["D"][0] == {"SELECT", "INSERT"}

    def test_no_children(self):
        """Role with privs but no children yields empty result."""
        role_privs = {"lonely": {"SELECT"}}
        children_of: dict[str, list[str]] = {}
        result = _bfs_child_roles(role_privs, children_of)
        assert result == {}

    def test_cycle_protection(self):
        """Cycles in the graph should not cause infinite loop."""
        role_privs = {"A": {"SELECT"}}
        children_of = {
            "A": ["B"],
            "B": ["C"],
            "C": ["A"],  # cycle back to A
        }
        result = _bfs_child_roles(role_privs, children_of)
        assert "B" in result
        assert "C" in result
        # A is in role_privs and visited first, should not appear as child
        # (it is the seed, not a child)

    def test_multiple_seeds(self):
        """Multiple roles with different privs propagate independently."""
        role_privs = {
            "role_x": {"SELECT"},
            "role_y": {"INSERT"},
        }
        children_of = {
            "role_x": ["shared_child"],
            "role_y": ["shared_child"],
        }
        result = _bfs_child_roles(role_privs, children_of)
        assert "shared_child" in result
        # shared_child should accumulate privs from both seeds
        assert result["shared_child"][0] >= {"SELECT", "INSERT"}

    def test_empty_inputs(self):
        """Empty role_privs yields empty result."""
        result = _bfs_child_roles({}, {"A": ["B"]})
        assert result == {}


# ══════════════════════════════════════════════════════════════════════
# _bfs_user_privs
# ══════════════════════════════════════════════════════════════════════


class TestBfsUserPrivs:
    @patch("app.services.admin.bfs_resolver.get_user_roles")
    def test_direct_role_match(self, mock_get_user_roles):
        """User has a role directly in role_privs."""
        mock_get_user_roles.return_value = ["analyst"]
        role_privs = {"analyst": {"SELECT", "INSERT"}}
        conn = object()  # dummy
        result = _bfs_user_privs(conn, "alice", role_privs)
        assert "SELECT" in result
        assert "INSERT" in result
        assert result["SELECT"] == "analyst"

    @patch("app.services.admin.bfs_resolver.get_parent_roles")
    @patch("app.services.admin.bfs_resolver.get_user_roles")
    def test_inherited_via_bfs(self, mock_get_user_roles, mock_get_parent_roles):
        """User's role inherits from a role with privs via BFS upward."""
        mock_get_user_roles.return_value = ["junior"]
        # junior's parent is senior, senior is in role_privs
        mock_get_parent_roles.side_effect = lambda conn, role: {
            "junior": ["senior"],
            "senior": [],
        }.get(role, [])
        role_privs = {"senior": {"DELETE"}}
        conn = object()
        result = _bfs_user_privs(conn, "bob", role_privs)
        assert "DELETE" in result
        # source should be the user's direct role (origin)
        assert result["DELETE"] == "junior"

    @patch("app.services.admin.bfs_resolver.get_user_roles")
    def test_no_matching_roles(self, mock_get_user_roles):
        """User has roles but none match role_privs (and no parents)."""
        mock_get_user_roles.return_value = ["unrelated"]
        role_privs = {"analyst": {"SELECT"}}
        conn = object()
        with patch("app.services.admin.bfs_resolver.get_parent_roles", return_value=[]):
            result = _bfs_user_privs(conn, "charlie", role_privs)
        assert result == {}

    @patch("app.services.admin.bfs_resolver.get_user_roles")
    def test_no_roles_at_all(self, mock_get_user_roles):
        """User with no roles returns empty."""
        mock_get_user_roles.return_value = []
        result = _bfs_user_privs(object(), "nobody", {"admin": {"ALL"}})
        assert result == {}

    @patch("app.services.admin.bfs_resolver.get_user_roles")
    def test_first_match_wins(self, mock_get_user_roles):
        """When multiple roles provide same priv, first match is kept (setdefault)."""
        mock_get_user_roles.return_value = ["role_a", "role_b"]
        role_privs = {
            "role_a": {"SELECT"},
            "role_b": {"SELECT"},
        }
        result = _bfs_user_privs(object(), "dave", role_privs)
        assert result["SELECT"] == "role_a"


# ══════════════════════════════════════════════════════════════════════
# _finalize
# ══════════════════════════════════════════════════════════════════════


class TestFinalize:
    def _make_query(self, catalog="cat1", database="db1", name="t1", object_type="TABLE"):
        return ObjectQuery(catalog=catalog, database=database, name=name, object_type=object_type)

    def test_implicit_usage_converted(self):
        """IMPLICIT_USAGE grants are converted to USAGE with '(implicit)' source."""
        grant = _grant(grantee="role_a", privilege_type="SELECT", source="direct")
        q = self._make_query(object_type="DATABASE")
        classified = [(grant, Relevance.IMPLICIT_USAGE)]
        result = _finalize(classified, q)
        assert len(result) == 1
        assert result[0].privilege_type == "USAGE"
        assert "(implicit)" in result[0].source
        assert result[0].grantee == "role_a"
        assert result[0].object_catalog == "cat1"
        assert result[0].object_database == "db1"

    def test_implicit_usage_dedup_per_grantee(self):
        """Multiple IMPLICIT_USAGE grants for the same grantee yield only one USAGE."""
        g1 = _grant(grantee="role_a", privilege_type="SELECT", source="direct")
        g2 = _grant(grantee="role_a", privilege_type="INSERT", source="direct")
        q = self._make_query()
        classified = [
            (g1, Relevance.IMPLICIT_USAGE),
            (g2, Relevance.IMPLICIT_USAGE),
        ]
        result = _finalize(classified, q)
        usage_grants = [g for g in result if g.privilege_type == "USAGE"]
        assert len(usage_grants) == 1

    def test_regular_grants_pass_through(self):
        """EXACT grants pass through unchanged."""
        grant = _grant(privilege_type="SELECT")
        q = self._make_query()
        classified = [(grant, Relevance.EXACT)]
        result = _finalize(classified, q)
        assert len(result) == 1
        assert result[0].privilege_type == "SELECT"
        assert result[0].grantee == "role_a"

    def test_duplicate_grants_deduplicated(self):
        """Identical grants are deduplicated."""
        g1 = _grant(privilege_type="SELECT")
        g2 = _grant(privilege_type="SELECT")
        q = self._make_query()
        classified = [(g1, Relevance.EXACT), (g2, Relevance.EXACT)]
        result = _finalize(classified, q)
        select_grants = [g for g in result if g.privilege_type == "SELECT"]
        assert len(select_grants) == 1

    def test_mixed_exact_and_implicit(self):
        """Mix of EXACT and IMPLICIT_USAGE grants processed correctly."""
        exact = _grant(grantee="role_a", privilege_type="SELECT")
        implicit = _grant(grantee="role_b", privilege_type="INSERT", source="inherited")
        q = self._make_query(object_type="DATABASE")
        classified = [
            (exact, Relevance.EXACT),
            (implicit, Relevance.IMPLICIT_USAGE),
        ]
        result = _finalize(classified, q)
        types = {g.privilege_type for g in result}
        assert "SELECT" in types
        assert "USAGE" in types
        # role_b should have USAGE, not INSERT
        role_b_grants = [g for g in result if g.grantee == "role_b"]
        assert all(g.privilege_type == "USAGE" for g in role_b_grants)

    def test_empty_input(self):
        """Empty classified list yields empty result."""
        q = self._make_query()
        result = _finalize([], q)
        assert result == []


# ══════════════════════════════════════════════════════════════════════
# _find_ancestors_with_grants
# ══════════════════════════════════════════════════════════════════════


class TestFindAncestorsWithGrants:
    @patch("app.services.admin.bfs_resolver.get_parent_roles")
    def test_finds_parent_with_grants(self, mock_get_parent_roles):
        """Start from child, find parent that has grants."""
        mock_get_parent_roles.side_effect = lambda conn, role: {
            "child": ["parent"],
            "parent": [],
        }.get(role, [])
        grants_map = {"parent": [_grant(grantee="parent")]}
        result = _find_ancestors_with_grants(object(), "child", grants_map)
        assert result == ["parent"]

    @patch("app.services.admin.bfs_resolver.get_parent_roles")
    def test_no_ancestors_with_grants(self, mock_get_parent_roles):
        """No ancestors have grants."""
        mock_get_parent_roles.side_effect = lambda conn, role: {
            "child": ["mid"],
            "mid": ["top"],
            "top": [],
        }.get(role, [])
        grants_map = {"unrelated": [_grant()]}
        result = _find_ancestors_with_grants(object(), "child", grants_map)
        assert result == []

    @patch("app.services.admin.bfs_resolver.get_parent_roles")
    def test_multiple_ancestors_with_grants(self, mock_get_parent_roles):
        """Multiple ancestors at different depths have grants."""
        mock_get_parent_roles.side_effect = lambda conn, role: {
            "child": ["mid"],
            "mid": ["top"],
            "top": [],
        }.get(role, [])
        grants_map = {
            "mid": [_grant(grantee="mid")],
            "top": [_grant(grantee="top")],
        }
        result = _find_ancestors_with_grants(object(), "child", grants_map)
        assert "mid" in result
        assert "top" in result

    @patch("app.services.admin.bfs_resolver.get_parent_roles")
    def test_diamond_ancestor_graph(self, mock_get_parent_roles):
        """Diamond: child -> A, child -> B, A -> top, B -> top. top has grants."""
        mock_get_parent_roles.side_effect = lambda conn, role: {
            "child": ["A", "B"],
            "A": ["top"],
            "B": ["top"],
            "top": [],
        }.get(role, [])
        grants_map = {"top": [_grant(grantee="top")]}
        result = _find_ancestors_with_grants(object(), "child", grants_map)
        assert result == ["top"]

    @patch("app.services.admin.bfs_resolver.get_parent_roles")
    def test_start_role_excluded(self, mock_get_parent_roles):
        """Start role itself should not be included even if it has grants."""
        mock_get_parent_roles.return_value = []
        grants_map = {"child": [_grant(grantee="child")]}
        result = _find_ancestors_with_grants(object(), "child", grants_map)
        assert result == []

    @patch("app.services.admin.bfs_resolver.get_parent_roles")
    def test_cycle_protection(self, mock_get_parent_roles):
        """Cycle in ancestor graph does not cause infinite loop."""
        mock_get_parent_roles.side_effect = lambda conn, role: {
            "child": ["A"],
            "A": ["B"],
            "B": ["A"],  # cycle
        }.get(role, [])
        grants_map = {"A": [_grant(grantee="A")]}
        result = _find_ancestors_with_grants(object(), "child", grants_map)
        assert result == ["A"]
