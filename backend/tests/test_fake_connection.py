"""Unit tests for the FakeConnection test double itself (conftest.py).

Pins the opt-in strict mode + failure-injection behaviour that the endpoint
characterization tests rely on.
"""
from __future__ import annotations

import pytest

from tests.conftest import FakeConnection


def test_default_mode_returns_empty_on_miss():
    """Without strict mode, an unmatched SQL silently returns [] (unchanged)."""
    conn = FakeConnection({"SELECT 1": [{"1": 1}]})
    cur = conn.cursor()
    cur.execute("SELECT 42 FROM nowhere")
    assert cur.fetchall() == []
    # The miss is recorded even in non-strict mode.
    assert conn.unmatched == ["SELECT 42 FROM nowhere"]


def test_strict_mode_raises_with_offending_sql():
    """Strict mode raises AssertionError whose message includes the SQL text."""
    conn = FakeConnection({"SELECT 1": [{"1": 1}]}, strict=True)
    cur = conn.cursor()
    with pytest.raises(AssertionError, match="SELECT 42 FROM nowhere"):
        cur.execute("SELECT 42 FROM nowhere")
    assert conn.unmatched == ["SELECT 42 FROM nowhere"]


def test_strict_mode_allows_explicit_empty_mapping():
    """Escape hatch: a prefix mapped to [] is a match, so strict mode allows it."""
    conn = FakeConnection({"SET CATALOG": []}, strict=True)
    cur = conn.cursor()
    cur.execute("SET CATALOG `analytics`")  # matches "SET CATALOG" → no raise
    assert cur.fetchall() == []
    assert conn.unmatched == []


def test_strict_flag_can_be_flipped_after_construction():
    """A test can opt in by flipping the public flag on an existing fake."""
    conn = FakeConnection({"SELECT 1": [{"1": 1}]})
    conn.strict = True
    cur = conn.cursor()
    with pytest.raises(AssertionError):
        cur.execute("SHOW DATABASES")


def test_fail_prefixes_raise_mapped_exception():
    """fail_prefixes makes a matching SQL raise the given exception."""
    boom = RuntimeError("boom")
    conn = FakeConnection({"SHOW CATALOGS": [{"Catalog": "x"}]}, fail_prefixes={"SHOW CATALOGS": boom})
    cur = conn.cursor()
    with pytest.raises(RuntimeError, match="boom"):
        cur.execute("SHOW CATALOGS")
    # Non-failing prefixes still resolve normally.
    cur.execute("SELECT 1")
    assert cur.fetchall() == []
