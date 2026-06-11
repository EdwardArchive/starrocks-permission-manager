"""Collect currently running queries with resource usage.

Data sources (validated against StarRocks 4.0.8):
* ``SHOW PROC '/global_current_queries'`` — per-query resource stats
  (ScanBytes, ScanRows, MemoryUsage, DiskSpillSize, CPUTime, ExecTime,
  ExecState, ...) aggregated across **all frontends**. Carries **no SQL
  text**, and FE-only statements (e.g. ``SELECT sleep()``) do not appear.
  ``'/current_queries'`` is FE-local — behind a load balancer each request
  lands on a random FE and would miss queries coordinated elsewhere — so it
  is only used as a fallback for versions without the global variant.
* ``SHOW FULL PROCESSLIST`` — connection list (all FEs) whose ``Info`` column
  holds the SQL text. Joined on ConnectionId to attach the statement.

StarRocks gates these commands behind the OPERATE (cluster_admin) privilege;
access-denied errors propagate to the global errno→403 handler in main.py.

Numeric sort keys (``*_bytes``, ``*_ms``, ``scan_rows``) are parsed from the
human-readable strings so the frontend can sort without re-parsing; the raw
strings are kept alongside for display.
"""

from __future__ import annotations

import logging
import re
from datetime import datetime

import mysql.connector.errors

from app.models.schemas import RunningQueryInfo
from app.services.shared.size_utils import parse_size_bytes
from app.services.starrocks_client import execute_query
from app.utils.sys_access import is_access_denied

logger = logging.getLogger(__name__)

# Durations come as strings like "0.478 s", "2.126 s"; be tolerant of other
# unit spellings ("123 ms", "1m 5s") just in case the format varies by version.
_DURATION_RE = re.compile(r"(\d+(?:\.\d+)?)\s*(ms|s|m|h|d)\b", re.IGNORECASE)
_DURATION_FACTORS_MS = {
    "ms": 1.0,
    "s": 1000.0,
    "m": 60_000.0,
    "h": 3_600_000.0,
    "d": 86_400_000.0,
}


def _clean(val) -> str | None:
    if val is None:
        return None
    s = str(val).strip()
    return s or None


def parse_duration_ms(val) -> float | None:
    """Parse '2.126 s' / '123 ms' / '1m 5s' → milliseconds. None if unparseable."""
    if val is None:
        return None
    matches = _DURATION_RE.findall(str(val))
    if not matches:
        return None
    return sum(float(num) * _DURATION_FACTORS_MS[unit.lower()] for num, unit in matches)


def parse_row_count(val) -> int | None:
    """Parse '1787602878 rows' (commas tolerated) → int. None if no digits."""
    if val is None:
        return None
    digits = re.sub(r"[^\d]", "", str(val))
    return int(digits) if digits else None


def _parse_size(raw: str | None) -> float | None:
    if raw is None:
        return None
    return parse_size_bytes(raw)


def _row_to_query(row: dict, sql_by_conn: dict[str, str]) -> RunningQueryInfo:
    conn_id_str = _clean(row.get("ConnectionId"))
    scan_bytes_raw = _clean(row.get("ScanBytes"))
    memory_raw = _clean(row.get("MemoryUsage"))
    spill_raw = _clean(row.get("DiskSpillSize"))
    return RunningQueryInfo(
        query_id=str(row.get("QueryId") or ""),
        connection_id=int(conn_id_str) if conn_id_str and conn_id_str.isdigit() else None,
        user=str(row.get("User") or ""),
        database=_clean(row.get("Database")),
        start_time=_clean(row.get("StartTime")),
        fe_ip=_clean(row.get("feIp")),
        warehouse=_clean(row.get("Warehouse")),
        resource_group=_clean(row.get("ResourceGroup")),
        exec_state=_clean(row.get("ExecState")),
        exec_progress=_clean(row.get("ExecProgress")),
        scan_rows=parse_row_count(row.get("ScanRows")),
        scan_bytes=_parse_size(scan_bytes_raw),
        scan_bytes_display=scan_bytes_raw,
        memory_bytes=_parse_size(memory_raw),
        memory_display=memory_raw,
        spill_bytes=_parse_size(spill_raw),
        spill_display=spill_raw,
        cpu_time_ms=parse_duration_ms(row.get("CPUTime")),
        cpu_time_display=_clean(row.get("CPUTime")),
        exec_time_ms=parse_duration_ms(row.get("ExecTime")),
        exec_time_display=_clean(row.get("ExecTime")),
        sql=sql_by_conn.get(conn_id_str) if conn_id_str else None,
    )


def collect_running_queries(conn) -> list[RunningQueryInfo]:
    """Fetch running queries and attach SQL text via the processlist join."""
    try:
        rows = execute_query(conn, "SHOW PROC '/global_current_queries'")
    except mysql.connector.errors.Error as exc:
        if is_access_denied(exc):
            raise
        # Older versions lack the global variant — fall back to the FE-local view.
        logger.info("global_current_queries unavailable, falling back to FE-local: %s", exc)
        rows = execute_query(conn, "SHOW PROC '/current_queries'")

    sql_by_conn: dict[str, str] = {}
    try:
        for p in execute_query(conn, "SHOW FULL PROCESSLIST"):
            cid = _clean(p.get("Id"))
            info = _clean(p.get("Info"))
            if cid and info:
                sql_by_conn[cid] = info
    except Exception as exc:  # noqa: BLE001 — queries are still useful without SQL text
        logger.warning("SHOW FULL PROCESSLIST failed; returning queries without SQL text: %s", exc)

    return [_row_to_query(r, sql_by_conn) for r in rows]


def fetch_server_now(conn) -> str | None:
    """Cluster wall clock as 'YYYY-MM-DD HH:MM:SS' (cluster timezone).

    Used by the frontend as the reference for relative-time labels, since node
    timestamps from SHOW commands are naive strings in the cluster's timezone
    (not necessarily UTC). Best-effort: returns None on any failure.
    """
    try:
        rows = execute_query(conn, "SELECT NOW() AS server_now")
        val = rows[0]["server_now"] if rows else None
    except Exception as exc:  # noqa: BLE001 — clock is auxiliary; never fail the endpoint
        logger.warning("SELECT NOW() failed: %s", exc)
        return None
    if isinstance(val, datetime):
        return val.strftime("%Y-%m-%d %H:%M:%S")
    return _clean(val)
