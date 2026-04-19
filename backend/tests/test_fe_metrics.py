"""Unit tests for the FE /metrics parser."""

from __future__ import annotations

import urllib.error
from unittest.mock import patch

import pytest

from app.services.fe_metrics import (
    FEMetricsData,
    FEMetricsError,
    _parse_metrics_body,
    fetch_fe_metrics,
)


SAMPLE_FULL = """\
jvm_heap_size_bytes{type="used"} 400000000
jvm_heap_size_bytes{type="max"} 8000000000
jvm_heap_size_bytes{type="committed"} 1000000000
jvm_young_gc{type="count"} 8694
jvm_young_gc{type="time"} 23370
jvm_old_gc{type="count"} 2
jvm_old_gc{type="time"} 150
starrocks_fe_query_latency{type="50_quantile"} 1.2
starrocks_fe_query_latency{type="95_quantile"} 4.8
starrocks_fe_query_latency{type="99_quantile"} 9.7
starrocks_fe_unrelated_metric 42
"""


def test_parse_full_payload():
    data = _parse_metrics_body(SAMPLE_FULL)
    assert isinstance(data, FEMetricsData)
    assert data.heap_used_pct == pytest.approx(5.0)  # 400M / 8G * 100
    assert data.gc_young_count == 8694
    assert data.gc_young_time_ms == 23370
    assert data.gc_old_count == 2
    assert data.gc_old_time_ms == 150
    assert data.query_p99_ms == pytest.approx(9.7)


def test_parse_missing_lines_partial_none():
    body = 'jvm_heap_size_bytes{type="used"} 100\njvm_heap_size_bytes{type="max"} 1000'
    data = _parse_metrics_body(body)
    assert data.heap_used_pct == pytest.approx(10.0)
    assert data.gc_young_count is None
    assert data.gc_old_count is None
    assert data.query_p99_ms is None


def test_parse_empty_body():
    data = _parse_metrics_body("")
    assert all(v is None for v in data.__dict__.values())


def test_parse_max_zero_heap_pct_none():
    body = 'jvm_heap_size_bytes{type="used"} 100\njvm_heap_size_bytes{type="max"} 0'
    data = _parse_metrics_body(body)
    assert data.heap_used_pct is None


def test_fetch_network_error():
    with patch("app.services.fe_metrics.urllib.request.urlopen") as m:
        m.side_effect = urllib.error.URLError("Connection refused")
        result = fetch_fe_metrics("nohost", 8030, timeout=0.1)
    assert isinstance(result, FEMetricsError)
    assert result.reason == "network"


def test_fetch_timeout():
    with patch("app.services.fe_metrics.urllib.request.urlopen") as m:
        m.side_effect = TimeoutError("timed out")
        result = fetch_fe_metrics("nohost", 8030, timeout=0.1)
    assert isinstance(result, FEMetricsError)
    assert result.reason == "timeout"


def test_fetch_http_error_status():
    class _FakeHTTPError(urllib.error.HTTPError):
        def __init__(self):
            super().__init__(url="http://x", code=500, msg="Server Error", hdrs=None, fp=None)

    with patch("app.services.fe_metrics.urllib.request.urlopen") as m:
        m.side_effect = _FakeHTTPError()
        result = fetch_fe_metrics("nohost", 8030, timeout=0.1)
    assert isinstance(result, FEMetricsError)
    assert result.reason == "http_status"
    assert "500" in result.message


def test_fetch_success_parses_body():
    class _FakeResp:
        status = 200

        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

        def read(self):
            return SAMPLE_FULL.encode()

    with patch("app.services.fe_metrics.urllib.request.urlopen") as m:
        m.return_value = _FakeResp()
        result = fetch_fe_metrics("host", 8030, timeout=0.1)
    assert isinstance(result, FEMetricsData)
    assert result.heap_used_pct == pytest.approx(5.0)
    assert result.query_p99_ms == pytest.approx(9.7)
