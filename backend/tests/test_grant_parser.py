"""Unit tests for app.services.common.grant_parser."""

from __future__ import annotations

from app.services.common.grant_parser import _parse_grant_statement, _parse_show_grants, _row_to_grants
from tests.conftest import FakeConnection


# ── _parse_grant_statement tests ──


def test_simple_table_2part_path():
    """Simple TABLE with 2-part path."""
    grants = _parse_grant_statement(
        "GRANT SELECT ON TABLE analytics_db.user_events TO 'admin'",
        "admin",
        "USER",
    )
    assert len(grants) == 1
    g = grants[0]
    assert g.object_type == "TABLE"
    assert g.object_database == "analytics_db"
    assert g.object_name == "user_events"
    assert g.object_catalog is None
    assert g.privilege_type == "SELECT"


def test_3part_path():
    """3-part path: catalog.database.name."""
    grants = _parse_grant_statement(
        "GRANT SELECT ON TABLE default_catalog.analytics_db.user_events TO 'admin'",
        "admin",
        "USER",
    )
    assert len(grants) == 1
    g = grants[0]
    assert g.object_catalog == "default_catalog"
    assert g.object_database == "analytics_db"
    assert g.object_name == "user_events"


def test_all_tables_in_database():
    """ALL TABLES IN DATABASE."""
    grants = _parse_grant_statement(
        "GRANT SELECT ON ALL TABLES IN DATABASE analytics_db TO 'admin'",
        "admin",
        "USER",
    )
    assert len(grants) == 1
    g = grants[0]
    assert g.object_type == "TABLE"
    assert g.object_database == "analytics_db"
    assert g.object_name is None


def test_all_tables_in_all_databases():
    """ALL TABLES IN ALL DATABASES."""
    grants = _parse_grant_statement(
        "GRANT SELECT ON ALL TABLES IN ALL DATABASES TO 'admin'",
        "admin",
        "USER",
    )
    assert len(grants) == 1
    g = grants[0]
    assert g.object_type == "TABLE"
    assert g.object_database is None
    assert g.object_name is None


def test_storage_volume():
    """Multi-word STORAGE VOLUME."""
    grants = _parse_grant_statement(
        "GRANT USAGE ON STORAGE VOLUME my_volume TO 'admin'",
        "admin",
        "USER",
    )
    assert len(grants) == 1
    g = grants[0]
    assert g.object_type == "STORAGE VOLUME"
    assert g.object_name == "my_volume"


def test_materialized_view():
    """Multi-word MATERIALIZED VIEW."""
    grants = _parse_grant_statement(
        "GRANT SELECT ON MATERIALIZED VIEW analytics_db.hourly_agg TO 'admin'",
        "admin",
        "USER",
    )
    assert len(grants) == 1
    g = grants[0]
    assert g.object_type == "MATERIALIZED VIEW"
    assert g.object_database == "analytics_db"
    assert g.object_name == "hourly_agg"


def test_database_1part_path():
    """DATABASE 1-part path: X is database, not catalog."""
    grants = _parse_grant_statement(
        "GRANT CREATE TABLE ON DATABASE analytics_db TO 'admin'",
        "admin",
        "USER",
    )
    assert len(grants) == 1
    g = grants[0]
    assert g.object_type == "DATABASE"
    assert g.object_database == "analytics_db"
    assert g.object_catalog is None


def test_multiple_privileges():
    """Multiple privileges: comma-separated -> multiple PrivilegeGrant objects."""
    grants = _parse_grant_statement(
        "GRANT SELECT, INSERT, DELETE ON TABLE db.tbl TO 'admin'",
        "admin",
        "USER",
    )
    assert len(grants) == 3
    privs = {g.privilege_type for g in grants}
    assert privs == {"SELECT", "INSERT", "DELETE"}
    for g in grants:
        assert g.object_database == "db"
        assert g.object_name == "tbl"


def test_global_function_with_signature():
    """GLOBAL FUNCTION with signature preserves full path."""
    grants = _parse_grant_statement(
        "GRANT USAGE ON GLOBAL FUNCTION gfn_mask(VARCHAR(65533)) TO 'admin'",
        "admin",
        "USER",
    )
    assert len(grants) == 1
    g = grants[0]
    assert g.object_type == "GLOBAL FUNCTION"
    assert g.object_name == "gfn_mask(VARCHAR(65533))"


def test_wildcard_path():
    """Wildcard path *.*.* -> all None."""
    grants = _parse_grant_statement(
        "GRANT SELECT ON TABLE *.*.* TO 'admin'",
        "admin",
        "USER",
    )
    assert len(grants) == 1
    g = grants[0]
    assert g.object_catalog is None
    assert g.object_database is None
    assert g.object_name is None


def test_no_match_revoke():
    """No match (REVOKE) -> empty list."""
    grants = _parse_grant_statement(
        "REVOKE SELECT FROM role1",
        "role1",
        "ROLE",
    )
    assert grants == []


def test_masking_policy():
    """MASKING POLICY -> object_type='POLICY'."""
    grants = _parse_grant_statement(
        "GRANT USAGE ON MASKING POLICY db.my_policy TO 'admin'",
        "admin",
        "USER",
    )
    assert len(grants) == 1
    g = grants[0]
    assert g.object_type == "POLICY"


# ── _row_to_grants tests ──


def test_row_to_grants_basic():
    """Basic row conversion with IS_GRANTABLE=YES."""
    row = {
        "GRANTEE": "user1",
        "OBJECT_TYPE": "TABLE",
        "OBJECT_CATALOG": "default_catalog",
        "OBJECT_DATABASE": "db1",
        "OBJECT_NAME": "tbl1",
        "PRIVILEGE_TYPE": "SELECT",
        "IS_GRANTABLE": "YES",
    }
    grants = _row_to_grants(row, "USER")
    assert len(grants) == 1
    g = grants[0]
    assert g.grantee == "user1"
    assert g.grantee_type == "USER"
    assert g.is_grantable is True
    assert g.privilege_type == "SELECT"
    assert g.object_type == "TABLE"


def test_row_to_grants_comma_split():
    """Comma-separated PRIVILEGE_TYPE -> multiple grants."""
    row = {
        "GRANTEE": "user1",
        "OBJECT_TYPE": "TABLE",
        "OBJECT_CATALOG": None,
        "OBJECT_DATABASE": "db1",
        "OBJECT_NAME": "tbl1",
        "PRIVILEGE_TYPE": "SELECT,INSERT",
        "IS_GRANTABLE": "NO",
    }
    grants = _row_to_grants(row, "USER")
    assert len(grants) == 2
    privs = {g.privilege_type for g in grants}
    assert privs == {"SELECT", "INSERT"}
    assert all(g.is_grantable is False for g in grants)


# ── _parse_show_grants tests ──


def test_parse_show_grants_user_with_catalog_context():
    """USER path with catalog context: row's Catalog column fills in catalog."""
    query_map = {
        "SHOW GRANTS FOR": [
            {
                "Catalog": "default_catalog",
                "GrantPrivilege": "GRANT SELECT ON TABLE analytics_db.user_events TO 'testuser'",
            },
        ],
    }
    conn = FakeConnection(query_map)
    grants = _parse_show_grants(conn, "testuser", "USER")
    assert len(grants) == 1
    g = grants[0]
    assert g.object_catalog == "default_catalog"
    assert g.object_database == "analytics_db"
    assert g.object_name == "user_events"


def test_parse_show_grants_exception_returns_empty():
    """Exception handling: connection raises -> returns empty list."""

    class BrokenConnection:
        def cursor(self, dictionary=False):
            raise RuntimeError("connection lost")

    conn = BrokenConnection()
    grants = _parse_show_grants(conn, "testuser", "USER")
    assert grants == []
