"""Unit tests for the Layer 1 table-detail service (services/common/table_ddl.py).

Covers the pure DDL-parse helpers (regex parsing) and the fetch_table_detail
assembly, including its best-effort per-query failure branches, driven directly
against FakeConnection (no route / TestClient needed).
"""

from __future__ import annotations

import pytest
from app.services.common.table_ddl import (
    _parse_distribution,
    _parse_key_type,
    _parse_partition,
    _parse_property,
    fetch_table_detail,
)

from tests.conftest import DEFAULT_QUERY_MAP, FakeConnection


# ── _parse_key_type ──
@pytest.mark.parametrize(
    "ddl, expected",
    [
        ("CREATE TABLE t (...) DUPLICATE KEY(`id`)", "DUPLICATE KEY"),
        ("CREATE TABLE t (...) PRIMARY KEY(`id`)", "PRIMARY KEY"),
        ("CREATE TABLE t (...) UNIQUE KEY(`id`)", "UNIQUE KEY"),
        ("CREATE TABLE t (...) AGGREGATE KEY(`id`)", "AGGREGATE KEY"),
        ("create table t (...) duplicate key(`id`)", "DUPLICATE KEY"),  # case-insensitive
        ("CREATE EXTERNAL TABLE t (...)", "EXTERNAL"),
        ("CREATE VIEW v AS SELECT 1", None),
    ],
)
def test_parse_key_type(ddl, expected):
    assert _parse_key_type(ddl) == expected


# ── _parse_distribution ──
def test_parse_distribution_hash_single():
    assert _parse_distribution("DISTRIBUTED BY HASH(`event_id`) BUCKETS 16") == ("Hash", ["event_id"], "16")


def test_parse_distribution_hash_multi():
    assert _parse_distribution("DISTRIBUTED BY HASH(`a`, `b`) BUCKETS 8") == ("Hash", ["a", "b"], "8")


def test_parse_distribution_random():
    assert _parse_distribution("DISTRIBUTED BY RANDOM BUCKETS 4") == ("Random", None, "4")


def test_parse_distribution_case_insensitive():
    assert _parse_distribution("distributed by hash(`x`) buckets 3") == ("Hash", ["x"], "3")


def test_parse_distribution_none():
    assert _parse_distribution("CREATE TABLE t (id INT)") == (None, None, None)


# ── _parse_partition ──
def test_parse_partition_range():
    assert _parse_partition("PARTITION BY RANGE(`event_date`)") == ("RANGE", "event_date")


def test_parse_partition_list():
    assert _parse_partition("PARTITION BY LIST(`region`)") == ("LIST", "region")


def test_parse_partition_generic():
    # A non-RANGE/LIST function partition → generic branch (method upper-cased).
    assert _parse_partition("PARTITION BY date_trunc(`dt`)") == ("DATE_TRUNC", "dt")


def test_parse_partition_simple():
    # Bare column-list partition (no function) → simple branch, comma-joined.
    assert _parse_partition("PARTITION BY (`c1`, `c2`)") == ("PARTITION", "c1, c2")


def test_parse_partition_none():
    assert _parse_partition("CREATE TABLE t (id INT)") == (None, None)


# ── _parse_property ──
@pytest.mark.parametrize(
    "key, expected",
    [
        ("replication_num", "3"),
        ("storage_medium", "SSD"),
        ("compression", "LZ4"),
        ("missing_key", None),
    ],
)
def test_parse_property(key, expected):
    ddl = 'PROPERTIES ("replication_num" = "3", "storage_medium" = "SSD", "compression" = "LZ4")'
    assert _parse_property(ddl, key) == expected


def test_parse_property_case_insensitive():
    assert _parse_property('"REPLICATION_NUM" = "5"', "replication_num") == "5"


def test_parse_property_empty_value():
    assert _parse_property('"compression" = ""', "compression") == ""


# ── fetch_table_detail: assembly ──
def test_fetch_table_detail_happy():
    conn = FakeConnection(dict(DEFAULT_QUERY_MAP))
    d = fetch_table_detail(conn, "default_catalog", "analytics_db", "user_events")
    assert d.table_name == "user_events"
    assert d.table_type == "BASE TABLE"
    assert d.engine == "StarRocks"
    assert d.row_count == 12847293
    assert len(d.columns) == 2
    assert d.columns[0].name == "event_id"
    # DDL-parsed StarRocks metadata
    assert d.key_type == "DUPLICATE KEY"
    assert d.distribution_type == "Hash"
    assert d.bucket_keys == ["event_id"]
    assert d.bucket_count == 16
    assert d.partition_method == "RANGE"
    assert d.partition_key == "event_date"
    assert d.partition_count == 365
    assert d.replication_num == 3
    assert d.storage_medium == "SSD"
    assert d.compression == "LZ4"


def test_fetch_table_detail_external_random_no_partition():
    qmap = dict(DEFAULT_QUERY_MAP)
    qmap["SHOW CREATE TABLE"] = [
        {
            "Create Table": (
                "CREATE EXTERNAL TABLE `ext_t` (\n"
                "  `id` BIGINT\n"
                ") ENGINE=OLAP\n"
                "DISTRIBUTED BY RANDOM BUCKETS 4\n"
                'PROPERTIES ("replication_num" = "1")'
            )
        }
    ]
    # External tables have no partitions_meta rows.
    qmap["SELECT COUNT(*) as cnt FROM information_schema.partitions_meta"] = []
    conn = FakeConnection(qmap)
    d = fetch_table_detail(conn, "hive_catalog", "ext_db", "ext_t")
    assert d.key_type == "EXTERNAL"
    assert d.distribution_type == "Random"
    assert d.bucket_keys is None
    assert d.bucket_count == 4
    assert d.partition_method is None
    assert d.partition_key is None
    assert d.partition_count is None
    assert d.replication_num == 1
    assert d.storage_medium is None
    assert d.compression is None


def test_fetch_table_detail_missing_ddl():
    # SHOW CREATE TABLE yields no rows → ddl None → all parsed fields None.
    qmap = dict(DEFAULT_QUERY_MAP)
    qmap["SHOW CREATE TABLE"] = []
    conn = FakeConnection(qmap)
    d = fetch_table_detail(conn, "default_catalog", "analytics_db", "user_events")
    assert d.ddl is None
    assert d.key_type is None
    assert d.distribution_type is None
    assert d.partition_method is None


@pytest.mark.parametrize(
    "fail_prefix",
    [
        "SET CATALOG",
        "USE",
        "SELECT TABLE_NAME, TABLE_TYPE, ENGINE",
        "SELECT COLUMN_NAME",
        "SHOW CREATE TABLE",
        "SELECT COUNT(*) as cnt FROM information_schema.partitions_meta",
    ],
)
def test_fetch_table_detail_swallows_query_failures(fail_prefix):
    # Each step is best-effort: a single failing query must not raise; a
    # TableDetail is still returned (table_name falls back to the requested name).
    conn = FakeConnection(dict(DEFAULT_QUERY_MAP), fail_prefixes={fail_prefix: RuntimeError("injected")})
    d = fetch_table_detail(conn, "default_catalog", "analytics_db", "user_events")
    assert d.table_name
