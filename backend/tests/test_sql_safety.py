"""Unit tests for SQL safety utilities."""
from __future__ import annotations

import pytest
from app.utils.sql_safety import restore_default_catalog, safe_identifier, safe_name, set_catalog


class TestSafeName:
    def test_valid_simple(self):
        assert safe_name("admin") == "admin"

    def test_valid_with_underscore(self):
        assert safe_name("db_admin") == "db_admin"

    def test_valid_with_at(self):
        assert safe_name("'root'@'%'") == "'root'@'%'"

    def test_rejects_semicolon(self):
        with pytest.raises(ValueError):
            safe_name("admin'; DROP TABLE users; --")

    def test_rejects_backtick(self):
        with pytest.raises(ValueError):
            safe_name("admin`")

    def test_rejects_empty(self):
        with pytest.raises(ValueError):
            safe_name("")

    def test_rejects_newline(self):
        with pytest.raises(ValueError):
            safe_name("admin\n")

    def test_rejects_parentheses(self):
        with pytest.raises(ValueError):
            safe_name("admin()")

    def test_valid_with_hyphen_and_dot(self):
        assert safe_name("analyst-role") == "analyst-role"
        assert safe_name("my.role") == "my.role"

    def test_rejects_quote_breakout(self):
        # The core fix: a bare value carrying a quote must not pass and break
        # out of SHOW GRANTS FOR '<value>'.
        with pytest.raises(ValueError):
            safe_name("kate'@'%")

    def test_rejects_embedded_quote_in_bare_name(self):
        with pytest.raises(ValueError):
            safe_name("ka'te")

    def test_rejects_unbalanced_quoted_form(self):
        # Looks like the user@host form but the inner part smuggles a quote.
        with pytest.raises(ValueError):
            safe_name("'a''b'@'%'")


class TestSafeIdentifier:
    def test_normal_name(self):
        assert safe_identifier("analytics_db") == "analytics_db"

    def test_escapes_backtick(self):
        assert safe_identifier("db`name") == "db``name"

    def test_escapes_multiple_backticks(self):
        assert safe_identifier("a`b`c") == "a``b``c"

    def test_empty_string(self):
        assert safe_identifier("") == ""


class _RecordingCursor:
    """Cursor stub that records executed SQL text and returns no rows."""

    def __init__(self, log: list[str]):
        self._log = log

    def execute(self, sql: str, params: tuple = ()):
        self._log.append(sql)

    def fetchall(self) -> list:
        return []

    def close(self):
        pass


class _RecordingConn:
    """Connection stub whose cursor records the SQL the helpers emit."""

    def __init__(self):
        self.executed: list[str] = []

    def cursor(self, dictionary: bool = False):
        return _RecordingCursor(self.executed)


class TestSetCatalog:
    def test_normal_name_emits_backtick_quoted(self):
        conn = _RecordingConn()
        set_catalog(conn, "analytics_db")
        assert conn.executed == ["SET CATALOG `analytics_db`"]

    def test_backtick_in_name_is_escaped(self):
        # safe_identifier doubles backticks rather than rejecting the name.
        conn = _RecordingConn()
        set_catalog(conn, "we`ird")
        assert conn.executed == ["SET CATALOG `we``ird`"]


class TestRestoreDefaultCatalog:
    def test_emits_default_catalog_statement(self):
        conn = _RecordingConn()
        restore_default_catalog(conn)
        assert conn.executed == ["SET CATALOG `default_catalog`"]
