"""Layer 1 service: table-detail assembly + StarRocks DDL parsing.

Uses only INFORMATION_SCHEMA + SHOW commands (no sys.* tables). Assembles the
TableDetail response for /api/user/objects/table-detail and parses
StarRocks-specific metadata (key type, distribution, partition, table
properties) out of SHOW CREATE TABLE output.
"""

from __future__ import annotations

import logging
import re

from app.models.schemas import ColumnInfo, TableDetail
from app.services.shared.row_utils import col
from app.services.starrocks_client import execute_query, execute_single
from app.utils.sql_safety import safe_identifier, set_catalog

logger = logging.getLogger(__name__)

# ── Compiled regex patterns ──
_RE_HASH_DIST = re.compile(r"DISTRIBUTED BY HASH\(([^)]+)\)\s*BUCKETS\s*(\d+)", re.I)
_RE_RANDOM_DIST = re.compile(r"DISTRIBUTED BY RANDOM\s*BUCKETS\s*(\d+)", re.I)
_RE_PARTITION_RANGE = re.compile(r"PARTITION BY RANGE\(([^)]+)\)", re.I)
_RE_PARTITION_LIST = re.compile(r"PARTITION BY LIST\(([^)]+)\)", re.I)
_RE_PARTITION_GENERIC = re.compile(r"PARTITION BY\s+(\w+)\(([^)]+)\)", re.I)
_RE_PARTITION_SIMPLE = re.compile(r"PARTITION BY\s*\(([^)]+)\)", re.I)


def fetch_table_detail(conn, catalog: str, database: str, table: str) -> TableDetail:
    # Set catalog and database context
    try:
        set_catalog(conn, catalog)
    except Exception as e:
        logger.warning(f"SET CATALOG failed: {e}")
    try:
        execute_query(conn, f"USE `{safe_identifier(database)}`")
    except Exception as e:
        logger.warning(f"USE database failed: {e}")

    # Common: information_schema.tables
    tbl = {}
    try:
        tbl = (
            execute_single(
                conn,
                "SELECT TABLE_NAME, TABLE_TYPE, ENGINE, TABLE_ROWS, DATA_LENGTH, "
                "CREATE_TIME, UPDATE_TIME, TABLE_COMMENT "
                "FROM information_schema.tables WHERE TABLE_SCHEMA = %s AND TABLE_NAME = %s",
                (database, table),
            )
            or {}
        )
    except Exception as e:
        logger.warning(f"information_schema.tables query failed: {e}")

    # Common: information_schema.columns
    col_rows = []
    try:
        col_rows = execute_query(
            conn,
            "SELECT COLUMN_NAME, COLUMN_TYPE, ORDINAL_POSITION, IS_NULLABLE, "
            "COLUMN_DEFAULT, COLUMN_KEY, COLUMN_COMMENT "
            "FROM information_schema.columns WHERE TABLE_SCHEMA = %s AND TABLE_NAME = %s "
            "ORDER BY ORDINAL_POSITION",
            (database, table),
        )
    except Exception as e:
        logger.warning(f"information_schema.columns query failed: {e}")
    columns = [
        ColumnInfo(
            name=col(c, "COLUMN_NAME") or "",
            column_type=col(c, "COLUMN_TYPE") or "",
            ordinal_position=col(c, "ORDINAL_POSITION") or 0,
            is_nullable=col(c, "IS_NULLABLE") or "YES",
            column_default=col(c, "COLUMN_DEFAULT"),
            column_key=col(c, "COLUMN_KEY"),
            comment=col(c, "COLUMN_COMMENT"),
        )
        for c in col_rows
    ]

    # DDL (works across most catalogs)
    ddl = None
    try:
        ddl_row = execute_single(conn, f"SHOW CREATE TABLE `{safe_identifier(database)}`.`{safe_identifier(table)}`")
        if ddl_row:
            ddl = (
                ddl_row.get("Create Table")
                or ddl_row.get("Create View")
                or ddl_row.get("Create Materialized View")
                or ddl_row.get("create table")
                or ddl_row.get("create view")
                or ""
            )
    except Exception as e:
        logger.warning(f"SHOW CREATE TABLE failed: {e}")

    # Internal-only: parse DDL for StarRocks-specific metadata
    key_type = None
    distribution_type = None
    bucket_keys = None
    bucket_count = None
    partition_method = None
    partition_key = None
    partition_count = None
    replication_num = None
    storage_medium = None
    compression = None

    if ddl:
        key_type = _parse_key_type(ddl)
        distribution_type, bucket_keys, bucket_count = _parse_distribution(ddl)
        partition_method, partition_key = _parse_partition(ddl)
        replication_num = _parse_property(ddl, "replication_num")
        storage_medium = _parse_property(ddl, "storage_medium")
        compression = _parse_property(ddl, "compression")

    # Internal-only: partition count from partitions_meta
    try:
        pcount = execute_single(
            conn,
            "SELECT COUNT(*) as cnt FROM information_schema.partitions_meta WHERE DB_NAME = %s AND TABLE_NAME = %s",
            (database, table),
        )
        if pcount:
            partition_count = pcount.get("cnt") or pcount.get("CNT")
    except Exception as e:
        logger.debug(f"partitions_meta query failed (expected for external): {e}")

    return TableDetail(
        table_name=col(tbl, "TABLE_NAME") or table,
        table_type=col(tbl, "TABLE_TYPE") or "",
        engine=col(tbl, "ENGINE"),
        row_count=col(tbl, "TABLE_ROWS"),
        data_size=col(tbl, "DATA_LENGTH"),
        create_time=str(col(tbl, "CREATE_TIME") or ""),
        update_time=str(col(tbl, "UPDATE_TIME") or ""),
        comment=col(tbl, "TABLE_COMMENT"),
        columns=columns,
        ddl=ddl,
        key_type=key_type,
        distribution_type=distribution_type,
        bucket_keys=bucket_keys,
        bucket_count=int(bucket_count) if bucket_count else None,
        partition_method=partition_method,
        partition_key=partition_key,
        partition_count=int(partition_count) if partition_count else None,
        replication_num=int(replication_num) if replication_num else None,
        storage_medium=storage_medium,
        compression=compression,
    )


def _parse_key_type(ddl: str) -> str | None:
    ddl_upper = ddl.upper()
    for kt in ("PRIMARY KEY", "UNIQUE KEY", "AGGREGATE KEY", "DUPLICATE KEY"):
        if kt in ddl_upper:
            return kt
    if "CREATE EXTERNAL TABLE" in ddl_upper:
        return "EXTERNAL"
    return None


def _parse_distribution(ddl: str) -> tuple[str | None, list[str] | None, str | None]:
    m = _RE_HASH_DIST.search(ddl)
    if m:
        keys = [k.strip().strip("`") for k in m.group(1).split(",")]
        return "Hash", keys, m.group(2)
    m = _RE_RANDOM_DIST.search(ddl)
    if m:
        return "Random", None, m.group(1)
    return None, None, None


def _parse_partition(ddl: str) -> tuple[str | None, str | None]:
    m = _RE_PARTITION_RANGE.search(ddl)
    if m:
        return "RANGE", m.group(1).strip().strip("`")
    m = _RE_PARTITION_LIST.search(ddl)
    if m:
        return "LIST", m.group(1).strip().strip("`")
    m = _RE_PARTITION_GENERIC.search(ddl)
    if m:
        return m.group(1).upper(), m.group(2).strip().strip("`")
    m = _RE_PARTITION_SIMPLE.search(ddl)
    if m:
        cols = ", ".join(c.strip().strip("`") for c in m.group(1).split(","))
        return "PARTITION", cols
    return None, None


def _parse_property(ddl: str, key: str) -> str | None:
    m = re.search(rf'"{key}"\s*=\s*"([^"]*)"', ddl, re.I)
    return m.group(1) if m else None
