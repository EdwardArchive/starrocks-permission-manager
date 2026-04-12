"""Tests for app/services/starrocks_client.py.

Covers: execute_query, execute_single, get_connection, test_connection.
Uses FakeConnection from conftest for query tests and unittest.mock for connection tests.
"""
from __future__ import annotations

from unittest.mock import MagicMock, patch

from tests.conftest import FakeConnection
import app.services.starrocks_client as sc_module

execute_query = sc_module.execute_query
execute_single = sc_module.execute_single
get_connection = sc_module.get_connection
_test_connection = sc_module.test_connection


def test_execute_query_basic():
    """execute_query returns list of dicts from FakeConnection."""
    qmap = {"SELECT 1": [{"val": 1}]}
    conn = FakeConnection(qmap)
    result = execute_query(conn, "SELECT 1")
    assert result == [{"val": 1}]


def test_execute_query_empty():
    """execute_query returns empty list when no rows match."""
    conn = FakeConnection({})
    result = execute_query(conn, "SELECT * FROM nonexistent")
    assert result == []


def test_execute_query_with_params():
    """Params are passed through to cursor.execute (FakeCursor ignores them but no error)."""
    qmap = {"SELECT * FROM t WHERE id": [{"id": 42}]}
    conn = FakeConnection(qmap)
    result = execute_query(conn, "SELECT * FROM t WHERE id = %s", (42,))
    assert result == [{"id": 42}]


def test_execute_single_returns_first():
    """execute_single returns the first row when multiple rows exist."""
    qmap = {"SELECT": [{"a": 1}, {"a": 2}, {"a": 3}]}
    conn = FakeConnection(qmap)
    result = execute_single(conn, "SELECT * FROM t")
    assert result == {"a": 1}


def test_execute_single_empty():
    """execute_single returns None when no rows match."""
    conn = FakeConnection({})
    result = execute_single(conn, "SELECT * FROM nonexistent")
    assert result is None


@patch("app.services.starrocks_client.mysql.connector.connect")
def test_test_connection_success(mock_connect):
    """test_connection returns True when connect succeeds."""
    mock_conn = MagicMock()
    mock_cursor = MagicMock()
    mock_cursor.fetchall.return_value = [{"1": 1}]
    mock_conn.cursor.return_value = mock_cursor
    mock_connect.return_value = mock_conn
    # get_connection is a context manager, need to handle __enter__/__exit__
    mock_conn.__enter__ = MagicMock(return_value=mock_conn)
    mock_conn.__exit__ = MagicMock(return_value=False)

    result = _test_connection("host", 9030, "user", "pass")
    assert result is True
    mock_connect.assert_called_once()


@patch("app.services.starrocks_client.mysql.connector.connect")
def test_check_connection_failure(mock_connect):
    """test_connection returns False when connect raises."""
    mock_connect.side_effect = Exception("Connection refused")
    result = _test_connection("host", 9030, "user", "pass")
    assert result is False


@patch("app.services.starrocks_client.mysql.connector.connect")
def test_get_connection_context_manager(mock_connect):
    """get_connection yields a connection and closes it on exit."""
    mock_conn = MagicMock()
    mock_connect.return_value = mock_conn

    with get_connection("host", 9030, "user", "pass") as conn:
        assert conn is mock_conn
    mock_conn.close.assert_called_once()
