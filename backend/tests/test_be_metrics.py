"""Unit tests for the BE /metrics CPU probe (services/be_metrics.py)."""

from __future__ import annotations

import pytest

from app.services.be_metrics import (
    BECpuSample,
    _last_samples,
    cpu_pct_from_delta,
    parse_cpu_sample,
)

SAMPLE_BODY = """\
# TYPE starrocks_be_cpu counter
starrocks_be_cpu{mode="user"} 1000
starrocks_be_cpu{mode="system"} 500
starrocks_be_cpu{mode="idle"} 8000
starrocks_be_cpu{mode="iowait"} 500
starrocks_be_cpu{mode="nice"} 0
# TYPE starrocks_be_process_mem_bytes gauge
starrocks_be_process_mem_bytes 123456789
"""


@pytest.fixture(autouse=True)
def _clear_samples():
    _last_samples.clear()
    yield
    _last_samples.clear()


def test_parse_cpu_sample():
    sample = parse_cpu_sample(SAMPLE_BODY)
    assert sample is not None
    # busy = user + system + nice = 1500; total = 10000
    assert sample.busy == pytest.approx(1500.0)
    assert sample.total == pytest.approx(10000.0)


def test_parse_cpu_sample_absent():
    assert parse_cpu_sample("jvm_heap_size_bytes{type=\"used\"} 123\n") is None
    assert parse_cpu_sample("") is None


def test_cpu_pct_first_scrape_is_none():
    assert cpu_pct_from_delta("n1:8040", BECpuSample(busy=1500, total=10000)) is None


def test_cpu_pct_delta():
    assert cpu_pct_from_delta("n1:8040", BECpuSample(busy=1500, total=10000)) is None
    # +250 busy out of +1000 total → 25%
    pct = cpu_pct_from_delta("n1:8040", BECpuSample(busy=1750, total=11000))
    assert pct == pytest.approx(25.0)


def test_cpu_pct_counter_reset_returns_none():
    """BE restart resets counters → negative delta must not produce garbage."""
    assert cpu_pct_from_delta("n1:8040", BECpuSample(busy=1500, total=10000)) is None
    assert cpu_pct_from_delta("n1:8040", BECpuSample(busy=10, total=100)) is None


def test_cpu_pct_per_node_isolation():
    assert cpu_pct_from_delta("n1:8040", BECpuSample(busy=1500, total=10000)) is None
    assert cpu_pct_from_delta("n2:8040", BECpuSample(busy=0, total=10000)) is None
    pct1 = cpu_pct_from_delta("n1:8040", BECpuSample(busy=2500, total=11000))
    pct2 = cpu_pct_from_delta("n2:8040", BECpuSample(busy=100, total=11000))
    assert pct1 == pytest.approx(100.0)
    assert pct2 == pytest.approx(10.0)
