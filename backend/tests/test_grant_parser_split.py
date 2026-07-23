"""Pins for the Phase 3.7/3.8 refactor:

- the four helpers `_parse_grant_statement` was split into (Task 3.8),
- the shared `iter_grant_statements` row-walk (Task 3.7), and
- `sys_collector.fetch_role_grants_raw` extracted from the admin router (Task C),
  plus the `parse_role_assignments` error path it shares the row-walk with.

Behavioral parity of the public `_parse_grant_statement` output is already
guarded by test_grant_parser.py; these are unit-level contracts for the seams.
"""

from __future__ import annotations

from app.services.admin.sys_collector import fetch_role_grants_raw
from app.services.common.grant_parser import (
    _apply_scope_overrides,
    _normalize_object_type,
    _parse_on_clause,
    _split_object_path,
    iter_grant_statements,
)
from app.utils.role_helpers import parse_role_assignments

from tests.conftest import FakeConnection

# ── Task 3.8: helper seams ──


def test_parse_on_clause_all_in_database():
    """ALL TABLES IN DATABASE → raw (still-plural) obj_type + scoped_database, empty path.

    The plural "TABLES" is singularized downstream by _normalize_object_type
    (substring "TABLE"), so the seam intentionally returns the un-normalized token.
    """
    assert _parse_on_clause("ALL TABLES IN DATABASE analytics_db") == ("TABLES", "", "analytics_db")


def test_parse_on_clause_multi_word_type():
    """Multi-word type is detected before the generic type/path regex."""
    assert _parse_on_clause("STORAGE VOLUME my_volume") == ("STORAGE VOLUME", "my_volume", None)


def test_normalize_object_type_policy_and_alias():
    """Masking → POLICY; bare FAILOVER aliases to FAILOVER GROUP; known types pass through."""
    assert _normalize_object_type("MASKING POLICY") == "POLICY"
    assert _normalize_object_type("FAILOVER") == "FAILOVER GROUP"
    assert _normalize_object_type("TABLE") == "TABLE"


def test_split_object_path_2part_divergence():
    """2-part path resolves as database.name for object-level types, catalog.database otherwise."""
    assert _split_object_path("TABLE", "analytics_db.user_events") == (None, "analytics_db", "user_events")
    assert _split_object_path("CATALOG", "cat.db") == ("cat", "db", None)


def test_split_object_path_wildcards_become_none():
    assert _split_object_path("TABLE", "*.*.*") == (None, None, None)


def test_apply_scope_overrides_cases():
    """scoped_database, ON DATABASE X, and system-object path→name overrides."""
    assert _apply_scope_overrides("TABLE", "", None, None, None, "analytics_db") == (None, "analytics_db", None)
    assert _apply_scope_overrides("DATABASE", "analytics_db", "analytics_db", None, None, None) == (
        None,
        "analytics_db",
        None,
    )
    assert _apply_scope_overrides("STORAGE VOLUME", "my_volume", "my_volume", None, None, None) == (
        None,
        None,
        "my_volume",
    )


# ── Task 3.7: shared raw row-walk ──


def test_iter_grant_statements_yields_only_grant_cells_with_row():
    rows = [
        {"Catalog": "default_catalog", "Grants": "GRANT SELECT ON TABLE db.t TO 'u'"},
        {"Catalog": None, "Other": "REVOKE SELECT ON TABLE db.t FROM 'u'"},
    ]
    assert list(iter_grant_statements(rows)) == [(rows[0], "GRANT SELECT ON TABLE db.t TO 'u'")]


def test_parse_role_assignments_swallows_query_error():
    """SHOW GRANTS raising → parse_role_assignments returns [] (error path)."""
    conn = FakeConnection({}, fail_prefixes={"SHOW GRANTS FOR": RuntimeError("boom")})
    assert parse_role_assignments(conn, "analyst_role", "ROLE") == []


# ── Task C: sys_collector.fetch_role_grants_raw ──


def test_fetch_role_grants_raw_success():
    sys_row = {"GRANTEE": "analyst_role", "PRIVILEGE_TYPE": "SELECT", "OBJECT_TYPE": "TABLE"}
    show_row = {"Grants": "GRANT SELECT ON TABLE db.t TO ROLE 'analyst_role'"}
    conn = FakeConnection(
        {
            "SELECT * FROM sys.grants_to_roles WHERE GRANTEE": [sys_row],
            "SHOW GRANTS FOR ROLE": [show_row],
        }
    )
    out = fetch_role_grants_raw(conn, "analyst_role")
    assert out["sys_grants_to_roles"] == [sys_row]
    assert out["show_grants"] == [show_row]
    assert "sys_grants_to_roles_error" not in out
    assert "show_grants_error" not in out


def test_fetch_role_grants_raw_errors_captured():
    conn = FakeConnection(
        {},
        fail_prefixes={
            "SELECT * FROM sys.grants_to_roles": RuntimeError("denied sys"),
            "SHOW GRANTS FOR ROLE": RuntimeError("denied show"),
        },
    )
    out = fetch_role_grants_raw(conn, "analyst_role")
    assert out["sys_grants_to_roles"] == []
    assert out["show_grants"] == []
    assert out["sys_grants_to_roles_error"] == "denied sys"
    assert out["show_grants_error"] == "denied show"
