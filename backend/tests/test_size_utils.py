"""Unit tests for size string helpers (parse_size_bytes / bytes_to_human)."""

from __future__ import annotations

import pytest
from app.services.shared.size_utils import bytes_to_human, parse_size_bytes

KB = 1024
MB = 1024**2
GB = 1024**3
TB = 1024**4
PB = 1024**5


class TestParseSizeBytes:
    def test_bytes_unit(self):
        assert parse_size_bytes("512 B") == 512.0

    def test_kb(self):
        assert parse_size_bytes("1 KB") == float(KB)

    def test_mb(self):
        assert parse_size_bytes("2 MB") == 2 * MB

    def test_gb_with_decimal(self):
        assert parse_size_bytes("256.78 GB") == 256.78 * GB

    def test_tb(self):
        assert parse_size_bytes("1.00 TB") == float(TB)

    def test_pb(self):
        assert parse_size_bytes("3 PB") == 3 * PB

    def test_case_insensitive_unit(self):
        assert parse_size_bytes("5 gb") == 5 * GB
        assert parse_size_bytes("5 Gb") == 5 * GB

    def test_surrounding_whitespace(self):
        assert parse_size_bytes("  7 MB  ") == 7 * MB

    def test_no_unit_treated_as_bytes(self):
        assert parse_size_bytes("1024") == 1024.0

    def test_malformed_number_with_unit_returns_zero(self):
        assert parse_size_bytes("abc GB") == 0.0

    def test_malformed_no_unit_returns_zero(self):
        assert parse_size_bytes("garbage") == 0.0

    def test_empty_string_returns_zero(self):
        assert parse_size_bytes("") == 0.0

    def test_none_raises_attribute_error(self):
        # No None guard: None.strip() raises — pins current behavior.
        with pytest.raises(AttributeError):
            parse_size_bytes(None)


class TestBytesToHuman:
    def test_zero(self):
        assert bytes_to_human(0) == "0 B"

    def test_sub_kb_bytes(self):
        assert bytes_to_human(500) == "500 B"

    def test_kb(self):
        assert bytes_to_human(1536) == "1.50 KB"

    def test_mb(self):
        assert bytes_to_human(2 * MB) == "2.00 MB"

    def test_gb(self):
        assert bytes_to_human(GB) == "1.00 GB"

    def test_tb(self):
        assert bytes_to_human(TB) == "1.00 TB"

    def test_pb(self):
        assert bytes_to_human(PB) == "1.00 PB"

    def test_above_pb_stays_in_pb(self):
        assert bytes_to_human(1024 * PB) == "1024.00 PB"


class TestRoundTrip:
    def test_gb_round_trip(self):
        assert bytes_to_human(parse_size_bytes("256.78 GB")) == "256.78 GB"

    def test_tb_round_trip(self):
        assert bytes_to_human(parse_size_bytes("1.00 TB")) == "1.00 TB"
