"""Integration tests for the global mysql_error_handler in main.py.

Strategy: monkeypatch an existing route's underlying function to raise a
mysql.connector.errors.ProgrammingError, then call that route and verify
the HTTP status and response body produced by the exception handler.

We use GET /api/auth/me because:
  - it requires only a valid auth header (no body)
  - it calls `get_user_roles` → easy to intercept at the router function level
"""

from __future__ import annotations

import mysql.connector.errors
import pytest


class TestMysqlErrorHandler:
    """Tests for the global mysql_error_handler exception handler."""

    def test_mysql_error_handler_maps_1044_to_403(self, client, auth_header, monkeypatch):
        """errno 1044 (DB access denied) → HTTP 403 with standard detail."""
        import app.routers.auth as auth_mod

        def _raise(*args, **kwargs):
            raise mysql.connector.errors.ProgrammingError(
                msg="Access denied for user 'x'@'%' to database 'sys'",
                errno=1044,
            )

        monkeypatch.setattr(auth_mod, "get_user_roles", _raise)

        resp = client.get("/api/auth/me", headers=auth_header)
        assert resp.status_code == 403
        detail = resp.json()["detail"]
        assert "Insufficient database privileges" in detail

    def test_mysql_error_handler_maps_1227_to_403(self, client, auth_header, monkeypatch):
        """errno 1227 (SYSTEM op denied) → HTTP 403 with standard detail."""
        import app.routers.auth as auth_mod

        def _raise(*args, **kwargs):
            raise mysql.connector.errors.ProgrammingError(
                msg="Access denied; you need (at least one of) the SUPER privilege(s) for this operation",
                errno=1227,
            )

        monkeypatch.setattr(auth_mod, "get_user_roles", _raise)

        resp = client.get("/api/auth/me", headers=auth_header)
        assert resp.status_code == 403
        detail = resp.json()["detail"]
        assert "Insufficient database privileges" in detail

    def test_mysql_error_handler_maps_unknown_errno_to_500(self, client, auth_header, monkeypatch):
        """An unrecognised errno (not in ACCESS_DENIED_ERRNOS) → HTTP 500, detail='Database error'."""
        import app.routers.auth as auth_mod

        def _raise(*args, **kwargs):
            raise mysql.connector.errors.ProgrammingError(
                msg="Some completely unrelated database error",
                errno=9999,
            )

        monkeypatch.setattr(auth_mod, "get_user_roles", _raise)

        resp = client.get("/api/auth/me", headers=auth_header)
        assert resp.status_code == 500
        assert resp.json()["detail"] == "Database error"
