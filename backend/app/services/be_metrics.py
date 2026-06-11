"""BE /metrics probe — fills the CPU gap in SHOW BACKENDS.

SHOW BACKENDS reports memory but not CPU utilization (SHOW COMPUTE NODES does).
BE exposes a cumulative CPU-time counter on its HTTP port (default 8040):

    starrocks_be_cpu{mode="user"} 12345
    starrocks_be_cpu{mode="idle"} 67890
    ...

Utilization is the busy/total delta between two scrapes, so the first scrape
for a node yields None (no baseline yet) and a value appears from the second
poll onward. Last samples are kept in a module-level dict — fine for the
single-process deployment this app uses.

Everything here is best-effort: unreachable endpoint or missing metric lines
simply leave cpu_used_pct as None (the UI hides the bar).
"""

from __future__ import annotations

import logging
import re
import threading
import time
from dataclasses import dataclass

from app.services.fe_metrics import FEMetricsError, fetch_metrics_body

logger = logging.getLogger(__name__)

_CPU_LINE_RE = re.compile(r"^starrocks_be_cpu\{([^}]*)\}\s+([\d.eE+]+)", re.MULTILINE)
_MODE_RE = re.compile(r'mode="([^"]+)"')
_IDLE_MODES = {"idle", "iowait"}


@dataclass
class BECpuSample:
    busy: float
    total: float


def parse_cpu_sample(body: str) -> BECpuSample | None:
    """Sum starrocks_be_cpu counters into (busy, total). None if absent."""
    busy = 0.0
    total = 0.0
    for labels, value in _CPU_LINE_RE.findall(body):
        m = _MODE_RE.search(labels)
        if not m:
            continue
        try:
            v = float(value)
        except ValueError:
            continue
        total += v
        if m.group(1) not in _IDLE_MODES:
            busy += v
    return BECpuSample(busy=busy, total=total) if total > 0 else None


# node key ("ip:port") → (monotonic timestamp, sample)
_last_samples: dict[str, tuple[float, BECpuSample]] = {}
_samples_lock = threading.Lock()


def cpu_pct_from_delta(node_key: str, sample: BECpuSample) -> float | None:
    """Utilization between this sample and the previous one for the node."""
    now = time.monotonic()
    with _samples_lock:
        prev = _last_samples.get(node_key)
        _last_samples[node_key] = (now, sample)
    if prev is None:
        return None
    d_busy = sample.busy - prev[1].busy
    d_total = sample.total - prev[1].total
    if d_total <= 0:
        return None
    return round(max(0.0, min(100.0, d_busy / d_total * 100)), 2)


def fetch_be_cpu_pct(host: str, http_port: int, timeout: float = 2.0) -> float | None:
    """Scrape one BE's /metrics and return CPU utilization since the last scrape."""
    body = fetch_metrics_body(host, http_port, timeout=timeout)
    if isinstance(body, FEMetricsError):
        logger.debug("BE metrics fetch failed for %s:%s — %s", host, http_port, body.message)
        return None
    sample = parse_cpu_sample(body)
    if sample is None:
        return None
    return cpu_pct_from_delta(f"{host}:{http_port}", sample)
