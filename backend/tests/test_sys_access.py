"""Unit tests for app.utils.sys_access — is_access_denied() and can_access_sys()."""

from __future__ import annotations

from unittest.mock import MagicMock

import mysql.connector.errors
import pytest

from app.utils.sys_access import is_access_denied, can_access_sys


# ── is_access_denied ──


class TestIsAccessDenied:
    """Tests for the is_access_denied() helper."""

    @pytest.mark.parametrize("errno", [1044, 1045, 1142, 1227])
    def test_known_access_denied_errnos_return_true(self, errno):
        """Standard MySQL access-denied errnos must all return True."""
        exc = mysql.connector.errors.ProgrammingError(
            msg="Access denied for user 'x'@'localhost'",
            errno=errno,
        )
        assert is_access_denied(exc) is True

    def test_errno_none_with_access_denied_message_returns_true(self):
        """When errno is absent but the message contains 'Access denied', return True."""
        exc = mysql.connector.errors.ProgrammingError(
            msg="Access denied for user 'x'@'%' to database 'sys'",
            errno=None,
        )
        assert is_access_denied(exc) is True

    def test_errno_none_with_unrelated_message_returns_false(self):
        """errno=None and no 'Access denied' substring → False."""
        exc = mysql.connector.errors.ProgrammingError(
            msg="Syntax error near 'SLECT'",
            errno=None,
        )
        assert is_access_denied(exc) is False

    def test_unknown_errno_returns_false(self):
        """An unrecognised errno (not in ACCESS_DENIED_ERRNOS) → False."""
        exc = mysql.connector.errors.ProgrammingError(
            msg="some other error",
            errno=9999,
        )
        assert is_access_denied(exc) is False

    def test_value_error_without_errno_returns_false(self):
        """Non-mysql exception without errno attribute → False (no AttributeError)."""
        exc = ValueError("nothing")
        assert is_access_denied(exc) is False

    def test_plain_exception_without_errno_returns_false(self):
        """Generic Exception without errno → False."""
        exc = Exception("nothing")
        assert is_access_denied(exc) is False


# ── can_access_sys ──


def _make_execute_query_side_effect(fail_on: str):
    """Return a fake execute_query that raises ProgrammingError when SQL contains `fail_on`."""
    def _fake(conn, sql, params=None):
        if fail_on in sql:
            raise mysql.connector.errors.ProgrammingError(
                msg=f"SELECT command denied to user for table '{fail_on}'",
                errno=1142,
            )
        return [{"1": 1}]
    return _fake


class TestCanAccessSys:
    """Tests for the can_access_sys() helper.

    We monkeypatch `app.utils.sys_access.execute_query` at the module level
    so the function under test uses our fake rather than a real DB call.
    """

    def test_all_queries_succeed_returns_true(self, monkeypatch):
        """When every query succeeds, the user has full sys access → True."""
        def _ok(conn, sql, params=None):
            return [{"1": 1}]

        monkeypatch.setattr("app.utils.sys_access.execute_query", _ok)
        assert can_access_sys(MagicMock()) is True

    def test_set_role_all_fails_but_queries_succeed_returns_true(self, monkeypatch):
        """SET ROLE ALL failure is non-fatal; if all table queries pass → True."""
        def _fail_set_role(conn, sql, params=None):
            if sql.strip().upper().startswith("SET ROLE"):
                raise mysql.connector.errors.ProgrammingError(
                    msg="SET ROLE not allowed",
                    errno=1227,
                )
            return [{"1": 1}]

        monkeypatch.setattr("app.utils.sys_access.execute_query", _fail_set_role)
        assert can_access_sys(MagicMock()) is True

    def test_role_edges_failure_returns_false(self, monkeypatch):
        """Failure on sys.role_edges query → False."""
        monkeypatch.setattr(
            "app.utils.sys_access.execute_query",
            _make_execute_query_side_effect("sys.role_edges"),
        )
        assert can_access_sys(MagicMock()) is False

    def test_grants_to_users_failure_returns_false(self, monkeypatch):
        """Failure on sys.grants_to_users query → False."""
        monkeypatch.setattr(
            "app.utils.sys_access.execute_query",
            _make_execute_query_side_effect("sys.grants_to_users"),
        )
        assert can_access_sys(MagicMock()) is False

    def test_grants_to_roles_failure_returns_false(self, monkeypatch):
        """Failure on sys.grants_to_roles query → False."""
        monkeypatch.setattr(
            "app.utils.sys_access.execute_query",
            _make_execute_query_side_effect("sys.grants_to_roles"),
        )
        assert can_access_sys(MagicMock()) is False

    def test_show_roles_failure_returns_false(self, monkeypatch):
        """Failure on SHOW ROLES query → False."""
        def _fail_show_roles(conn, sql, params=None):
            if sql.strip().upper().startswith("SHOW ROLES"):
                raise mysql.connector.errors.ProgrammingError(
                    msg="SHOW ROLES denied",
                    errno=1044,
                )
            return [{"1": 1}]

        monkeypatch.setattr("app.utils.sys_access.execute_query", _fail_show_roles)
        assert can_access_sys(MagicMock()) is False
