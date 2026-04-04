"""Unit tests for role_helpers.py and name_utils.py."""

from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest

from app.utils.role_helpers import (
    build_role_chain,
    collect_all_roles_via_grants,
    get_parent_roles,
    get_user_roles,
    parse_role_assignments,
)
from app.services.shared.name_utils import normalize_fn_name


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _mock_conn():
    return MagicMock()


# ---------------------------------------------------------------------------
# 1. parse_role_assignments
# ---------------------------------------------------------------------------

class TestParseRoleAssignments:
    @patch("app.utils.role_helpers.execute_query")
    def test_single_role_grant(self, mock_eq):
        mock_eq.return_value = [
            {"GrantStatement": "GRANT 'analyst_role' TO USER 'alice'"},
        ]
        roles = parse_role_assignments(_mock_conn(), "alice", "USER")
        assert roles == ["analyst_role"]

    @patch("app.utils.role_helpers.execute_query")
    def test_multiple_roles_comma_separated(self, mock_eq):
        mock_eq.return_value = [
            {"GrantStatement": "GRANT 'role1', 'role2' TO USER 'bob'"},
        ]
        roles = parse_role_assignments(_mock_conn(), "bob", "USER")
        assert roles == ["role1", "role2"]

    @patch("app.utils.role_helpers.execute_query")
    def test_non_role_lines_ignored(self, mock_eq):
        """Lines with ON (privilege grants) should be skipped."""
        mock_eq.return_value = [
            {"GrantStatement": "GRANT SELECT ON TABLE default_catalog.db.t TO USER 'alice'"},
            {"GrantStatement": "GRANT 'analyst_role' TO USER 'alice'"},
        ]
        roles = parse_role_assignments(_mock_conn(), "alice", "USER")
        assert roles == ["analyst_role"]

    @patch("app.utils.role_helpers.execute_query")
    def test_empty_results(self, mock_eq):
        mock_eq.return_value = []
        roles = parse_role_assignments(_mock_conn(), "alice", "USER")
        assert roles == []

    @patch("app.utils.role_helpers.execute_query")
    def test_role_grantee_type(self, mock_eq):
        """Should use SHOW GRANTS FOR ROLE syntax."""
        mock_eq.return_value = [
            {"GrantStatement": "GRANT 'parent_role' TO ROLE 'child_role'"},
        ]
        roles = parse_role_assignments(_mock_conn(), "child_role", "ROLE")
        assert roles == ["parent_role"]
        sql_called = mock_eq.call_args[0][1]
        assert "FOR ROLE" in sql_called

    @patch("app.utils.role_helpers.execute_query")
    def test_user_grantee_type_sql(self, mock_eq):
        mock_eq.return_value = []
        parse_role_assignments(_mock_conn(), "alice", "USER")
        sql_called = mock_eq.call_args[0][1]
        assert "FOR ROLE" not in sql_called
        assert "FOR 'alice'" in sql_called

    @patch("app.utils.role_helpers.execute_query")
    def test_duplicate_roles_deduplicated(self, mock_eq):
        mock_eq.return_value = [
            {"GrantStatement": "GRANT 'r1' TO USER 'u'"},
            {"GrantStatement": "GRANT 'r1' TO USER 'u'"},
        ]
        roles = parse_role_assignments(_mock_conn(), "u", "USER")
        assert roles == ["r1"]

    @patch("app.utils.role_helpers.execute_query")
    def test_execute_query_exception_returns_empty(self, mock_eq):
        mock_eq.side_effect = Exception("connection lost")
        roles = parse_role_assignments(_mock_conn(), "alice", "USER")
        assert roles == []


# ---------------------------------------------------------------------------
# 2. build_role_chain
# ---------------------------------------------------------------------------

class TestBuildRoleChain:
    @patch("app.utils.role_helpers.get_parent_roles")
    @patch("app.utils.role_helpers.get_user_roles")
    def test_simple_chain(self, mock_gur, mock_gpr):
        mock_gur.return_value = ["role1"]
        mock_gpr.side_effect = lambda conn, r: {"role1": ["role2"], "role2": []}.get(r, [])

        result = build_role_chain(_mock_conn(), "alice", include_public=False)
        assert "role1" in result
        assert "role2" in result

    @patch("app.utils.role_helpers.get_parent_roles")
    @patch("app.utils.role_helpers.get_user_roles")
    def test_include_public_true(self, mock_gur, mock_gpr):
        mock_gur.return_value = ["role1"]
        mock_gpr.return_value = []

        result = build_role_chain(_mock_conn(), "alice", include_public=True)
        assert "public" in result
        assert "role1" in result

    @patch("app.utils.role_helpers.get_parent_roles")
    @patch("app.utils.role_helpers.get_user_roles")
    def test_include_public_false(self, mock_gur, mock_gpr):
        mock_gur.return_value = ["role1"]
        mock_gpr.return_value = []

        result = build_role_chain(_mock_conn(), "alice", include_public=False)
        assert "public" not in result

    @patch("app.utils.role_helpers.get_parent_roles")
    @patch("app.utils.role_helpers.get_user_roles")
    def test_public_not_duplicated_if_already_present(self, mock_gur, mock_gpr):
        mock_gur.return_value = ["public", "role1"]
        mock_gpr.return_value = []

        result = build_role_chain(_mock_conn(), "alice", include_public=True)
        assert list(result.keys()).count("public") == 1

    @patch("app.utils.role_helpers.get_parent_roles")
    @patch("app.utils.role_helpers.get_user_roles")
    def test_cycle_detection(self, mock_gur, mock_gpr):
        """role1 -> role2 -> role1 should terminate without infinite loop."""
        mock_gur.return_value = ["role1"]
        mock_gpr.side_effect = lambda conn, r: {
            "role1": ["role2"],
            "role2": ["role1"],
        }.get(r, [])

        result = build_role_chain(_mock_conn(), "alice", include_public=False)
        assert "role1" in result
        assert "role2" in result
        # Should terminate (not hang)

    @patch("app.utils.role_helpers.get_parent_roles")
    @patch("app.utils.role_helpers.get_user_roles")
    def test_depth_limit(self, mock_gur, mock_gpr):
        """Chain deeper than 100 should be truncated."""
        mock_gur.return_value = ["role_0"]
        # Each role_N has parent role_{N+1}
        mock_gpr.side_effect = lambda conn, r: (
            [f"role_{int(r.split('_')[1]) + 1}"] if r.startswith("role_") else []
        )

        result = build_role_chain(_mock_conn(), "alice", include_public=False)
        # BFS stops at 100 visited nodes
        assert len(result) == 100

    @patch("app.utils.role_helpers.get_parent_roles")
    @patch("app.utils.role_helpers.get_user_roles")
    def test_origin_tracking(self, mock_gur, mock_gpr):
        """Origin should trace back to the direct role."""
        mock_gur.return_value = ["role1"]
        mock_gpr.side_effect = lambda conn, r: {"role1": ["role2"], "role2": ["role3"], "role3": []}.get(r, [])

        result = build_role_chain(_mock_conn(), "alice", include_public=False)
        assert result["role1"] == "role1"
        assert result["role2"] == "role1"
        assert result["role3"] == "role1"


# ---------------------------------------------------------------------------
# 3. get_user_roles
# ---------------------------------------------------------------------------

class TestGetUserRoles:
    @patch("app.utils.role_helpers.execute_query")
    def test_sys_role_edges_success(self, mock_eq):
        mock_eq.return_value = [
            {"FROM_ROLE": "analyst_role"},
            {"FROM_ROLE": "etl_role"},
        ]
        roles = get_user_roles(_mock_conn(), "alice")
        assert roles == ["analyst_role", "etl_role"]

    @patch("app.utils.role_helpers.parse_role_assignments")
    @patch("app.utils.role_helpers.execute_query")
    def test_fallback_on_exception(self, mock_eq, mock_pra):
        """When sys.role_edges fails, should fall back to parse_role_assignments."""
        mock_eq.side_effect = Exception("access denied")
        mock_pra.return_value = ["fallback_role"]

        roles = get_user_roles(_mock_conn(), "alice")
        assert roles == ["fallback_role"]
        mock_pra.assert_called_once()

    @patch("app.utils.role_helpers.parse_role_assignments")
    @patch("app.utils.role_helpers.execute_query")
    def test_fallback_on_empty_result(self, mock_eq, mock_pra):
        """When sys.role_edges returns empty, should also fall back."""
        mock_eq.return_value = []
        mock_pra.return_value = ["grant_role"]

        roles = get_user_roles(_mock_conn(), "alice")
        assert roles == ["grant_role"]

    @patch("app.utils.role_helpers.execute_query")
    def test_alternative_key_role_name(self, mock_eq):
        """Should handle ROLE_NAME key as fallback."""
        mock_eq.return_value = [{"ROLE_NAME": "admin_role"}]
        roles = get_user_roles(_mock_conn(), "alice")
        assert roles == ["admin_role"]


# ---------------------------------------------------------------------------
# 4. get_parent_roles
# ---------------------------------------------------------------------------

class TestGetParentRoles:
    @patch("app.utils.role_helpers.execute_query")
    def test_sys_role_edges_success(self, mock_eq):
        mock_eq.return_value = [{"FROM_ROLE": "root"}]
        parents = get_parent_roles(_mock_conn(), "db_admin")
        assert parents == ["root"]

    @patch("app.utils.role_helpers.parse_role_assignments")
    @patch("app.utils.role_helpers.execute_query")
    def test_fallback_on_exception(self, mock_eq, mock_pra):
        mock_eq.side_effect = Exception("access denied")
        mock_pra.return_value = ["parent_via_grants"]

        parents = get_parent_roles(_mock_conn(), "analyst_role")
        assert parents == ["parent_via_grants"]
        mock_pra.assert_called_once_with(mock_eq.call_args[0][0], "analyst_role", "ROLE")

    @patch("app.utils.role_helpers.parse_role_assignments")
    @patch("app.utils.role_helpers.execute_query")
    def test_fallback_on_empty(self, mock_eq, mock_pra):
        mock_eq.return_value = []
        mock_pra.return_value = ["fallback_parent"]

        parents = get_parent_roles(_mock_conn(), "some_role")
        assert parents == ["fallback_parent"]

    @patch("app.utils.role_helpers.execute_query")
    def test_alternative_key_parent_role_name(self, mock_eq):
        mock_eq.return_value = [{"PARENT_ROLE_NAME": "root"}]
        parents = get_parent_roles(_mock_conn(), "db_admin")
        assert parents == ["root"]

    @patch("app.utils.role_helpers.execute_query")
    def test_uses_to_role_param(self, mock_eq):
        mock_eq.return_value = [{"FROM_ROLE": "root"}]
        get_parent_roles(_mock_conn(), "my_role")
        # First call should query sys.role_edges with TO_ROLE
        first_sql = mock_eq.call_args_list[0][0][1]
        assert "TO_ROLE" in first_sql


# ---------------------------------------------------------------------------
# 5. collect_all_roles_via_grants
# ---------------------------------------------------------------------------

class TestCollectAllRolesViaGrants:
    @patch("app.utils.role_helpers.get_parent_roles")
    @patch("app.utils.role_helpers.get_user_roles")
    def test_returns_set_of_roles(self, mock_gur, mock_gpr):
        mock_gur.return_value = ["role1", "role2"]
        mock_gpr.return_value = []

        result = collect_all_roles_via_grants(_mock_conn(), "alice")
        assert isinstance(result, set)
        assert "role1" in result
        assert "role2" in result
        assert "public" in result  # always included

    @patch("app.utils.role_helpers.get_parent_roles")
    @patch("app.utils.role_helpers.get_user_roles")
    def test_includes_transitive_roles(self, mock_gur, mock_gpr):
        mock_gur.return_value = ["role1"]
        mock_gpr.side_effect = lambda conn, r: {"role1": ["role2"], "role2": []}.get(r, [])

        result = collect_all_roles_via_grants(_mock_conn(), "alice")
        assert result >= {"role1", "role2", "public"}


# ---------------------------------------------------------------------------
# 6. normalize_fn_name
# ---------------------------------------------------------------------------

class TestNormalizeFnName:
    def test_strip_signature(self):
        assert normalize_fn_name("my_func(INT, VARCHAR)") == "my_func"

    def test_no_parentheses(self):
        assert normalize_fn_name("simple_name") == "simple_name"

    def test_empty_string(self):
        assert normalize_fn_name("") == ""

    def test_empty_parens(self):
        assert normalize_fn_name("fn()") == "fn"

    def test_nested_parens(self):
        assert normalize_fn_name("fn(ARRAY(INT))") == "fn"
