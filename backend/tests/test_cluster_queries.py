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
    qm["SHOW PROC '/global_current_queries'"] = [CURRENT_QUERY_ROW]
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
    # avg cores busy = cpu_time / exec_time, rounded to 2 decimals
    assert q["cpu_avg_cores"] == pytest.approx(0.22)

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
    query_map["SHOW PROC '/global_current_queries'"] = []
    resp = client.get("/api/cluster/queries", headers=auth_header)
    assert resp.status_code == 200
    assert resp.json()["queries"] == []


def test_queries_falls_back_to_fe_local_view(client, auth_header, query_map, monkeypatch):
    """Versions without '/global_current_queries' fall back to '/current_queries'."""
    import app.services.cluster_queries as cq

    del query_map["SHOW PROC '/global_current_queries'"]
    query_map["SHOW PROC '/current_queries'"] = [CURRENT_QUERY_ROW]

    original = cq.execute_query

    def _no_global(conn, sql, params=None):
        if "global_current_queries" in sql:
            raise mysql.connector.errors.ProgrammingError(msg="Unknown proc path", errno=1064)
        return original(conn, sql, params)

    monkeypatch.setattr(cq, "execute_query", _no_global)
    resp = client.get("/api/cluster/queries", headers=auth_header)
    assert resp.status_code == 200
    assert resp.json()["queries"][0]["query_id"] == "019eb77f-e2a6-794c-aab1-00e0ac3d0036"


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


# ── can_kill flag on /queries ──

def test_queries_can_kill_true_for_grant_admin(client, auth_header):
    resp = client.get("/api/cluster/queries", headers=auth_header)
    assert resp.json()["can_kill"] is True


def test_queries_can_kill_false_for_non_grant_admin(client, non_admin_auth_header):
    resp = client.get("/api/cluster/queries", headers=non_admin_auth_header)
    assert resp.json()["can_kill"] is False


# ── Query history (M1) ──

HISTORY_ROW = {
    "queryId": "019eb66c-1682-7780-94e2-94848aaa7bf0",
    "timestamp": "2026-06-11 20:23:17",
    "user": "root",
    "db": "capacity_test",
    "warehouse": "default_warehouse",
    "queryType": "Query",
    "state": "EOF",
    "errorCode": "",
    "queryTime": 735,
    "scanRows": 350,
    "scanBytes": 12345,
    "memCostBytes": 57671680,
    "cpuCostNs": 480000000,
    "stmt": "SELECT count(*) FROM capacity_test.transaction_log",
}
HISTORY_ERR_ROW = {
    **HISTORY_ROW,
    "queryId": "019eb66c-aaaa-bbbb-cccc-000000000001",
    "state": "ERR",
    "errorCode": "Memory exceed limit",
    "stmt": "SELECT * FROM capacity_test.transaction_log a JOIN ...",
}


@pytest.fixture()
def history_query_map(query_map):
    query_map["SELECT QUERYID, TIMESTAMP"] = [HISTORY_ROW, HISTORY_ERR_ROW]
    return query_map


def test_history_happy_path(client, auth_header, history_query_map):
    resp = client.get("/api/cluster/queries/history", headers=auth_header)
    assert resp.status_code == 200
    data = resp.json()
    assert data["available"] is True
    assert len(data["queries"]) == 2

    ok = data["queries"][0]
    assert ok["query_id"] == "019eb66c-1682-7780-94e2-94848aaa7bf0"
    assert ok["state"] == "EOF"
    assert ok["is_error"] is False
    assert ok["query_time_ms"] == 735
    assert ok["database"] == "capacity_test"
    assert ok["sql"].startswith("SELECT count(*)")

    err = data["queries"][1]
    assert err["is_error"] is True
    assert err["error_code"] == "Memory exceed limit"


def test_history_unavailable_when_table_missing(client, auth_header, monkeypatch):
    """Missing AuditLoader table → available=false with a reason, not a 500."""
    import app.services.cluster_queries as cq

    def _no_table(conn, sql, params=None):
        raise mysql.connector.errors.ProgrammingError(
            msg="Unknown database 'starrocks_audit_db__'", errno=1049
        )

    monkeypatch.setattr(cq, "execute_query", _no_table)
    resp = client.get("/api/cluster/queries/history", headers=auth_header)
    assert resp.status_code == 200
    data = resp.json()
    assert data["available"] is False
    assert data["queries"] == []
    assert "AuditLoader" in data["reason"]


def test_history_access_denied_returns_403(client, auth_header, monkeypatch):
    import app.services.cluster_queries as cq

    def _deny(conn, sql, params=None):
        raise mysql.connector.errors.ProgrammingError(
            msg="Access denied for table", errno=1142
        )

    monkeypatch.setattr(cq, "execute_query", _deny)
    resp = client.get("/api/cluster/queries/history", headers=auth_header)
    assert resp.status_code == 403


def test_history_errors_only_filter(client, auth_header, history_query_map, monkeypatch):
    """errors_only=1 adds a state='ERR' clause to the SQL."""
    import app.services.cluster_queries as cq

    seen_sql = {}
    original = cq.execute_query

    def _capture(conn, sql, params=None):
        if "starrocks_audit_tbl__" in sql:
            seen_sql["sql"] = sql
        return original(conn, sql, params)

    monkeypatch.setattr(cq, "execute_query", _capture)
    resp = client.get("/api/cluster/queries/history?errors_only=1", headers=auth_header)
    assert resp.status_code == 200
    assert "state = 'ERR'" in seen_sql["sql"]


# ── KILL query (M6) ──

KILL_BODY = {"query_id": "019eb7f7-5b01-72f1-b624-5807d8809da3"}


def test_kill_requires_grant_admin(client, non_admin_auth_header):
    resp = client.post("/api/cluster/queries/kill", headers=non_admin_auth_header, json=KILL_BODY)
    assert resp.status_code == 403


def test_kill_happy_path_audits(client, auth_header, monkeypatch):
    import app.routers.cluster as cluster_mod

    audited = {}

    def _fake_audit(conn, action, gtype, sql_text, result, error_msg=None):
        audited.update(action=action, gtype=gtype, sql=sql_text, result=result)
        return True

    monkeypatch.setattr(cluster_mod, "write_audit", _fake_audit)
    resp = client.post("/api/cluster/queries/kill", headers=auth_header, json=KILL_BODY)
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "ok"
    assert data["audit"] == "ok"
    assert audited["action"] == "KILL"
    assert audited["gtype"] == "QUERY"
    assert audited["result"] == "ok"
    assert KILL_BODY["query_id"] in audited["sql"]


def test_kill_invalid_query_id_is_422(client, auth_header):
    resp = client.post(
        "/api/cluster/queries/kill", headers=auth_header, json={"query_id": "not a uuid; DROP"}
    )
    assert resp.status_code == 422


def test_kill_unknown_query_is_404(client, auth_header, monkeypatch):
    import app.services.cluster_queries as cq

    def _unknown(conn, sql, params=None):
        raise mysql.connector.errors.DatabaseError(msg="Unknown query id: ...", errno=1094)

    monkeypatch.setattr(cq, "execute_statement", _unknown)
    resp = client.post("/api/cluster/queries/kill", headers=auth_header, json=KILL_BODY)
    assert resp.status_code == 404


def test_kill_records_error_audit_on_failure(client, auth_header, monkeypatch):
    import app.routers.cluster as cluster_mod
    import app.services.cluster_queries as cq

    audited = {}

    def _fake_audit(conn, action, gtype, sql_text, result, error_msg=None):
        audited.update(result=result, error_msg=error_msg)
        return True

    def _boom(conn, sql, params=None):
        raise mysql.connector.errors.DatabaseError(msg="Unknown query id: x", errno=1094)

    monkeypatch.setattr(cluster_mod, "write_audit", _fake_audit)
    monkeypatch.setattr(cq, "execute_statement", _boom)
    resp = client.post("/api/cluster/queries/kill", headers=auth_header, json=KILL_BODY)
    assert resp.status_code == 404
    assert audited["result"] == "error"
