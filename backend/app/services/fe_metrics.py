"""Mini Prometheus text-format parser + HTTP fetcher for StarRocks FE /metrics.

StarRocks FE exposes an unauthenticated Prometheus-compatible `/metrics` endpoint on
the FE HTTP port (default 8030). We use it to augment cluster status with JVM heap,
GC, and query p99 latency — information not available via SHOW FRONTENDS.

Only a small, curated subset of metrics is parsed (intentionally shallow detail).
"""

from __future__ import annotations

import logging
import re
import urllib.error
import urllib.request
from dataclasses import dataclass

logger = logging.getLogger(__name__)


@dataclass
class FEMetricsData:
    heap_used_pct: float | None = None
    gc_young_count: int | None = None
    gc_young_time_ms: int | None = None
    gc_old_count: int | None = None
    gc_old_time_ms: int | None = None
    query_p99_ms: float | None = None


@dataclass
class FEMetricsError:
    reason: str  # "timeout" | "network" | "http_status" | "parse" | "unknown"
    message: str


# Regex patterns that extract the specific metric lines we need.
# Prometheus text format: <metric_name>{labels} <value>
_HEAP_USED_RE = re.compile(r'^jvm_heap_size_bytes\{type="used"\}\s+([\d.eE+-]+)', re.MULTILINE)
_HEAP_MAX_RE = re.compile(r'^jvm_heap_size_bytes\{type="max"\}\s+([\d.eE+-]+)', re.MULTILINE)
_GC_YOUNG_COUNT_RE = re.compile(r'^jvm_young_gc\{type="count"\}\s+(\d+)', re.MULTILINE)
_GC_YOUNG_TIME_RE = re.compile(r'^jvm_young_gc\{type="time"\}\s+(\d+)', re.MULTILINE)
_GC_OLD_COUNT_RE = re.compile(r'^jvm_old_gc\{type="count"\}\s+(\d+)', re.MULTILINE)
_GC_OLD_TIME_RE = re.compile(r'^jvm_old_gc\{type="time"\}\s+(\d+)', re.MULTILINE)
_P99_RE = re.compile(r'^starrocks_fe_query_latency\{type="99_quantile"\}\s+([\d.eE+-]+)', re.MULTILINE)


def _extract_float(pattern: re.Pattern, body: str) -> float | None:
    m = pattern.search(body)
    if not m:
        return None
    try:
        return float(m.group(1))
    except (ValueError, TypeError):
        return None


def _extract_int(pattern: re.Pattern, body: str) -> int | None:
    m = pattern.search(body)
    if not m:
        return None
    try:
        return int(m.group(1))
    except (ValueError, TypeError):
        return None


def _parse_metrics_body(body: str) -> FEMetricsData:
    """Parse the targeted metric lines. Missing lines → that field stays None."""
    heap_used = _extract_float(_HEAP_USED_RE, body)
    heap_max = _extract_float(_HEAP_MAX_RE, body)
    heap_pct: float | None = None
    if heap_used is not None and heap_max is not None and heap_max > 0:
        heap_pct = round(heap_used / heap_max * 100, 2)

    return FEMetricsData(
        heap_used_pct=heap_pct,
        gc_young_count=_extract_int(_GC_YOUNG_COUNT_RE, body),
        gc_young_time_ms=_extract_int(_GC_YOUNG_TIME_RE, body),
        gc_old_count=_extract_int(_GC_OLD_COUNT_RE, body),
        gc_old_time_ms=_extract_int(_GC_OLD_TIME_RE, body),
        query_p99_ms=_extract_float(_P99_RE, body),
    )


def fetch_fe_metrics(
    host: str,
    http_port: int,
    timeout: float = 2.0,
) -> FEMetricsData | FEMetricsError:
    """Fetch and parse FE /metrics. Returns FEMetricsError on any failure."""
    url = f"http://{host}:{http_port}/metrics"
    try:
        req = urllib.request.Request(url, headers={"Accept": "text/plain"})
        with urllib.request.urlopen(req, timeout=timeout) as resp:  # noqa: S310  (trusted internal URL)
            status = resp.status
            if status != 200:
                return FEMetricsError(reason="http_status", message=f"HTTP {status}")
            body = resp.read().decode("utf-8", errors="replace")
    except TimeoutError:
        return FEMetricsError(reason="timeout", message=f"timeout after {timeout}s")
    except urllib.error.HTTPError as exc:
        return FEMetricsError(reason="http_status", message=f"HTTP {exc.code}")
    except urllib.error.URLError as exc:
        return FEMetricsError(reason="network", message=str(exc.reason))
    except Exception as exc:  # noqa: BLE001  - graceful degradation is the goal
        logger.debug("Unexpected /metrics fetch error for %s:%s: %s", host, http_port, exc)
        return FEMetricsError(reason="unknown", message=str(exc))

    try:
        return _parse_metrics_body(body)
    except Exception as exc:  # noqa: BLE001
        logger.debug("Parse error for %s:%s: %s", host, http_port, exc)
        return FEMetricsError(reason="parse", message=str(exc))
