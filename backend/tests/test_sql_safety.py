"""Unit tests for SQL safety utilities."""
from __future__ import annotations

import pytest

from app.utils.sql_safety import safe_identifier, safe_name


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


class TestSafeIdentifier:
    def test_normal_name(self):
        assert safe_identifier("analytics_db") == "analytics_db"

    def test_escapes_backtick(self):
        assert safe_identifier("db`name") == "db``name"

    def test_escapes_multiple_backticks(self):
        assert safe_identifier("a`b`c") == "a``b``c"

    def test_empty_string(self):
        assert safe_identifier("") == ""
