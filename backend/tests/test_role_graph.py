"""Unit tests for shared role graph helpers."""

from __future__ import annotations

from app.services.shared.role_graph import fetch_role_child_map, fetch_user_role_map

_CHILD_KEY = "SELECT FROM_ROLE, TO_ROLE FROM sys.role_edges WHERE TO_ROLE"
_USER_KEY = "SELECT FROM_ROLE, TO_USER FROM sys.role_edges WHERE TO_USER"


class _RaisingConn:
    """Connection whose cursor() raises, to exercise the except fallback."""

    def cursor(self, dictionary=False):
        raise RuntimeError("boom")


# ── fetch_role_child_map ──


def test_child_map_normal(mock_db, query_map):
    query_map[_CHILD_KEY] = [
        {"FROM_ROLE": "root", "TO_ROLE": "db_admin"},
        {"FROM_ROLE": "root", "TO_ROLE": "user_admin"},
        {"FROM_ROLE": "db_admin", "TO_ROLE": "analyst_role"},
    ]
    result = fetch_role_child_map(mock_db)
    assert result == {
        "root": ["db_admin", "user_admin"],
        "db_admin": ["analyst_role"],
    }


def test_child_map_skips_empty_and_null(mock_db, query_map):
    query_map[_CHILD_KEY] = [
        {"FROM_ROLE": "root", "TO_ROLE": "db_admin"},
        {"FROM_ROLE": "", "TO_ROLE": "orphan"},
        {"FROM_ROLE": "root", "TO_ROLE": None},
    ]
    result = fetch_role_child_map(mock_db)
    assert result == {"root": ["db_admin"]}


def test_child_map_preserves_duplicate_edges(mock_db, query_map):
    # No dedup: duplicate edges accumulate — pins current behavior.
    query_map[_CHILD_KEY] = [
        {"FROM_ROLE": "root", "TO_ROLE": "db_admin"},
        {"FROM_ROLE": "root", "TO_ROLE": "db_admin"},
    ]
    result = fetch_role_child_map(mock_db)
    assert result == {"root": ["db_admin", "db_admin"]}


def test_child_map_empty_when_no_rows(mock_db):
    # Default map has no matching key → empty mapping.
    assert fetch_role_child_map(mock_db) == {}


def test_child_map_empty_on_error():
    assert fetch_role_child_map(_RaisingConn()) == {}


# ── fetch_user_role_map ──


def test_user_role_map_normal(mock_db):
    # Default map seeds SELECT FROM_ROLE, TO_USER ... rows.
    result = fetch_user_role_map(mock_db)
    assert result["analyst_kim"] == ["analyst_role", "public"]
    assert result["test_admin"] == ["root", "public"]


def test_user_role_map_empty_when_no_rows(mock_db, query_map):
    query_map[_USER_KEY] = []
    assert fetch_user_role_map(mock_db) == {}


def test_user_role_map_empty_on_error():
    assert fetch_user_role_map(_RaisingConn()) == {}
