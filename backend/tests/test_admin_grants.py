"""Route tests for /api/admin/grants/* (guards, preview, execute, audit)."""

from __future__ import annotations

import mysql.connector.errors
import pytest
from fastapi.testclient import TestClient

from app.dependencies import get_credentials, get_db
from app.main import app

from tests.conftest import DEFAULT_QUERY_MAP, TEST_HOST, TEST_PORT, FakeConnection

PRIV_REQUEST = {
    "action": "GRANT",
    "type": "PRIVILEGE",
    "grantee": {"name": "alice", "type": "USER"},
    "object": {"object_type": "TABLE", "catalog": "default_catalog", "database": "sales", "name": "orders"},
    "privileges": ["SELECT"],
    "with_grant_option": False,
}


def _client_with(credentials: dict, conn=None):
    def _override_credentials():
        return credentials

    def _override_db():
        yield conn or FakeConnection(dict(DEFAULT_QUERY_MAP))

    app.dependency_overrides[get_credentials] = _override_credentials
    app.dependency_overrides[get_db] = _override_db
    return TestClient(app)


def _creds(is_admin: bool, can_manage_grants: bool) -> dict:
    return {
        "host": TEST_HOST,
        "port": TEST_PORT,
        "username": "test_admin",
        "password": "pw",
        "is_admin": is_admin,
        "can_manage_grants": can_manage_grants,
    }


@pytest.fixture(autouse=True)
def _clear_overrides():
    yield
    app.dependency_overrides.clear()


# ── guards ──


@pytest.mark.parametrize(
    "method,route,body",
    [
        ("GET", "/api/admin/grants/spec", None),
        ("POST", "/api/admin/grants/preview", PRIV_REQUEST),
        ("POST", "/api/admin/grants/execute", PRIV_REQUEST),
        ("GET", "/api/admin/grants/audit", None),
    ],
)
@pytest.mark.parametrize(
    "is_admin,can_manage",
    [(False, False), (True, False)],  # non-admin AND grant-incapable admin (security_admin-only)
)
def test_grant_routes_reject_unauthorized(method, route, body, is_admin, can_manage):
    with _client_with(_creds(is_admin, can_manage)) as client:
        resp = client.request(method, route, json=body)
    assert resp.status_code == 403, f"{method} {route} should 403, got {resp.status_code}"


# ── spec ──


def test_spec_returns_allowlist():
    with _client_with(_creds(True, True)) as client:
        resp = client.get("/api/admin/grants/spec")
    assert resp.status_code == 200
    spec = resp.json()["object_types"]
    assert "SELECT" in spec["TABLE"]
    assert "USAGE" in spec["FUNCTION"]
    assert "NODE" not in spec.get("CATALOG", [])
    assert "SYSTEM" not in spec  # deferred from first cut


# ── preview ──


def test_preview_returns_statement_pair():
    with _client_with(_creds(True, True)) as client:
        resp = client.post("/api/admin/grants/preview", json=PRIV_REQUEST)
    assert resp.status_code == 200
    body = resp.json()
    assert body["sql"] == [
        "SET CATALOG `default_catalog`",
        "GRANT SELECT ON TABLE `sales`.`orders` TO USER 'alice'@'%'",
    ]


def test_preview_validation_error_is_422():
    bad = dict(PRIV_REQUEST, privileges=["NODE"])
    with _client_with(_creds(True, True)) as client:
        resp = client.post("/api/admin/grants/preview", json=bad)
    assert resp.status_code == 422


def test_preview_injection_attempt_is_422():
    bad = dict(PRIV_REQUEST, grantee={"name": "alice'@'%' WITH GRANT OPTION", "type": "USER"})
    with _client_with(_creds(True, True)) as client:
        resp = client.post("/api/admin/grants/preview", json=bad)
    assert resp.status_code == 422


# ── execute ──


class RecordingConnection(FakeConnection):
    """FakeConnection that records executed SQL and optionally raises per-prefix."""

    def __init__(self, query_map, fail_prefixes: dict[str, Exception] | None = None):
        super().__init__(query_map)
        self.executed: list[str] = []
        self._fail_prefixes = fail_prefixes or {}

    def cursor(self, dictionary=False):
        cur = super().cursor(dictionary=dictionary)
        outer = self
        orig_execute = cur.execute

        def _execute(sql, params=()):
            outer.executed.append(sql)
            for prefix, exc in outer._fail_prefixes.items():
                if sql.strip().upper().startswith(prefix.upper()):
                    raise exc
            return orig_execute(sql, params)

        cur.execute = _execute
        return cur


def test_execute_happy_path_audits_and_succeeds():
    conn = RecordingConnection(dict(DEFAULT_QUERY_MAP))
    with _client_with(_creds(True, True), conn=conn) as client:
        resp = client.post("/api/admin/grants/execute", json=PRIV_REQUEST)
    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "ok"
    assert body["audit"] == "ok"
    assert any(sql.startswith("SET CATALOG") for sql in conn.executed)
    assert any(sql.startswith("GRANT SELECT") for sql in conn.executed)
    assert any(sql.startswith("INSERT INTO srpm_audit.grant_log") for sql in conn.executed)


def test_execute_audit_failure_is_nonfatal():
    conn = RecordingConnection(
        dict(DEFAULT_QUERY_MAP),
        fail_prefixes={"INSERT INTO srpm_audit": mysql.connector.errors.ProgrammingError("no table")},
    )
    with _client_with(_creds(True, True), conn=conn) as client:
        resp = client.post("/api/admin/grants/execute", json=PRIV_REQUEST)
    assert resp.status_code == 200
    assert resp.json()["audit"] == "failed"


def test_execute_starrocks_denial_maps_to_403_and_audits_failure():
    denied = mysql.connector.errors.ProgrammingError("Access denied for GRANT")
    denied.errno = 1227
    conn = RecordingConnection(dict(DEFAULT_QUERY_MAP), fail_prefixes={"GRANT": denied})
    with _client_with(_creds(True, True), conn=conn) as client:
        resp = client.post("/api/admin/grants/execute", json=PRIV_REQUEST)
    assert resp.status_code == 403
    audit_rows = [s for s in conn.executed if s.startswith("INSERT INTO srpm_audit.grant_log")]
    assert audit_rows, "denied attempt must still be audited"


def test_execute_other_db_error_maps_to_400():
    err = mysql.connector.errors.ProgrammingError("Getting analyzing error: cannot find function")
    err.errno = 1064
    conn = RecordingConnection(dict(DEFAULT_QUERY_MAP), fail_prefixes={"GRANT": err})
    with _client_with(_creds(True, True), conn=conn) as client:
        resp = client.post("/api/admin/grants/execute", json=PRIV_REQUEST)
    assert resp.status_code == 400


def test_execute_validation_error_is_422_and_runs_nothing():
    conn = RecordingConnection(dict(DEFAULT_QUERY_MAP))
    bad = dict(PRIV_REQUEST, action="REVOKE", with_grant_option=True)
    with _client_with(_creds(True, True), conn=conn) as client:
        resp = client.post("/api/admin/grants/execute", json=bad)
    assert resp.status_code == 422
    assert conn.executed == []


# ── audit read ──


def test_audit_endpoint_returns_entries():
    qmap = dict(DEFAULT_QUERY_MAP)
    qmap["SELECT log_time, actor, action, grant_type, sql_text, result, error_msg"] = [
        {
            "log_time": "2026-06-11 12:00:00",
            "actor": "'root'@'%'",
            "action": "GRANT",
            "grant_type": "PRIVILEGE",
            "sql_text": "GRANT SELECT ON TABLE `sales`.`orders` TO USER 'alice'@'%'",
            "result": "ok",
            "error_msg": None,
        }
    ]
    with _client_with(_creds(True, True), conn=FakeConnection(qmap)) as client:
        resp = client.get("/api/admin/grants/audit?limit=10")
    assert resp.status_code == 200
    entries = resp.json()
    assert len(entries) == 1
    assert entries[0]["actor"] == "'root'@'%'"
    assert entries[0]["result"] == "ok"
