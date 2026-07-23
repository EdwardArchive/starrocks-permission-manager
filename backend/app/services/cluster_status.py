"""Collect FE/BE/CN cluster status: SHOW-output parsing, /metrics probing, aggregate math.

Extracted from ``routers/cluster.py`` (Phase 3.5). The router stays the single
monkeypatch seam: it owns ``_metrics_executor`` plus the ``execute_query`` /
``fetch_fe_metrics`` / ``fetch_be_cpu_pct`` module globals (which tests patch on
``app.routers.cluster``) and injects them into :func:`collect_cluster_status` at
call time. That keeps those seams working without a router<->service import cycle.

* When SHOW FRONTENDS/BACKENDS/COMPUTE NODES succeed (user has cluster_admin),
  the response includes the full node inventory (``mode="full"``).
* When a SHOW is denied by StarRocks, we downgrade to ``mode="limited"``: a
  single FENodeInfo for the FE the user is connected to, metrics-only.
* Each FE's /metrics is probed in parallel via the injected executor (2s
  timeout). Individual failures populate ``metrics_error``; if every FE probe
  fails, ``metrics_warning`` is set so the UI can show a banner.
"""

from __future__ import annotations

import logging
import re
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor
from typing import Literal

import mysql.connector.errors

from app.models.schemas import (
    BENodeInfo,
    ClusterMetrics,
    ClusterStatusResponse,
    FENodeInfo,
)
from app.services.cluster_queries import fetch_server_now
from app.services.fe_metrics import FEMetricsData, FEMetricsError
from app.services.shared.size_utils import bytes_to_human as _bytes_to_human
from app.services.shared.size_utils import parse_size_bytes as _parse_size_bytes
from app.utils.sys_access import is_access_denied

logger = logging.getLogger(__name__)

# I/O callables injected by the router (patched there in tests).
ExecuteQuery = Callable[..., list[dict]]
FEProbe = Callable[..., FEMetricsData | FEMetricsError]
BEProbe = Callable[..., float | None]

_DEFAULT_FE_HTTP_PORT = 8030
_METRICS_TIMEOUT_SECONDS = 2.0


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


def _limited_mode_fe(host: str) -> FENodeInfo:
    """Build a best-effort FENodeInfo for non-cluster_admin users.

    `host` is the StarRocks address the caller already authenticated against
    (from `LoginRequest.host`, validated by the MySQL credential handshake in
    `get_connection`). `inject_fe_metrics` only reaches `http://{host}:8030/metrics`
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


# ── /metrics injection ──


def inject_be_metrics(
    backends: list[BENodeInfo],
    *,
    executor: ThreadPoolExecutor,
    probe: BEProbe,
) -> None:
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
        return be, probe(be.ip, be.http_port, timeout=_METRICS_TIMEOUT_SECONDS)

    futures = [executor.submit(_probe, be) for be in targets]
    for future in futures:
        be, pct = future.result()
        if pct is not None:
            be.cpu_used_pct = pct


def inject_fe_metrics(
    frontends: list[FENodeInfo],
    *,
    executor: ThreadPoolExecutor,
    probe: FEProbe,
) -> str | None:
    """Probe each FE's /metrics in parallel and populate the matching fields.

    Returns a metrics_warning string iff every FE probe failed (so the UI can
    show a single aggregate banner). Per-node failures set `metrics_error`.
    """
    if not frontends:
        return None

    def _probe(fe: FENodeInfo) -> tuple[FENodeInfo, FEMetricsData | FEMetricsError]:
        port = fe.http_port or _DEFAULT_FE_HTTP_PORT
        return fe, probe(fe.ip, port, timeout=_METRICS_TIMEOUT_SECONDS)

    # Submit all probes to the injected executor; collect futures in order.
    any_success = False
    futures = [executor.submit(_probe, fe) for fe in frontends]
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


# ── Orchestration ──


def collect_cluster_status(
    conn,
    *,
    host: str,
    execute_query: ExecuteQuery,
    fetch_fe_metrics: FEProbe,
    fetch_be_cpu_pct: BEProbe,
    metrics_executor: ThreadPoolExecutor,
) -> ClusterStatusResponse:
    """Run the 3 SHOW queries (with access-denied→limited downgrade), map rows,
    probe /metrics, and assemble the ClusterStatusResponse.

    The four I/O callables are injected by the router so its module-level
    monkeypatch seams keep working in tests. Non-access-denied DB errors
    propagate to the global errno→HTTP handler registered in main.py.
    """
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
            logger.debug("SHOW FRONTENDS denied → limited mode")
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
    metrics_warning = inject_fe_metrics(frontends, executor=metrics_executor, probe=fetch_fe_metrics)
    inject_be_metrics(backends, executor=metrics_executor, probe=fetch_be_cpu_pct)

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

    return ClusterStatusResponse(
        frontends=frontends,
        backends=backends,
        metrics=metrics,
        has_errors=has_errors,
        mode=mode,
        metrics_warning=metrics_warning,
        server_now=fetch_server_now(conn),
    )
