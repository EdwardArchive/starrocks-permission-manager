"""Unit tests for app.services.common.grant_parser module."""

from __future__ import annotations

from unittest.mock import patch

import pytest

from app.models.schemas import PrivilegeGrant
from app.services.common.grant_parser import (
    _parse_grant_statement,
    _parse_show_grants,
    _row_to_grants,
)


# ────────────────────────────────────────────
# Helpers
# ────────────────────────────────────────────

def _single(grants: list[PrivilegeGrant]) -> PrivilegeGrant:
    """Assert exactly one grant returned and return it."""
    assert len(grants) == 1, f"Expected 1 grant, got {len(grants)}: {grants}"
    return grants[0]


# ════════════════════════════════════════════
# _parse_grant_statement
# ════════════════════════════════════════════


class TestParseGrantStatement:
    """Tests for _parse_grant_statement (pure function)."""

    # ── Simple TABLE grant ──

    def test_simple_table_grant(self):
        stmt = "GRANT SELECT ON TABLE default_catalog.db.tbl TO USER 'alice'"
        g = _single(_parse_grant_statement(stmt, "alice", "USER"))
        assert g.privilege_type == "SELECT"
        assert g.object_type == "TABLE"
        assert g.object_catalog == "default_catalog"
        assert g.object_database == "db"
        assert g.object_name == "tbl"
        assert g.grantee == "alice"
        assert g.grantee_type == "USER"

    # ── Multi-privilege ──

    def test_multi_privilege(self):
        stmt = "GRANT SELECT, INSERT ON TABLE default_catalog.db.tbl TO USER 'alice'"
        grants = _parse_grant_statement(stmt, "alice", "USER")
        assert len(grants) == 2
        privs = {g.privilege_type for g in grants}
        assert privs == {"SELECT", "INSERT"}
        for g in grants:
            assert g.object_type == "TABLE"
            assert g.object_catalog == "default_catalog"
            assert g.object_database == "db"
            assert g.object_name == "tbl"

    # ── DATABASE scope ──

    def test_database_scope(self):
        stmt = "GRANT USAGE ON DATABASE db1 TO ROLE 'analyst'"
        g = _single(_parse_grant_statement(stmt, "analyst", "ROLE"))
        assert g.privilege_type == "USAGE"
        assert g.object_type == "DATABASE"
        # "ON DATABASE db1" → db1 is the database, NOT the catalog
        assert g.object_database == "db1"
        assert g.object_catalog is None
        assert g.object_name is None

    # ── CATALOG scope ──

    def test_catalog_scope(self):
        stmt = "GRANT USAGE ON CATALOG default_catalog TO ROLE 'analyst'"
        g = _single(_parse_grant_statement(stmt, "analyst", "ROLE"))
        assert g.privilege_type == "USAGE"
        assert g.object_type == "CATALOG"
        assert g.object_catalog == "default_catalog"
        assert g.object_database is None
        assert g.object_name is None

    # ── SYSTEM scope ──

    def test_system_scope(self):
        stmt = "GRANT GRANT ON SYSTEM TO ROLE 'root'"
        g = _single(_parse_grant_statement(stmt, "root", "ROLE"))
        assert g.privilege_type == "GRANT"
        assert g.object_type == "SYSTEM"

    # ── MATERIALIZED VIEW (multi-word type) ──

    def test_materialized_view_3part(self):
        stmt = "GRANT SELECT ON MATERIALIZED VIEW cat.db.mv1 TO USER 'alice'"
        g = _single(_parse_grant_statement(stmt, "alice", "USER"))
        assert g.privilege_type == "SELECT"
        assert g.object_type == "MATERIALIZED VIEW"
        # 3-part path: catalog.database.name
        assert g.object_catalog == "cat"
        assert g.object_database == "db"
        assert g.object_name == "mv1"

    def test_materialized_view_2part(self):
        stmt = "GRANT SELECT ON MATERIALIZED VIEW db.mv1 TO USER 'alice'"
        g = _single(_parse_grant_statement(stmt, "alice", "USER"))
        assert g.object_type == "MATERIALIZED VIEW"
        # 2-part for MATERIALIZED VIEW (object-level) → database.name
        assert g.object_catalog is None
        assert g.object_database == "db"
        assert g.object_name == "mv1"

    # ── STORAGE VOLUME ──

    def test_storage_volume(self):
        stmt = "GRANT USAGE ON STORAGE VOLUME sv1 TO ROLE 'public'"
        g = _single(_parse_grant_statement(stmt, "public", "ROLE"))
        assert g.privilege_type == "USAGE"
        assert g.object_type == "STORAGE VOLUME"
        # System-level object: name should be preserved, no catalog
        assert g.object_name == "sv1"
        assert g.object_catalog is None

    # ── RESOURCE GROUP ──

    def test_resource_group(self):
        stmt = "GRANT USAGE ON RESOURCE GROUP rg1 TO USER 'bob'"
        g = _single(_parse_grant_statement(stmt, "bob", "USER"))
        assert g.privilege_type == "USAGE"
        assert g.object_type == "RESOURCE GROUP"
        assert g.object_name == "rg1"
        assert g.object_catalog is None

    # ── GLOBAL FUNCTION ──

    def test_global_function(self):
        stmt = "GRANT USAGE ON GLOBAL FUNCTION gfn_mask_email(VARCHAR(65533)) TO ROLE 'r'"
        g = _single(_parse_grant_statement(stmt, "r", "ROLE"))
        assert g.object_type == "GLOBAL FUNCTION"
        assert g.object_name == "gfn_mask_email(VARCHAR(65533))"
        assert g.object_catalog is None

    # ── ALL TABLES IN DATABASE (wildcard) ──

    def test_wildcard_all_tables_in_database(self):
        stmt = "GRANT SELECT ON ALL TABLES IN DATABASE db1 TO ROLE 'analyst'"
        g = _single(_parse_grant_statement(stmt, "analyst", "ROLE"))
        assert g.privilege_type == "SELECT"
        assert g.object_type == "TABLE"
        assert g.object_database == "db1"
        assert g.object_catalog is None

    def test_wildcard_all_views_in_database(self):
        stmt = "GRANT SELECT ON ALL VIEWS IN DATABASE db1 TO ROLE 'analyst'"
        g = _single(_parse_grant_statement(stmt, "analyst", "ROLE"))
        assert g.object_type == "VIEW"
        assert g.object_database == "db1"

    def test_wildcard_all_materialized_views_in_database(self):
        stmt = "GRANT SELECT ON ALL MATERIALIZED VIEWS IN DATABASE mydb TO ROLE 'r'"
        g = _single(_parse_grant_statement(stmt, "r", "ROLE"))
        assert g.object_type == "MATERIALIZED VIEW"
        assert g.object_database == "mydb"

    def test_wildcard_all_tables_in_all_databases(self):
        stmt = "GRANT SELECT ON ALL TABLES IN ALL DATABASES TO ROLE 'analyst'"
        g = _single(_parse_grant_statement(stmt, "analyst", "ROLE"))
        assert g.object_type == "TABLE"
        assert g.object_database is None

    # ── FUNCTION with signature ──

    def test_function_with_signature(self):
        stmt = "GRANT USAGE ON FUNCTION db.fn(INT, VARCHAR) TO ROLE 'r'"
        grants = _parse_grant_statement(stmt, "r", "ROLE")
        g = _single(grants)
        assert g.object_type == "FUNCTION"
        assert g.privilege_type == "USAGE"
        # The regex parses "FUNCTION db.fn(INT," as type+path,
        # but the key point is it doesn't crash and produces a grant

    # ── WITH GRANT OPTION ──

    def test_with_grant_option_does_not_break_parsing(self):
        # WITH GRANT OPTION appears after the TO clause, so it shouldn't
        # affect the ON...TO parsing. The regex stops at TO.
        stmt = "GRANT SELECT ON TABLE default_catalog.db.tbl TO USER 'alice' WITH GRANT OPTION"
        g = _single(_parse_grant_statement(stmt, "alice", "USER"))
        assert g.privilege_type == "SELECT"
        assert g.object_type == "TABLE"
        assert g.object_catalog == "default_catalog"
        assert g.object_database == "db"
        assert g.object_name == "tbl"

    # ── Invalid / unrecognized statements ──

    def test_invalid_statement_returns_empty(self):
        assert _parse_grant_statement("SELECT 1", "alice", "USER") == []

    def test_empty_string_returns_empty(self):
        assert _parse_grant_statement("", "alice", "USER") == []

    def test_revoke_returns_empty(self):
        assert _parse_grant_statement("REVOKE SELECT ON TABLE t FROM USER 'alice'", "alice", "USER") == []

    def test_partial_grant_no_on_returns_empty(self):
        assert _parse_grant_statement("GRANT SELECT TO USER 'alice'", "alice", "USER") == []

    # ── Backtick-quoted identifiers ──

    def test_backtick_identifiers(self):
        stmt = "GRANT SELECT ON TABLE `default_catalog`.`my-db`.`my-table` TO USER 'alice'"
        g = _single(_parse_grant_statement(stmt, "alice", "USER"))
        assert g.object_catalog == "default_catalog"
        assert g.object_database == "my-db"
        assert g.object_name == "my-table"

    # ── Wildcard paths ──

    def test_wildcard_star_path(self):
        stmt = "GRANT SELECT ON TABLE *.*.* TO USER 'alice'"
        g = _single(_parse_grant_statement(stmt, "alice", "USER"))
        assert g.object_type == "TABLE"
        assert g.object_catalog is None
        assert g.object_database is None
        assert g.object_name is None

    def test_catalog_star_database(self):
        stmt = "GRANT USAGE ON DATABASE cat.* TO ROLE 'r'"
        g = _single(_parse_grant_statement(stmt, "r", "ROLE"))
        assert g.object_type == "DATABASE"
        # For DATABASE type, 2-part path → catalog.database; but DATABASE swaps
        # Actually: parts=["cat","*"], DATABASE is not in _OBJECT_LEVEL_TYPES,
        # so catalog=cat, database=None (since *→None)
        # Then the "ON DATABASE X" swap fires only if catalog and not database:
        # catalog="cat", database=None → swap → database="cat", catalog=None
        assert g.object_database == "cat"
        assert g.object_catalog is None

    # ── VIEW (single-word type) ──

    def test_view_grant(self):
        stmt = "GRANT SELECT ON VIEW default_catalog.db.v1 TO USER 'alice'"
        g = _single(_parse_grant_statement(stmt, "alice", "USER"))
        assert g.object_type == "VIEW"
        assert g.object_catalog == "default_catalog"
        assert g.object_database == "db"
        assert g.object_name == "v1"

    # ── Case insensitivity ──

    def test_case_insensitive(self):
        stmt = "grant select on table default_catalog.db.tbl to user 'alice'"
        g = _single(_parse_grant_statement(stmt, "alice", "USER"))
        assert g.privilege_type == "select"
        assert g.object_type == "TABLE"

    # ── 1-part path for CATALOG ──

    def test_catalog_1part(self):
        stmt = "GRANT CREATE DATABASE ON CATALOG mycat TO ROLE 'r'"
        g = _single(_parse_grant_statement(stmt, "r", "ROLE"))
        assert g.object_type == "CATALOG"
        assert g.object_catalog == "mycat"
        assert g.object_database is None

    # ── WAREHOUSE (system-level object) ──

    def test_warehouse(self):
        stmt = "GRANT USAGE ON WAREHOUSE wh1 TO ROLE 'r'"
        g = _single(_parse_grant_statement(stmt, "r", "ROLE"))
        assert g.object_type == "WAREHOUSE"
        assert g.object_name == "wh1"
        assert g.object_catalog is None

    # ── RESOURCE ──

    def test_resource(self):
        stmt = "GRANT USAGE ON RESOURCE spark_res TO ROLE 'r'"
        g = _single(_parse_grant_statement(stmt, "r", "ROLE"))
        assert g.object_type == "RESOURCE"
        assert g.object_name == "spark_res"
        assert g.object_catalog is None

    # ── ALL CATALOGS ──

    def test_all_simple_catalogs(self):
        stmt = "GRANT USAGE ON ALL CATALOGS TO ROLE 'public'"
        g = _single(_parse_grant_statement(stmt, "public", "ROLE"))
        assert g.object_type == "CATALOG"

    # ── MASKING POLICY → POLICY ──

    def test_masking_policy(self):
        stmt = "GRANT APPLY ON MASKING POLICY mp1 TO ROLE 'r'"
        g = _single(_parse_grant_statement(stmt, "r", "ROLE"))
        assert g.object_type == "POLICY"

    # ── ROW ACCESS POLICY ──
    # Note: "ROW ACCESS POLICY" is not in _MULTI_WORD_TYPES, so the regex
    # captures only "ROW" as the type. The "ROW ACCESS" check in the
    # normalizer doesn't fire because obj_type is just "ROW".
    # This documents current behavior; if support is added later, update this test.

    def test_row_access_policy_current_behavior(self):
        stmt = "GRANT APPLY ON ROW ACCESS POLICY rap1 TO ROLE 'r'"
        grants = _parse_grant_statement(stmt, "r", "ROLE")
        g = _single(grants)
        # Currently parsed as "ROW" type (not "POLICY") due to missing multi-word support
        assert g.object_type == "ROW"


# ════════════════════════════════════════════
# _row_to_grants
# ════════════════════════════════════════════


class TestRowToGrants:
    """Tests for _row_to_grants (sys.grants_to_* row dict → PrivilegeGrant list)."""

    def test_standard_row(self):
        row = {
            "GRANTEE": "alice",
            "OBJECT_CATALOG": "default_catalog",
            "OBJECT_DATABASE": "analytics_db",
            "OBJECT_NAME": "user_events",
            "OBJECT_TYPE": "TABLE",
            "PRIVILEGE_TYPE": "SELECT",
            "IS_GRANTABLE": "YES",
        }
        g = _single(_row_to_grants(row, "USER"))
        assert g.grantee == "alice"
        assert g.grantee_type == "USER"
        assert g.object_catalog == "default_catalog"
        assert g.object_database == "analytics_db"
        assert g.object_name == "user_events"
        assert g.object_type == "TABLE"
        assert g.privilege_type == "SELECT"
        assert g.is_grantable is True

    def test_lowercase_keys(self):
        row = {
            "grantee": "bob",
            "object_catalog": "cat1",
            "object_database": "db1",
            "object_name": "t1",
            "object_type": "TABLE",
            "privilege_type": "INSERT",
            "is_grantable": "NO",
        }
        g = _single(_row_to_grants(row, "USER"))
        assert g.grantee == "bob"
        assert g.object_catalog == "cat1"
        assert g.privilege_type == "INSERT"
        assert g.is_grantable is False

    def test_comma_separated_privileges(self):
        row = {
            "GRANTEE": "alice",
            "OBJECT_CATALOG": "default_catalog",
            "OBJECT_DATABASE": "db",
            "OBJECT_NAME": "tbl",
            "OBJECT_TYPE": "TABLE",
            "PRIVILEGE_TYPE": "SELECT,INSERT",
            "IS_GRANTABLE": "NO",
        }
        grants = _row_to_grants(row, "USER")
        assert len(grants) == 2
        privs = {g.privilege_type for g in grants}
        assert privs == {"SELECT", "INSERT"}
        # All share the same object info
        for g in grants:
            assert g.object_catalog == "default_catalog"
            assert g.object_database == "db"
            assert g.object_name == "tbl"

    def test_comma_separated_with_spaces(self):
        row = {
            "GRANTEE": "alice",
            "OBJECT_TYPE": "TABLE",
            "PRIVILEGE_TYPE": " SELECT , INSERT , DELETE ",
            "IS_GRANTABLE": "NO",
        }
        grants = _row_to_grants(row, "USER")
        assert len(grants) == 3
        privs = {g.privilege_type for g in grants}
        assert privs == {"SELECT", "INSERT", "DELETE"}

    def test_none_fields(self):
        row = {
            "GRANTEE": "alice",
            "OBJECT_CATALOG": None,
            "OBJECT_DATABASE": None,
            "OBJECT_NAME": None,
            "OBJECT_TYPE": "SYSTEM",
            "PRIVILEGE_TYPE": "GRANT",
            "IS_GRANTABLE": None,
        }
        g = _single(_row_to_grants(row, "ROLE"))
        assert g.object_catalog is None
        assert g.object_database is None
        assert g.object_name is None
        assert g.object_type == "SYSTEM"
        assert g.is_grantable is False  # None → not "YES"

    def test_missing_keys_defaults(self):
        row = {}  # completely empty
        grants = _row_to_grants(row, "USER")
        g = _single(grants)
        assert g.grantee == ""
        assert g.object_catalog is None
        assert g.object_database is None
        assert g.object_name is None
        assert g.object_type == ""
        assert g.privilege_type == ""
        assert g.is_grantable is False

    def test_grantee_type_passed_through(self):
        row = {
            "GRANTEE": "analyst_role",
            "OBJECT_TYPE": "TABLE",
            "PRIVILEGE_TYPE": "SELECT",
            "IS_GRANTABLE": "NO",
        }
        g = _single(_row_to_grants(row, "ROLE"))
        assert g.grantee_type == "ROLE"


# ════════════════════════════════════════════
# _parse_show_grants
# ════════════════════════════════════════════


class TestParseShowGrants:
    """Tests for _parse_show_grants (mocked connection)."""

    @patch("app.services.common.grant_parser.execute_query")
    def test_user_show_grants(self, mock_exec):
        mock_exec.return_value = [
            {
                "Catalog": "default_catalog",
                "Grants": "GRANT SELECT ON TABLE default_catalog.db.tbl TO USER 'alice'",
            }
        ]
        conn = object()  # dummy
        grants = _parse_show_grants(conn, "alice", "USER")
        # Verify the SQL called
        mock_exec.assert_called_once_with(conn, "SHOW GRANTS FOR 'alice'")
        assert len(grants) == 1
        g = grants[0]
        assert g.privilege_type == "SELECT"
        assert g.object_type == "TABLE"
        assert g.object_catalog == "default_catalog"

    @patch("app.services.common.grant_parser.execute_query")
    def test_role_show_grants(self, mock_exec):
        mock_exec.return_value = [
            {
                "Catalog": "default_catalog",
                "Grants": "GRANT SELECT, INSERT ON TABLE default_catalog.db.tbl TO ROLE 'analyst'",
            }
        ]
        conn = object()
        grants = _parse_show_grants(conn, "analyst", "ROLE")
        mock_exec.assert_called_once_with(conn, "SHOW GRANTS FOR ROLE 'analyst'")
        assert len(grants) == 2

    @patch("app.services.common.grant_parser.execute_query")
    def test_user_with_at_sign(self, mock_exec):
        mock_exec.return_value = []
        conn = object()
        _parse_show_grants(conn, "alice@192.168.1.1", "USER")
        # Should use safe_name without quotes for @-containing users
        call_sql = mock_exec.call_args[0][1]
        assert "alice@192.168.1.1" in call_sql
        assert "'" not in call_sql.split("FOR ")[1]  # no quotes around it

    @patch("app.services.common.grant_parser.execute_query")
    def test_catalog_context_fills_missing_catalog(self, mock_exec):
        """When row has Catalog column but parsed grant has no catalog, fill it in."""
        mock_exec.return_value = [
            {
                "Catalog": "hive_catalog",
                "Grants": "GRANT SELECT ON TABLE db.tbl TO USER 'alice'",
            }
        ]
        conn = object()
        grants = _parse_show_grants(conn, "alice", "USER")
        g = _single(grants)
        # The 2-part "db.tbl" for TABLE → database=db, name=tbl, catalog=None
        # Then row_catalog fills it in
        assert g.object_catalog == "hive_catalog"
        assert g.object_database == "db"
        assert g.object_name == "tbl"

    @patch("app.services.common.grant_parser.execute_query")
    def test_catalog_context_not_applied_to_system_types(self, mock_exec):
        """SYSTEM, STORAGE VOLUME, etc. should not get catalog filled."""
        mock_exec.return_value = [
            {
                "Catalog": "default_catalog",
                "Grants": "GRANT USAGE ON STORAGE VOLUME sv1 TO ROLE 'public'",
            }
        ]
        conn = object()
        grants = _parse_show_grants(conn, "public", "ROLE")
        g = _single(grants)
        assert g.object_type == "STORAGE VOLUME"
        assert g.object_catalog is None  # should NOT be filled with default_catalog

    @patch("app.services.common.grant_parser.execute_query")
    def test_catalog_context_not_applied_to_global_function(self, mock_exec):
        mock_exec.return_value = [
            {
                "Catalog": "default_catalog",
                "Grants": "GRANT USAGE ON GLOBAL FUNCTION gfn(INT) TO ROLE 'r'",
            }
        ]
        conn = object()
        grants = _parse_show_grants(conn, "r", "ROLE")
        g = _single(grants)
        assert g.object_type == "GLOBAL FUNCTION"
        assert g.object_catalog is None

    @patch("app.services.common.grant_parser.execute_query")
    def test_execute_query_exception_returns_empty(self, mock_exec):
        mock_exec.side_effect = Exception("connection refused")
        conn = object()
        grants = _parse_show_grants(conn, "alice", "USER")
        assert grants == []

    @patch("app.services.common.grant_parser.execute_query")
    def test_multiple_rows(self, mock_exec):
        mock_exec.return_value = [
            {
                "Catalog": "default_catalog",
                "Grants": "GRANT SELECT ON TABLE default_catalog.db.t1 TO USER 'alice'",
            },
            {
                "Catalog": "default_catalog",
                "Grants": "GRANT INSERT ON TABLE default_catalog.db.t2 TO USER 'alice'",
            },
        ]
        conn = object()
        grants = _parse_show_grants(conn, "alice", "USER")
        assert len(grants) == 2
        assert {g.object_name for g in grants} == {"t1", "t2"}

    @patch("app.services.common.grant_parser.execute_query")
    def test_non_grant_values_in_row_skipped(self, mock_exec):
        """Values that don't start with GRANT should be ignored."""
        mock_exec.return_value = [
            {
                "Catalog": "default_catalog",
                "UserIdentity": "alice",
                "Grants": "GRANT SELECT ON TABLE default_catalog.db.t1 TO USER 'alice'",
            },
        ]
        conn = object()
        grants = _parse_show_grants(conn, "alice", "USER")
        assert len(grants) == 1

    @patch("app.services.common.grant_parser.execute_query")
    def test_lowercase_catalog_key(self, mock_exec):
        """Row with lowercase 'catalog' key should still be recognized."""
        mock_exec.return_value = [
            {
                "catalog": "hive_cat",
                "Grants": "GRANT SELECT ON TABLE db.t TO USER 'alice'",
            },
        ]
        conn = object()
        grants = _parse_show_grants(conn, "alice", "USER")
        g = _single(grants)
        assert g.object_catalog == "hive_cat"
