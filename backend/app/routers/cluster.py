"""Router for /api/cluster/status endpoint.

Common UI — any logged-in user can reach it.

* When SHOW FRONTENDS/BACKENDS/COMPUTE NODES succeed (user has cluster_admin),
  the response includes the full node inventory (`mode="full"`).
* When SHOW FRONTENDS is denied by StarRocks, the endpoint falls back to
  `mode="limited"`: a single FENodeInfo representing the FE the user is
  connected to, with resource metrics populated from the unauthenticated
  `/metrics` endpoint.
* Each FE's /metrics is probed in parallel (ThreadPoolExecutor, 2s timeout).
  Individual failures populate `metrics_error` on that FENodeInfo. If every
  FE probe fails, `metrics_warning` is set so the UI can show a banner.
"""

from __future__ import annotations

import logging
import re
import threading
from concurrent.futures import ThreadPoolExecutor
from typing import Literal

import mysql.connector.errors
from fastapi import APIRouter, Depends, HTTPException, Query

from app.config import settings
from app.dependencies import get_credentials, get_db, require_grant_admin
from app.models.schemas import (
    BENodeInfo,
    ClusterHistoryResponse,
    ClusterMetrics,
    ClusterQueriesResponse,
    ClusterStatusResponse,
    FENodeInfo,
    KillQueryRequest,
    KillQueryResponse,
)
from app.services.admin.audit import write_audit
from app.services.be_metrics import fetch_be_cpu_pct
from app.services.cluster_queries import (
    collect_query_history,
    collect_running_queries,
    fetch_server_now,
    kill_query,
)
from app.services.fe_metrics import FEMetricsData, FEMetricsError, fetch_fe_metrics
from app.services.shared.size_utils import bytes_to_human as _bytes_to_human
from app.services.shared.size_utils import parse_size_bytes as _parse_size_bytes
from app.services.starrocks_client import execute_query
from app.utils.cache import make_ttl_cache
from app.utils.sys_access import is_access_denied

router = APIRouter()
logger = logging.getLogger(__name__)

# ── TTL cache (per username) ──
_cluster_cache = make_ttl_cache("cluster.status", maxsize=256, ttl=settings.cache_ttl_seconds)
_cluster_cache_lock = threading.Lock()

# Running queries change fast — much shorter TTL than node status.
_QUERIES_CACHE_TTL_SECONDS = 5
_queries_cache = make_ttl_cache("cluster.queries", maxsize=256, ttl=_QUERIES_CACHE_TTL_SECONDS)
_queries_cache_lock = threading.Lock()

# Module-level executor — reused across requests to avoid per-request thread-pool creation overhead.
_metrics_executor = ThreadPoolExecutor(max_workers=6, thread_name_prefix="fe-metrics")


def shutdown_metrics_executor() -> None:
    """Shutdown the module-level FE metrics executor. Called from FastAPI lifespan."""
    _metrics_executor.shutdown(wait=False)


# ── Parse helpers ──


def _parse_bool(val) -> bool:
    if isinstance(val, bool):
        return val
    if isinstance(val, str):
        return val.strip().upper() == "TRUE"
    return bool(val)


def _parse_int(val) -> int | None:
    if val is None:
        return None
    try:
        return int(str(val).strip())
    except (ValueError, TypeError):
        return None


def _parse_float(val) -> float | None:
    if val is None:
        return None
    try:
        return float(str(val).strip().rstrip("% "))
    except (ValueError, TypeError):
        return None


# ── Human-readable size helpers ──
# (parse/format primitives live in services/shared/size_utils.py)


def _human_size_sum(sizes: list[str]) -> str | None:
    """Sum a list of human-readable size strings and return a human-readable total."""
    if not sizes:
        return None
    total = sum(_parse_size_bytes(s) for s in sizes)
    return _bytes_to_human(total)


# DataCacheMetrics from SHOW COMPUTE NODES, e.g.:
#   "Status: Normal, DiskUsage: 79MB/10GB, MemUsage: 35.2MB/15.1GB"
_DATACACHE_DISK_RE = re.compile(r"DiskUsage:\s*([\d.]+\s*[KMGTP]?B)\s*/\s*([\d.]+\s*[KMGTP]?B)", re.IGNORECASE)


def _parse_datacache_disk(raw: str | None) -> tuple[str | None, str | None, float | None]:
    """Parse DataCacheMetrics string → (used, total, used_pct). All None on failure."""
    if not raw:
        return None, None, None
    m = _DATACACHE_DISK_RE.search(raw)
    if not m:
        return None, None, None
    used_str, total_str = m.group(1).strip(), m.group(2).strip()
    used_bytes = _parse_size_bytes(used_str)
    total_bytes = _parse_size_bytes(total_str)
    pct = round(used_bytes / total_bytes * 100, 2) if total_bytes > 0 else None
    return used_str, total_str, pct


# ── Row → model helpers ──


def _fe_row_to_info(r: dict) -> FENodeInfo:
    ip = r.get("IP") or r.get("Host") or ""
    name = r.get("Name") or ip

    # Role: IsMaster=true → LEADER, else use Role column or default FOLLOWER
    is_master = _parse_bool(r.get("IsMaster", False))
    if is_master:
        role = "LEADER"
    else:
        role = r.get("Role") or "FOLLOWER"

    alive = _parse_bool(r.get("Alive", False))
    join = _parse_bool(r.get("Join", False))
    err_msg = r.get("ErrMsg") or None

    return FENodeInfo(
        name=name,
        ip=ip,
        edit_log_port=_parse_int(r.get("EditLogPort")),
        http_port=_parse_int(r.get("HttpPort")),
        query_port=_parse_int(r.get("QueryPort")),
        rpc_port=_parse_int(r.get("RpcPort")),
        role=role,
        alive=alive,
        join=join,
        last_heartbeat=r.get("LastHeartbeat") or None,
        replayed_journal_id=_parse_int(r.get("ReplayedJournalId")),
        start_time=r.get("StartTime") or None,
        version=r.get("Version") or None,
        err_msg=err_msg,
    )


def _be_row_to_info(r: dict) -> BENodeInfo:
    ip = r.get("Host") or r.get("IP") or ""
    name = r.get("BackendId") or r.get("Name") or ip
    # Normalise name to string
    name = str(name)

    alive = _parse_bool(r.get("Alive", False))
    err_msg = r.get("ErrMsg") or None

    return BENodeInfo(
        name=name,
        ip=ip,
        node_type="backend",
        heartbeat_port=_parse_int(r.get("HeartbeatPort")),
        be_port=_parse_int(r.get("BePort")),
        http_port=_parse_int(r.get("HttpPort")),
        brpc_port=_parse_int(r.get("BrpcPort")),
        alive=alive,
        last_heartbeat=r.get("LastHeartbeat") or None,
        last_start_time=r.get("LastStartTime") or None,
        tablet_count=_parse_int(r.get("TabletNum")),
        data_used_capacity=r.get("DataUsedCapacity") or None,
        total_capacity=r.get("TotalCapacity") or None,
        used_pct=_parse_float(r.get("UsedPct")),
        cpu_cores=_parse_int(r.get("CpuCores")),
        mem_used_pct=_parse_float(r.get("MemUsedPct")),
        num_running_queries=_parse_int(r.get("NumRunningQueries")),
        version=r.get("Version") or None,
        err_msg=err_msg,
    )


def _cn_row_to_info(r: dict) -> BENodeInfo:
    """Convert SHOW COMPUTE NODES row to BENodeInfo with node_type='compute'.

    Compute nodes have no persistent storage (disk_used/total/used_pct are None)
    but do report CPU%, memory%, warehouse, and (cached) tablet count.
    """
    ip = r.get("IP") or r.get("Host") or ""
    name = r.get("ComputeNodeId") or r.get("Name") or ip
    name = str(name)

    # Local data cache usage — CN has no persistent storage but caches hot data locally.
    cache_used, cache_total, cache_pct = _parse_datacache_disk(r.get("DataCacheMetrics"))

    return BENodeInfo(
        name=name,
        ip=ip,
        node_type="compute",
        heartbeat_port=_parse_int(r.get("HeartbeatPort")),
        be_port=_parse_int(r.get("BePort")),
        http_port=_parse_int(r.get("HttpPort")),
        brpc_port=_parse_int(r.get("BrpcPort")),
        alive=_parse_bool(r.get("Alive", False)),
        last_heartbeat=r.get("LastHeartbeat") or None,
        last_start_time=r.get("LastStartTime") or None,
        tablet_count=_parse_int(r.get("TabletNum")),
        # For CN these fields represent LOCAL DATA CACHE usage (not persistent storage).
        # The UI labels them "Disk Cache" to distinguish from BE's persistent disk.
        data_used_capacity=cache_used,
        total_capacity=cache_total,
        used_pct=cache_pct,
        cpu_cores=_parse_int(r.get("CpuCores")),
        cpu_used_pct=_parse_float(r.get("CpuUsedPct")),
        mem_used_pct=_parse_float(r.get("MemUsedPct")),
        mem_limit=r.get("MemLimit") or None,
        num_running_queries=_parse_int(r.get("NumRunningQueries")),
        warehouse=r.get("WarehouseName") or None,
        version=r.get("Version") or None,
        err_msg=r.get("ErrMsg") or None,
    )


def _compute_metrics(
    frontends: list[FENodeInfo],
    backends: list[BENodeInfo],
) -> ClusterMetrics:
    fe_alive = sum(1 for fe in frontends if fe.alive)
    be_nodes = [b for b in backends if b.node_type == "backend"]
    cn_nodes = [b for b in backends if b.node_type == "compute"]
    be_alive = sum(1 for b in be_nodes if b.alive)
    cn_alive = sum(1 for c in cn_nodes if c.alive)

    tablet_counts = [b.tablet_count for b in backends if b.tablet_count is not None]
    total_tablets = sum(tablet_counts) if tablet_counts else None

    # Only BE nodes have persistent storage volumes.  CN "data_used_capacity"
    # is actually its local data-cache usage, not persistent data — don't include.
    size_strs = [b.data_used_capacity for b in be_nodes if b.data_used_capacity]
    total_data_used = _human_size_sum(size_strs) if size_strs else None

    # Disk usage % is averaged across all nodes that report one (BE disk OR CN cache).
    # The frontend labels this "Avg Disk" or "Avg Cache" depending on the cluster shape.
    disk_pcts = [b.used_pct for b in backends if b.used_pct is not None]
    cpu_pcts = [b.cpu_used_pct for b in backends if b.cpu_used_pct is not None]
    mem_pcts = [b.mem_used_pct for b in backends if b.mem_used_pct is not None]

    avg_disk = round(sum(disk_pcts) / len(disk_pcts), 2) if disk_pcts else None
    avg_cpu = round(sum(cpu_pcts) / len(cpu_pcts), 2) if cpu_pcts else None
    avg_mem = round(sum(mem_pcts) / len(mem_pcts), 2) if mem_pcts else None

    return ClusterMetrics(
        fe_total=len(frontends),
        fe_alive=fe_alive,
        be_total=len(be_nodes),
        be_alive=be_alive,
        cn_total=len(cn_nodes),
        cn_alive=cn_alive,
        total_tablets=total_tablets,
        total_data_used=total_data_used,
        avg_disk_used_pct=avg_disk,
        avg_cpu_used_pct=avg_cpu,
        avg_mem_used_pct=avg_mem,
    )


_DEFAULT_FE_HTTP_PORT = 8030
_METRICS_TIMEOUT_SECONDS = 2.0


def _limited_mode_fe(host: str) -> FENodeInfo:
    """Build a best-effort FENodeInfo for non-cluster_admin users.

    `host` is the StarRocks address the caller already authenticated against
    (from `LoginRequest.host`, validated by the MySQL credential handshake in
    `get_connection`). `_inject_metrics` only reaches `http://{host}:8030/metrics`
    after that handshake succeeded — no new SSRF surface beyond the existing SR
    connection path.
    """
    return FENodeInfo(
        name="FE (connected)",
        ip=host,
        http_port=_DEFAULT_FE_HTTP_PORT,
        role="UNKNOWN",
        alive=True,  # assumed — we're connected to it via SQL
        join=True,
    )


def _inject_be_metrics(backends: list[BENodeInfo]) -> None:
    """Probe BE /metrics in parallel to fill cpu_used_pct (SHOW BACKENDS lacks it).

    Compute nodes already report CpuUsedPct via SHOW COMPUTE NODES, so only
    node_type == "backend" is probed. Best-effort: failures and first-scrape
    (no delta baseline yet) leave the field None.
    """
    targets = [be for be in backends if be.node_type == "backend" and be.alive and be.http_port]
    if not targets:
        return

    def _probe(be: BENodeInfo) -> tuple[BENodeInfo, float | None]:
        assert be.http_port is not None  # guaranteed by the `targets` filter above
        return be, fetch_be_cpu_pct(be.ip, be.http_port, timeout=_METRICS_TIMEOUT_SECONDS)

    futures = [_metrics_executor.submit(_probe, be) for be in targets]
    for future in futures:
        be, pct = future.result()
        if pct is not None:
            be.cpu_used_pct = pct


def _inject_metrics(frontends: list[FENodeInfo]) -> str | None:
    """Probe each FE's /metrics in parallel and populate the matching fields.

    Returns a metrics_warning string iff every FE probe failed (so the UI can
    show a single aggregate banner). Per-node failures set `metrics_error`.
    """
    if not frontends:
        return None

    def _probe(fe: FENodeInfo) -> tuple[FENodeInfo, FEMetricsData | FEMetricsError]:
        port = fe.http_port or _DEFAULT_FE_HTTP_PORT
        return fe, fetch_fe_metrics(fe.ip, port, timeout=_METRICS_TIMEOUT_SECONDS)

    # Submit all probes to the module-level executor; collect futures in order.
    any_success = False
    futures = [_metrics_executor.submit(_probe, fe) for fe in frontends]
    for future in futures:
        fe, result = future.result()
        if isinstance(result, FEMetricsData):
            any_success = True
            fe.jvm_heap_used_pct = result.heap_used_pct
            fe.gc_young_count = result.gc_young_count
            fe.gc_young_time_ms = result.gc_young_time_ms
            fe.gc_old_count = result.gc_old_count
            fe.gc_old_time_ms = result.gc_old_time_ms
            fe.query_p99_ms = result.query_p99_ms
            fe.connection_count = result.connection_count
            fe.qps = result.qps
        else:
            fe.metrics_error = f"{result.reason}: {result.message}"

    if not any_success:
        return (
            "Resource metrics unreachable (port "
            f"{_DEFAULT_FE_HTTP_PORT} not accessible from the server). "
            "Node list still available."
        )
    return None


@router.get("/status", response_model=ClusterStatusResponse)
def get_cluster_status(
    conn=Depends(get_db),
    credentials: dict = Depends(get_credentials),
    refresh: bool = Query(False, description="Bypass per-user cache and force a live query"),
):
    """Return FE/BE/CN inventory + resource metrics.

    No require_admin guard — any logged-in user may call this. When StarRocks
    denies SHOW FRONTENDS (no cluster_admin role), we fall back to a single-FE
    "limited" view so basic cluster health is still visible (common UI).

    Pass `?refresh=1` to bypass the cache for this request; the result is still
    written back to cache so the next non-refresh call remains fast.
    """
    username = credentials["username"]
    host = credentials.get("host") or ""

    # Cache key includes mode so that if a user's role assignments change mid-session
    # the "full" and "limited" responses don't collide.
    def _cached(mode: str) -> ClusterStatusResponse | None:
        with _cluster_cache_lock:
            return _cluster_cache.get(f"cluster_status_{username}:{mode}")

    def _save(mode: str, resp: ClusterStatusResponse) -> None:
        with _cluster_cache_lock:
            _cluster_cache[f"cluster_status_{username}:{mode}"] = resp

    # Fast path: serve from cache if present (skipped when refresh=True).
    if not refresh:
        hit = _cached("full") or _cached("limited")
        if hit is not None:
            return hit

    # get_db() already runs SET ROLE ALL; no need to repeat it here.

    mode: Literal["full", "limited"] = "full"
    fe_rows: list[dict] = []
    be_rows: list[dict] = []
    cn_rows: list[dict] = []

    # SHOW FRONTENDS — the gate for full mode.
    try:
        fe_rows = execute_query(conn, "SHOW FRONTENDS")
    except (mysql.connector.errors.ProgrammingError, mysql.connector.errors.DatabaseError) as exc:
        if is_access_denied(exc):
            mode = "limited"
            logger.debug("SHOW FRONTENDS denied for %s → limited mode", username)
        else:
            raise

    # SHOW BACKENDS / COMPUTE NODES — only meaningful in full mode.
    if mode == "full":
        try:
            be_rows = execute_query(conn, "SHOW BACKENDS")
        except (mysql.connector.errors.ProgrammingError, mysql.connector.errors.DatabaseError) as exc:
            if is_access_denied(exc):
                mode = "limited"
                be_rows = []
                logger.debug("SHOW BACKENDS denied — downgrading to limited mode")
            else:
                raise

    if mode == "full":
        try:
            cn_rows = execute_query(conn, "SHOW COMPUTE NODES")
        except (mysql.connector.errors.ProgrammingError, mysql.connector.errors.DatabaseError) as exc:
            if is_access_denied(exc):
                # CN privilege doesn't exist separately in practice; downgrade too.
                mode = "limited"
                be_rows = []
                cn_rows = []
                logger.debug("SHOW COMPUTE NODES denied — downgrading to limited mode")
            else:
                logger.warning("SHOW COMPUTE NODES failed (non-access-denied): %s", exc)

    # Build node lists.
    if mode == "full":
        frontends = [_fe_row_to_info(r) for r in fe_rows]
        backends = [_be_row_to_info(r) for r in be_rows] + [_cn_row_to_info(r) for r in cn_rows]
    else:
        frontends = [_limited_mode_fe(host or "localhost")]
        backends = []

    # Inject /metrics-derived resource fields.
    metrics_warning = _inject_metrics(frontends)
    _inject_be_metrics(backends)

    # Compute aggregate metrics.
    metrics = _compute_metrics(frontends, backends)
    heap_pcts = [fe.jvm_heap_used_pct for fe in frontends if fe.jvm_heap_used_pct is not None]
    if heap_pcts:
        metrics.avg_fe_heap_used_pct = round(sum(heap_pcts) / len(heap_pcts), 2)
    conns = [fe.connection_count for fe in frontends if fe.connection_count is not None]
    if conns:
        metrics.total_connections = sum(conns)
    qpss = [fe.qps for fe in frontends if fe.qps is not None]
    if qpss:
        metrics.total_qps = round(sum(qpss), 2)

    has_errors = any((not fe.alive) or bool(fe.err_msg) for fe in frontends) or any(
        (not be.alive) or bool(be.err_msg) for be in backends
    )

    result = ClusterStatusResponse(
        frontends=frontends,
        backends=backends,
        metrics=metrics,
        has_errors=has_errors,
        mode=mode,
        metrics_warning=metrics_warning,
        server_now=fetch_server_now(conn),
    )

    _save(mode, result)
    return result


@router.get("/queries", response_model=ClusterQueriesResponse)
def get_cluster_queries(
    conn=Depends(get_db),
    credentials: dict = Depends(get_credentials),
    refresh: bool = Query(False, description="Bypass per-user cache and force a live query"),
):
    """Return currently running queries with resource usage.

    No require_admin guard — StarRocks gates SHOW PROC '/current_queries'
    behind the OPERATE (cluster_admin) privilege; access-denied errors map to
    HTTP 403 via the global handler in main.py.
    """
    username = credentials["username"]
    cache_key = f"cluster_queries_{username}"

    if not refresh:
        with _queries_cache_lock:
            hit = _queries_cache.get(cache_key)
        if hit is not None:
            return hit

    result = ClusterQueriesResponse(
        queries=collect_running_queries(conn),
        server_now=fetch_server_now(conn),
        can_kill=credentials.get("can_manage_grants", False),
    )

    with _queries_cache_lock:
        _queries_cache[cache_key] = result
    return result


@router.get("/queries/history", response_model=ClusterHistoryResponse)
def get_cluster_query_history(
    conn=Depends(get_db),
    limit: int = Query(100, ge=1, le=500, description="Max rows to return"),
    errors_only: bool = Query(False, description="Only failed (state=ERR) queries"),
):
    """Return recently completed queries from the AuditLoader table.

    When the AuditLoader plugin isn't installed (table missing), this returns
    ``available=false`` with a reason instead of an error, so the Recent subtab
    shows an "unavailable" notice (the subtab stays visible). Access-denied
    still maps to 403.
    """
    try:
        queries = collect_query_history(conn, limit=limit, errors_only=errors_only)
    except (mysql.connector.errors.ProgrammingError, mysql.connector.errors.DatabaseError) as exc:
        if is_access_denied(exc):
            raise
        # Most likely the audit DB/table doesn't exist on this cluster.
        logger.info("Query history unavailable: %s", exc)
        return ClusterHistoryResponse(
            available=False,
            reason="Query history requires the StarRocks AuditLoader plugin "
            "(table starrocks_audit_db__.starrocks_audit_tbl__).",
        )
    return ClusterHistoryResponse(
        available=True,
        queries=queries,
        server_now=fetch_server_now(conn),
    )


@router.post("/queries/kill", response_model=KillQueryResponse)
def kill_cluster_query(
    req: KillQueryRequest,
    credentials: dict = Depends(require_grant_admin),
    conn=Depends(get_db),
):
    """KILL a running query by its global query id (grant-admin only).

    Gated by require_grant_admin (admin + user_admin). Every attempt — success
    or failure — is recorded in srpm_audit.grant_log, matching GRANT/REVOKE.
    """
    sql_text = f"KILL QUERY '{req.query_id}'"
    try:
        kill_query(conn, req.query_id)
    except ValueError as exc:
        write_audit(conn, "KILL", "QUERY", sql_text, "error", str(exc))
        raise HTTPException(status_code=422, detail=str(exc)) from None
    except (mysql.connector.errors.ProgrammingError, mysql.connector.errors.DatabaseError) as exc:
        write_audit(conn, "KILL", "QUERY", sql_text, "error", str(exc))
        if is_access_denied(exc):
            raise HTTPException(status_code=403, detail=f"StarRocks denied KILL: {exc}") from None
        # Query already finished / unknown id → 404; other rejections → 400.
        msg = str(exc)
        status = 404 if "Unknown query id" in msg else 400
        raise HTTPException(status_code=status, detail=f"KILL failed: {msg}") from None

    # Invalidate the running-queries cache so the killed query disappears promptly.
    with _queries_cache_lock:
        _queries_cache.clear()
    audit_ok = write_audit(conn, "KILL", "QUERY", sql_text, "ok")
    return KillQueryResponse(status="ok", query_id=req.query_id, audit="ok" if audit_ok else "failed")
