"""Tests for GET /api/cluster/queries and the cluster_queries service.

Fixture rows mirror the exact shapes captured from a live StarRocks 4.0.8
cluster (SHOW PROC '/current_queries' + SHOW FULL PROCESSLIST).
"""

from __future__ import annotations

import mysql.connector.errors
import pytest

from app.services.cluster_queries import parse_duration_ms, parse_row_count

from tests.conftest import DEFAULT_QUERY_MAP

CURRENT_QUERY_ROW = {
    "StartTime": "2026-06-12 01:24:32",
    "feIp": "starrocks-oss-fe-2.starrocks-oss-fe-search.starrocks-oss.svc.cluster.local",
    "QueryId": "019eb77f-e2a6-794c-aab1-00e0ac3d0036",
    "ConnectionId": "50335321",
    "Database": "",
    "User": "root",
    "ScanBytes": "13.319 GB",
    "ScanRows": "1787602878 rows",
    "MemoryUsage": "459.154 MB",
    "DiskSpillSize": "0.000 B",
    "CPUTime": "0.478 s",
    "ExecTime": "2.126 s",
    "ExecProgress": "",
    "ExecState": "RUNNING",
    "Warehouse": "default_warehouse",
    "CustomQueryId": "",
    "ResourceGroup": "default_wg",
}

PROCESSLIST_ROW = {
    "ServerName": "starrocks-oss-fe-2.starrocks-oss-fe-search.starrocks-oss.svc.cluster.local_9010_1",
    "Id": 50335321,  # connector returns ints
    "User": "root",
    "Host": "10.16.5.200:47334",
    "Db": "",
    "Command": "Query",
    "ConnectionStartTime": "2026-06-12 01:22:24",
    "Time": 3,
    "State": "OK",
    "Info": "SELECT count(*) FROM capacity_test.transaction_log WHERE txn_id % 7 = 3",
    "IsPending": "false",
    "Warehouse": "default_warehouse",
    "CNGroup": "",
    "Catalog": None,
    "QueryId": None,
}

# Idle connection — no Info, must not break the join
IDLE_PROCESSLIST_ROW = {**PROCESSLIST_ROW, "Id": 16780544, "Command": "Sleep", "Info": None}


@pytest.fixture()
def query_map():
    qm = dict(DEFAULT_QUERY_MAP)
    qm["SHOW PROC '/current_queries'"] = [CURRENT_QUERY_ROW]
    qm["SHOW FULL PROCESSLIST"] = [PROCESSLIST_ROW, IDLE_PROCESSLIST_ROW]
    qm["SELECT NOW()"] = [{"server_now": "2026-06-12 01:25:04"}]
    return qm


# ── Happy path: join + numeric parsing ──

def test_queries_happy_path(client, auth_header):
    resp = client.get("/api/cluster/queries", headers=auth_header)
    assert resp.status_code == 200
    data = resp.json()

    assert data["server_now"] == "2026-06-12 01:25:04"
    assert len(data["queries"]) == 1
    q = data["queries"][0]

    assert q["query_id"] == "019eb77f-e2a6-794c-aab1-00e0ac3d0036"
    assert q["connection_id"] == 50335321
    assert q["user"] == "root"
    assert q["exec_state"] == "RUNNING"
    assert q["warehouse"] == "default_warehouse"
    assert q["resource_group"] == "default_wg"
    # Empty-string fields are normalized to None
    assert q["database"] is None
    assert q["exec_progress"] is None

    # SQL text joined from SHOW FULL PROCESSLIST via ConnectionId
    assert q["sql"].startswith("SELECT count(*) FROM capacity_test")

    # Numeric sort keys parsed from human-readable strings
    assert q["scan_rows"] == 1787602878
    assert q["scan_bytes"] == pytest.approx(13.319 * 1024**3)
    assert q["memory_bytes"] == pytest.approx(459.154 * 1024**2)
    assert q["spill_bytes"] == pytest.approx(0.0)
    assert q["cpu_time_ms"] == pytest.approx(478.0)
    assert q["exec_time_ms"] == pytest.approx(2126.0)

    # Raw display strings preserved
    assert q["scan_bytes_display"] == "13.319 GB"
    assert q["memory_display"] == "459.154 MB"
    assert q["exec_time_display"] == "2.126 s"


def test_queries_no_processlist_match(client, auth_header, query_map):
    """Connection already gone from the processlist → sql stays None."""
    query_map["SHOW FULL PROCESSLIST"] = [IDLE_PROCESSLIST_ROW]
    resp = client.get("/api/cluster/queries", headers=auth_header)
    assert resp.status_code == 200
    q = resp.json()["queries"][0]
    assert q["sql"] is None
    assert q["query_id"] == "019eb77f-e2a6-794c-aab1-00e0ac3d0036"


def test_queries_processlist_failure_is_tolerated(client, auth_header, monkeypatch):
    """SHOW FULL PROCESSLIST failing must not break the endpoint."""
    import app.services.cluster_queries as cq

    original = cq.execute_query

    def _fail_processlist(conn, sql, params=None):
        if "PROCESSLIST" in sql.upper():
            raise mysql.connector.errors.DatabaseError(msg="boom", errno=1064)
        return original(conn, sql, params)

    monkeypatch.setattr(cq, "execute_query", _fail_processlist)
    resp = client.get("/api/cluster/queries", headers=auth_header)
    assert resp.status_code == 200
    q = resp.json()["queries"][0]
    assert q["sql"] is None


def test_queries_empty(client, auth_header, query_map):
    query_map["SHOW PROC '/current_queries'"] = []
    resp = client.get("/api/cluster/queries", headers=auth_header)
    assert resp.status_code == 200
    assert resp.json()["queries"] == []


# ── Permission: access denied maps to 403 via the global handler ──

def test_queries_access_denied_returns_403(client, auth_header, monkeypatch):
    import app.services.cluster_queries as cq

    err = mysql.connector.errors.ProgrammingError(
        msg="Access denied; you need (at least one of) the OPERATE privilege(s)",
        errno=1227,
    )

    def _deny(conn, sql, params=None):
        raise err

    monkeypatch.setattr(cq, "execute_query", _deny)
    resp = client.get("/api/cluster/queries", headers=auth_header)
    assert resp.status_code == 403


# ── Cache: 5s TTL per user, refresh=1 bypass ──

def test_queries_cache_and_refresh(client, auth_header, monkeypatch):
    import app.services.cluster_queries as cq

    calls = {"current_queries": 0}
    original = cq.execute_query

    def _counting(conn, sql, params=None):
        if "current_queries" in sql:
            calls["current_queries"] += 1
        return original(conn, sql, params)

    monkeypatch.setattr(cq, "execute_query", _counting)

    assert client.get("/api/cluster/queries", headers=auth_header).status_code == 200
    assert calls["current_queries"] == 1
    # Second call within TTL → served from cache
    assert client.get("/api/cluster/queries", headers=auth_header).status_code == 200
    assert calls["current_queries"] == 1
    # refresh=1 bypasses the cache read
    assert client.get("/api/cluster/queries?refresh=1", headers=auth_header).status_code == 200
    assert calls["current_queries"] == 2


# ── Parser unit tests ──

@pytest.mark.parametrize(
    ("raw", "expected_ms"),
    [
        ("0.478 s", 478.0),
        ("2.126 s", 2126.0),
        ("123 ms", 123.0),
        ("1m 5s", 65_000.0),
        ("2h", 7_200_000.0),
        ("", None),
        (None, None),
        ("garbage", None),
    ],
)
def test_parse_duration_ms(raw, expected_ms):
    result = parse_duration_ms(raw)
    if expected_ms is None:
        assert result is None
    else:
        assert result == pytest.approx(expected_ms)


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("1787602878 rows", 1787602878),
        ("1,234 rows", 1234),
        ("0 rows", 0),
        ("rows", None),
        (None, None),
    ],
)
def test_parse_row_count(raw, expected):
    assert parse_row_count(raw) == expected
