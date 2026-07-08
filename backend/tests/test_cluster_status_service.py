"""Unit tests for the pure helpers extracted into services/cluster_status.py.

These pin the coercion / size / datacache parsers directly — the edge branches
(None, malformed strings, empty lists) that the HTTP-level tests in
test_cluster_status.py never exercise because the fixture rows are always
well-formed. Orchestration (collect_cluster_status) is covered via the router
tests; here we only pin the byte-identical-critical parsing primitives.
"""

from __future__ import annotations

import pytest
from app.services.cluster_status import (
    _human_size_sum,
    _parse_bool,
    _parse_datacache_disk,
    _parse_float,
    _parse_int,
)

# ── _parse_bool ──


def test_parse_bool_true_string():
    assert _parse_bool("true") is True
    assert _parse_bool("TRUE") is True
    assert _parse_bool("false") is False


def test_parse_bool_native_bool_passthrough():
    assert _parse_bool(True) is True
    assert _parse_bool(False) is False


def test_parse_bool_non_bool_non_str_coerced():
    # int / None fall through to bool(val)
    assert _parse_bool(1) is True
    assert _parse_bool(0) is False
    assert _parse_bool(None) is False


# ── _parse_int ──


def test_parse_int_valid():
    assert _parse_int("42") == 42
    assert _parse_int(" 7 ") == 7


def test_parse_int_none_and_malformed_return_none():
    assert _parse_int(None) is None
    assert _parse_int("abc") is None
    assert _parse_int("1.5") is None  # int() rejects a float string


# ── _parse_float ──


def test_parse_float_valid_strips_percent():
    assert _parse_float("30.0 %") == pytest.approx(30.0)
    assert _parse_float("12.5") == pytest.approx(12.5)


def test_parse_float_none_and_malformed_return_none():
    assert _parse_float(None) is None
    assert _parse_float("n/a") is None


# ── _human_size_sum ──


def test_human_size_sum_empty_is_none():
    assert _human_size_sum([]) is None


def test_human_size_sum_totals():
    # 256.78 GB + 180.50 GB → 437.28 GB (matches the aggregate in the fixture)
    assert _human_size_sum(["256.78 GB", "180.50 GB"]) == "437.28 GB"


# ── _parse_datacache_disk ──


def test_parse_datacache_disk_none_and_no_match():
    assert _parse_datacache_disk(None) == (None, None, None)
    assert _parse_datacache_disk("") == (None, None, None)
    assert _parse_datacache_disk("Status: Normal, MemUsage: 35MB/15GB") == (None, None, None)


def test_parse_datacache_disk_valid():
    used, total, pct = _parse_datacache_disk("Status: Normal, DiskUsage: 200MB/10GB")
    assert used == "200MB"
    assert total == "10GB"
    assert pct == pytest.approx(1.95, abs=0.05)
