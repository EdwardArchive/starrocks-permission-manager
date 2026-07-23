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

Node-list assembly, SHOW-row parsing, /metrics probing, and aggregate math live
in services/cluster_status.py; this router owns routing, the per-user TTL cache,
and the metrics executor (the module-level monkeypatch seam for tests).
"""

from __future__ import annotations

import logging
import threading
from concurrent.futures import ThreadPoolExecutor

import mysql.connector.errors
from fastapi import APIRouter, Depends, HTTPException, Query

from app.config import settings
from app.dependencies import get_credentials, get_db, require_grant_admin
from app.models.schemas import (
    ClusterHistoryResponse,
    ClusterQueriesResponse,
    ClusterStatusResponse,
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
from app.services.cluster_status import collect_cluster_status
from app.services.fe_metrics import fetch_fe_metrics
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


@router.get("/status", response_model=ClusterStatusResponse)
def get_cluster_status(
    conn=Depends(get_db),
    credentials: dict = Depends(get_credentials),
    refresh: bool = Query(False, description="Bypass per-user cache and force a live query"),
):
    """Return FE/BE/CN inventory + resource metrics.

    No require_admin guard — any logged-in user may call this. When StarRocks
    denies SHOW FRONTENDS (no cluster_admin role), the service falls back to a
    single-FE "limited" view so basic cluster health is still visible.

    Pass `?refresh=1` to bypass the cache for this request; the result is still
    written back to cache so the next non-refresh call remains fast.

    The DB/probe callables are read from this module's globals (the monkeypatch
    seam in tests) and injected into `collect_cluster_status`.
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
    result = collect_cluster_status(
        conn,
        host=host,
        execute_query=execute_query,
        fetch_fe_metrics=fetch_fe_metrics,
        fetch_be_cpu_pct=fetch_be_cpu_pct,
        metrics_executor=_metrics_executor,
    )

    _save(result.mode, result)
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
