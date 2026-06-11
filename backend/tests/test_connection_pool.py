"""Unit tests for connection pooling + borrow-time session reset.

Route tests override get_db, so the pooled path is exercised only here (and by
the live integration tests). These cover the logic with mocks.
"""

from __future__ import annotations

from contextlib import contextmanager
from unittest.mock import MagicMock

import app.services.starrocks_client as sc


class _Cursor:
    def __init__(self):
        self.executed: list[str] = []
        self.closed = False

    def execute(self, sql, params=()):
        self.executed.append(sql)

    def close(self):
        self.closed = True


class _Conn:
    def __init__(self):
        self._cur = _Cursor()
        self.closed = False
        self.pinged = False

    def cursor(self, dictionary=False):
        return self._cur

    def ping(self, reconnect=False, attempts=1, delay=0):
        self.pinged = True

    def close(self):
        self.closed = True


# ── _reset_session ──


def test_reset_session_resets_catalog_then_roles():
    conn = _Conn()
    sc._reset_session(conn)
    assert conn._cur.executed == ["SET CATALOG default_catalog", "SET ROLE ALL"]
    assert conn._cur.closed


def test_reset_session_is_non_fatal_on_errors():
    class BadCursor(_Cursor):
        def execute(self, sql, params=()):
            raise PermissionError("denied")

    class C:
        def __init__(self):
            self._cur = BadCursor()

        def cursor(self, dictionary=False):
            return self._cur

    conn = C()
    sc._reset_session(conn)  # must swallow both failures
    assert conn._cur.closed


# ── _get_pool ──


def test_get_pool_caches_per_key(monkeypatch):
    created = []

    def fake_pool(**kw):
        created.append(kw)
        return MagicMock(name=kw.get("pool_name"))

    monkeypatch.setattr(sc.mysql.connector.pooling, "MySQLConnectionPool", fake_pool)
    sc._pools.clear()
    try:
        p1 = sc._get_pool("h", 9030, "u", "p")
        p2 = sc._get_pool("h", 9030, "u", "p")  # same key → cached
        p3 = sc._get_pool("h2", 9030, "u", "p")  # different host → new pool
        assert p1 is p2
        assert p3 is not p1
        assert len(created) == 2
    finally:
        sc._pools.clear()


# ── get_pooled_connection ──


def test_pooled_connection_success_resets_and_returns(monkeypatch):
    conn = _Conn()
    pool = MagicMock()
    pool.get_connection.return_value = conn
    monkeypatch.setattr(sc, "_get_pool", lambda *a: pool)

    with sc.get_pooled_connection("h", 9030, "u", "p") as c:
        assert c is conn
        assert conn.pinged
        assert conn._cur.executed == ["SET CATALOG default_catalog", "SET ROLE ALL"]
    assert conn.closed  # returned to the pool


def test_pooled_connection_falls_back_when_pool_unavailable(monkeypatch):
    direct = _Conn()

    def boom(*a):
        raise RuntimeError("pool exhausted")

    monkeypatch.setattr(sc, "_get_pool", boom)
    monkeypatch.setattr(sc.mysql.connector, "connect", lambda **k: direct)

    with sc.get_pooled_connection("h", 9030, "u", "p") as c:
        assert c is direct
        assert direct._cur.executed == ["SET CATALOG default_catalog", "SET ROLE ALL"]
    assert direct.closed


def test_pooled_connection_recovers_from_stale_connection(monkeypatch):
    stale = _Conn()

    def bad_ping(*a, **k):
        raise ConnectionError("server gone")

    stale.ping = bad_ping
    pool = MagicMock()
    pool.get_connection.return_value = stale
    direct = _Conn()
    monkeypatch.setattr(sc, "_get_pool", lambda *a: pool)
    monkeypatch.setattr(sc.mysql.connector, "connect", lambda **k: direct)

    with sc.get_pooled_connection("h", 9030, "u", "p") as c:
        assert c is direct
    assert stale.closed  # stale borrowed connection was closed
    assert direct.closed


# ── parallel_queries borrows from the pool ──


def test_parallel_queries_uses_pooled_connection(monkeypatch):
    conn = _Conn()

    @contextmanager
    def fake_pooled(*a):
        yield conn

    monkeypatch.setattr(sc, "get_pooled_connection", fake_pooled)
    creds = {"host": "h", "port": 9030, "username": "u", "password": "p"}
    result = sc.parallel_queries(creds, [("k", lambda c: "ok")])
    assert result == {"k": "ok"}


# ── get_db dependency ──


def test_get_db_yields_pooled_connection(monkeypatch):
    import app.dependencies as deps

    conn = _Conn()

    @contextmanager
    def fake_pooled(host, port, username, password):
        yield conn

    monkeypatch.setattr(deps, "get_pooled_connection", fake_pooled)
    gen = deps.get_db({"host": "h", "port": 9030, "username": "u", "password": "p"})
    assert next(gen) is conn
    gen.close()
