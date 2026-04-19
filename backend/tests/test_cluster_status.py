"""Tests for GET /api/cluster/status endpoint."""

from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor

import mysql.connector.errors
import pytest

from app.services.fe_metrics import FEMetricsData, FEMetricsError


@pytest.fixture(autouse=True)
def _stub_fe_metrics(monkeypatch):
    """Default: return a deterministic FEMetricsData so tests don't hit the network.

    Also replaces the module-level _metrics_executor with a fresh one for each test.
    The FastAPI lifespan shutdown (triggered by TestClient.__exit__) calls
    shutdown_metrics_executor(), which permanently shuts down the module-level
    ThreadPoolExecutor.  Without this replacement the second test in the session
    would see a shut-down executor and raise RuntimeError.
    """
    import app.routers.cluster as cluster_mod

    def _fake(host, http_port, timeout=2.0):
        return FEMetricsData(
            heap_used_pct=5.0,
            gc_young_count=100,
            gc_young_time_ms=2500,
            gc_old_count=0,
            gc_old_time_ms=0,
            query_p99_ms=12.3,
        )

    monkeypatch.setattr(cluster_mod, "fetch_fe_metrics", _fake)
    # Provide a fresh executor so that lifespan-shutdown from a previous test
    # doesn't leave the singleton in a shut-down state.
    fresh_executor = ThreadPoolExecutor(max_workers=2, thread_name_prefix="fe-metrics-test")
    monkeypatch.setattr(cluster_mod, "_metrics_executor", fresh_executor)


# ── Happy path ──

def test_cluster_status_happy_path(client, auth_header):
    resp = client.get("/api/cluster/status", headers=auth_header)
    assert resp.status_code == 200
    data = resp.json()

    assert "frontends" in data
    assert "backends" in data
    assert "metrics" in data
    assert "has_errors" in data
    assert data["mode"] == "full"
    assert data["metrics_warning"] is None

    assert isinstance(data["frontends"], list)
    assert len(data["frontends"]) == 2

    # 2 BE + 1 CN from fixture
    assert isinstance(data["backends"], list)
    assert len(data["backends"]) == 3

    metrics = data["metrics"]
    assert "fe_total" in metrics
    assert "fe_alive" in metrics
    assert "be_total" in metrics
    assert "be_alive" in metrics
    assert "cn_total" in metrics
    assert "cn_alive" in metrics

    # /metrics injection: stubbed fake returns 5.0 for all FE
    for fe in data["frontends"]:
        assert fe["jvm_heap_used_pct"] == pytest.approx(5.0)
        assert fe["gc_young_count"] == 100
        assert fe["query_p99_ms"] == pytest.approx(12.3)
        assert fe["metrics_error"] is None
    assert metrics["avg_fe_heap_used_pct"] == pytest.approx(5.0)


# ── Leader detection ──

def test_cluster_status_leader_detection(client, auth_header):
    resp = client.get("/api/cluster/status", headers=auth_header)
    assert resp.status_code == 200
    data = resp.json()

    fe_by_name = {fe["name"]: fe for fe in data["frontends"]}

    # fe-01 has IsMaster=true → role must be LEADER
    assert "fe-01" in fe_by_name
    assert fe_by_name["fe-01"]["role"] == "LEADER"

    # fe-02 has IsMaster=false → role should be FOLLOWER
    assert "fe-02" in fe_by_name
    assert fe_by_name["fe-02"]["role"] == "FOLLOWER"


# ── Percentage / int parsing ──

def test_cluster_status_be_pct_parsing(client, auth_header):
    resp = client.get("/api/cluster/status", headers=auth_header)
    assert resp.status_code == 200
    data = resp.json()

    # BackendId 10001 is be-01 (first backend in fixture)
    be01 = next(b for b in data["backends"] if b["name"] == "10001")

    assert be01["node_type"] == "backend"
    assert be01["used_pct"] == pytest.approx(25.07)
    assert be01["cpu_cores"] == 16


def test_cluster_status_cn_row(client, auth_header):
    """Compute node row is mapped with node_type='compute', populates cpu_used_pct,
    warehouse, and cache-disk usage parsed from DataCacheMetrics."""
    resp = client.get("/api/cluster/status", headers=auth_header)
    assert resp.status_code == 200
    data = resp.json()

    cn = next(b for b in data["backends"] if b["node_type"] == "compute")
    assert cn["name"] == "20001"
    assert cn["cpu_used_pct"] == pytest.approx(12.5)
    assert cn["warehouse"] == "default_warehouse"
    assert cn["mem_limit"] == "64.0GB"
    assert cn["tablet_count"] == 278
    # Data cache parsed from "DiskUsage: 200MB/10GB"
    assert cn["data_used_capacity"] == "200MB"
    assert cn["total_capacity"] == "10GB"
    # 200MB / 10GB = 200 / 10240 ≈ 1.95%
    assert cn["used_pct"] == pytest.approx(1.95, abs=0.05)


# ── has_errors flag ──

def test_cluster_status_has_errors_flag(client, auth_header):
    """Default fixture has be-02 with Alive=false and ErrMsg='Connection refused' → has_errors=True."""
    resp = client.get("/api/cluster/status", headers=auth_header)
    assert resp.status_code == 200
    data = resp.json()
    assert data["has_errors"] is True


# ── Metrics aggregation ──

def test_cluster_status_metrics_aggregation(client, auth_header):
    resp = client.get("/api/cluster/status", headers=auth_header)
    assert resp.status_code == 200
    metrics = resp.json()["metrics"]

    assert metrics["fe_alive"] == 2
    assert metrics["fe_total"] == 2
    assert metrics["be_alive"] == 1
    assert metrics["be_total"] == 2
    assert metrics["cn_alive"] == 1
    assert metrics["cn_total"] == 1
    # 1500 + 1200 + 278 = 2978
    assert metrics["total_tablets"] == 2978
    # Only CN has CpuUsedPct populated → avg == 12.5
    assert metrics["avg_cpu_used_pct"] == pytest.approx(12.5)
    # All nodes contribute used_pct: BE 25.07 + BE 17.63 + CN ~1.95 → avg ~14.88
    assert metrics["avg_disk_used_pct"] == pytest.approx(14.88, abs=0.1)


# ── Limited mode (formerly 403) ──

def test_cluster_status_limited_mode(client, auth_header, monkeypatch):
    """When SHOW FRONTENDS is denied, fallback to limited mode with single-FE view."""
    err = mysql.connector.errors.ProgrammingError(
        msg="Access denied for user 'viewer'@'%' to database 'FRONTENDS'",
        errno=1044,
    )

    import app.routers.cluster as cluster_mod

    original = cluster_mod.execute_query

    def _raise_on_show(conn, sql, params=None):
        up = sql.strip().upper()
        if up.startswith("SHOW "):
            raise err
        return original(conn, sql, params)

    monkeypatch.setattr(cluster_mod, "execute_query", _raise_on_show)
    cluster_mod._cluster_cache.clear()
    resp = client.get("/api/cluster/status", headers=auth_header)
    assert resp.status_code == 200
    data = resp.json()
    assert data["mode"] == "limited"
    # Limited view: one FE placeholder, zero BE/CN
    assert len(data["frontends"]) == 1
    assert data["backends"] == []
    fe = data["frontends"][0]
    assert fe["role"] == "UNKNOWN"
    # M3: placeholder name must be the fixed string "FE (connected)"
    assert fe["name"] == "FE (connected)"
    # The IP should still reflect the login host so the UI can show the real address
    assert fe["ip"] == "test-sr-host"
    # /metrics stub still fires on the placeholder FE
    assert fe["jvm_heap_used_pct"] == pytest.approx(5.0)
    cluster_mod._cluster_cache.clear()


def test_cluster_status_metrics_all_fail_warning(client, auth_header, monkeypatch):
    """All FE /metrics calls fail → metrics_warning set, each FE carries its error."""
    import app.routers.cluster as cluster_mod

    def _err(host, http_port, timeout=2.0):
        return FEMetricsError(reason="timeout", message=f"timeout after {timeout}s")

    monkeypatch.setattr(cluster_mod, "fetch_fe_metrics", _err)
    cluster_mod._cluster_cache.clear()

    resp = client.get("/api/cluster/status", headers=auth_header)
    assert resp.status_code == 200
    data = resp.json()
    assert data["metrics_warning"] is not None
    assert "8030" in data["metrics_warning"]
    for fe in data["frontends"]:
        assert fe["jvm_heap_used_pct"] is None
        assert fe["metrics_error"] is not None
        assert "timeout" in fe["metrics_error"]
    assert data["metrics"]["avg_fe_heap_used_pct"] is None


def test_cluster_status_metrics_partial_fail(client, auth_header, monkeypatch):
    """One FE succeeds, one fails → no warning; failed FE has metrics_error set."""
    import app.routers.cluster as cluster_mod

    call_state = {"n": 0}

    def _mixed(host, http_port, timeout=2.0):
        call_state["n"] += 1
        if call_state["n"] == 1:
            return FEMetricsData(heap_used_pct=12.5, query_p99_ms=7.0)
        return FEMetricsError(reason="network", message="Connection refused")

    monkeypatch.setattr(cluster_mod, "fetch_fe_metrics", _mixed)
    cluster_mod._cluster_cache.clear()

    resp = client.get("/api/cluster/status", headers=auth_header)
    assert resp.status_code == 200
    data = resp.json()
    assert data["metrics_warning"] is None  # at least one succeeded
    fes = data["frontends"]
    succ = [fe for fe in fes if fe["jvm_heap_used_pct"] is not None]
    fail = [fe for fe in fes if fe["jvm_heap_used_pct"] is None]
    assert len(succ) == 1 and len(fail) == 1
    assert fail[0]["metrics_error"] is not None
    # Aggregate is computed only from the successful one
    assert data["metrics"]["avg_fe_heap_used_pct"] == pytest.approx(12.5)


# ── Empty result ──

def test_cluster_status_empty(client, auth_header, query_map, monkeypatch):
    """SHOW FRONTENDS/BACKENDS returning [] → 200 with empty lists and fe_alive=0."""
    import app.routers.cluster as cluster_mod

    original = cluster_mod.execute_query

    def _empty(conn, sql, params=None):
        s = sql.upper()
        if "FRONTENDS" in s or "BACKENDS" in s or "COMPUTE NODES" in s:
            return []
        return original(conn, sql, params)

    monkeypatch.setattr(cluster_mod, "execute_query", _empty)
    cluster_mod._cluster_cache.clear()
    resp = client.get("/api/cluster/status", headers=auth_header)
    assert resp.status_code == 200
    data = resp.json()
    assert data["frontends"] == []
    assert data["backends"] == []
    assert data["metrics"]["fe_alive"] == 0
    assert data["has_errors"] is False
    # With no FE nodes, there's nothing to probe; no warning.
    assert data["metrics_warning"] is None
    cluster_mod._cluster_cache.clear()


# ── Cache test ──

def test_cluster_status_cached(client, auth_header, monkeypatch):
    """Second call must use the cache — expensive queries only run once."""
    import app.routers.cluster as cluster_mod

    show_calls = 0
    original = cluster_mod.execute_query

    def _counting(conn, sql, params=None):
        nonlocal show_calls
        if sql.strip().upper().startswith("SHOW "):
            show_calls += 1
        return original(conn, sql, params)

    monkeypatch.setattr(cluster_mod, "execute_query", _counting)
    cluster_mod._cluster_cache.clear()

    resp1 = client.get("/api/cluster/status", headers=auth_header)
    assert resp1.status_code == 200
    resp2 = client.get("/api/cluster/status", headers=auth_header)
    assert resp2.status_code == 200

    # First request: 3 SHOW calls (SHOW FRONTENDS + SHOW BACKENDS + SHOW COMPUTE NODES).
    # Second request: served from cache → still 3 total.
    # Note: SET ROLE ALL is no longer called inside get_cluster_status() (M2 — removed
    # the duplicate call; get_db() already runs it). We only count SHOW-prefixed queries.
    assert show_calls == 3
    cluster_mod._cluster_cache.clear()


# ── H2: ?refresh=1 bypasses cache ──

def test_cluster_status_refresh_bypass(client, auth_header, monkeypatch):
    """?refresh=1 must skip the cache read and re-execute the SHOW queries.

    Sequence:
      1. Normal call  → populates cache (3 SHOW calls)
      2. refresh call → cache read skipped, queries re-run (3 more = 6 total)
      3. Normal call  → cache hit from refresh's write-back (still 6 total)
    """
    import app.routers.cluster as cluster_mod

    show_calls = 0
    original = cluster_mod.execute_query

    def _counting(conn, sql, params=None):
        nonlocal show_calls
        if sql.strip().upper().startswith("SHOW "):
            show_calls += 1
        return original(conn, sql, params)

    monkeypatch.setattr(cluster_mod, "execute_query", _counting)
    cluster_mod._cluster_cache.clear()

    # 1. Normal call — populates cache.
    resp1 = client.get("/api/cluster/status", headers=auth_header)
    assert resp1.status_code == 200
    after_first = show_calls
    assert after_first == 3  # SHOW FRONTENDS + SHOW BACKENDS + SHOW COMPUTE NODES

    # 2. Refresh call — bypasses cache read, runs queries again.
    resp2 = client.get("/api/cluster/status?refresh=1", headers=auth_header)
    assert resp2.status_code == 200
    after_refresh = show_calls
    assert after_refresh == 6  # 3 new SHOW calls on top of the first 3

    # 3. Normal call — served from the cache written by the refresh call.
    resp3 = client.get("/api/cluster/status", headers=auth_header)
    assert resp3.status_code == 200
    assert show_calls == 6  # count unchanged — came from cache

    cluster_mod._cluster_cache.clear()


# ── SHOW BACKENDS access-denied: frontends populated, backends empty ──

def test_cluster_status_be_only_denied(client, auth_header, monkeypatch):
    """SHOW FRONTENDS succeeds but SHOW BACKENDS raises access-denied.

    Expected: 200, mode='full', frontends populated from fixture, backends=[].
    (The handler downgrades to limited mode when BACKENDS is denied, so we
    verify the limited-mode path only clears backends not frontends.)
    """
    import app.routers.cluster as cluster_mod

    access_denied = mysql.connector.errors.ProgrammingError(
        msg="Access denied for user 'viewer'@'%'",
        errno=1044,
    )
    original = cluster_mod.execute_query

    def _deny_backends(conn, sql, params=None):
        up = sql.strip().upper()
        if up.startswith("SHOW BACKENDS"):
            raise access_denied
        return original(conn, sql, params)

    monkeypatch.setattr(cluster_mod, "execute_query", _deny_backends)
    cluster_mod._cluster_cache.clear()

    resp = client.get("/api/cluster/status", headers=auth_header)
    assert resp.status_code == 200
    data = resp.json()

    # When SHOW BACKENDS is denied the router downgrades to limited mode.
    # In limited mode frontends is replaced by the placeholder FE.
    assert data["mode"] == "limited"
    assert len(data["frontends"]) == 1
    assert data["frontends"][0]["name"] == "FE (connected)"
    assert data["backends"] == []

    cluster_mod._cluster_cache.clear()


# ── SHOW COMPUTE NODES non-access-denied error: warning logged, CN absent ──

def test_cluster_status_cn_silent_on_generic_error(client, auth_header, monkeypatch, caplog):
    """SHOW COMPUTE NODES fails with a non-access-denied error.

    Expected: 200, FE/BE still present, CN absent, logger.warning fired with
    a message containing 'SHOW COMPUTE NODES failed'.
    """
    import logging

    import app.routers.cluster as cluster_mod

    generic_err = mysql.connector.errors.ProgrammingError(
        msg="Connection lost",
        errno=2006,
    )
    original = cluster_mod.execute_query

    def _fail_cn(conn, sql, params=None):
        up = sql.strip().upper()
        if up.startswith("SHOW COMPUTE NODES"):
            raise generic_err
        return original(conn, sql, params)

    monkeypatch.setattr(cluster_mod, "execute_query", _fail_cn)
    cluster_mod._cluster_cache.clear()

    with caplog.at_level(logging.WARNING, logger="app.routers.cluster"):
        resp = client.get("/api/cluster/status", headers=auth_header)

    assert resp.status_code == 200
    data = resp.json()

    # Full mode: SHOW FRONTENDS and SHOW BACKENDS succeeded.
    assert data["mode"] == "full"
    # FE nodes from fixture
    assert len(data["frontends"]) == 2
    # BE nodes from fixture (CN absent because SHOW COMPUTE NODES failed)
    be_nodes = [b for b in data["backends"] if b["node_type"] == "backend"]
    cn_nodes = [b for b in data["backends"] if b["node_type"] == "compute"]
    assert len(be_nodes) == 2
    assert len(cn_nodes) == 0

    # logger.warning must have been emitted with the expected substring
    warning_msgs = [r.message for r in caplog.records if r.levelno == logging.WARNING]
    assert any("SHOW COMPUTE NODES failed" in m for m in warning_msgs), (
        f"Expected 'SHOW COMPUTE NODES failed' in warnings; got: {warning_msgs}"
    )

    cluster_mod._cluster_cache.clear()
