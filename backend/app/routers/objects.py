from __future__ import annotations

import logging
import re
import threading

from cachetools import TTLCache
from fastapi import APIRouter, Depends, Query

from app.config import settings
from app.dependencies import get_db
from app.utils.sql_safety import safe_identifier
from app.models.schemas import CatalogItem, ColumnInfo, DatabaseItem, ObjectItem, TableDetail
from app.services.starrocks_client import execute_query, execute_single

router = APIRouter()
logger = logging.getLogger(__name__)

# ── Compiled regex patterns ──
_RE_HASH_DIST = re.compile(r"DISTRIBUTED BY HASH\(([^)]+)\)\s*BUCKETS\s*(\d+)", re.I)
_RE_RANDOM_DIST = re.compile(r"DISTRIBUTED BY RANDOM\s*BUCKETS\s*(\d+)", re.I)
_RE_PARTITION_RANGE = re.compile(r"PARTITION BY RANGE\(([^)]+)\)", re.I)
_RE_PARTITION_LIST = re.compile(r"PARTITION BY LIST\(([^)]+)\)", re.I)
_RE_PARTITION_GENERIC = re.compile(r"PARTITION BY\s+(\w+)\(([^)]+)\)", re.I)
_RE_PARTITION_SIMPLE = re.compile(r"PARTITION BY\s*\(([^)]+)\)", re.I)  # Hive/Iceberg: PARTITION BY (col)

# ── TTL cache for catalogs ──
_catalog_cache: TTLCache = TTLCache(maxsize=1, ttl=settings.cache_ttl_seconds)
_catalog_cache_lock = threading.Lock()


@router.get("/catalogs", response_model=list[CatalogItem])
def list_catalogs(conn=Depends(get_db)):
    cache_key = "catalogs"
    with _catalog_cache_lock:
        if cache_key in _catalog_cache:
            return _catalog_cache[cache_key]
    rows = execute_query(conn, "SHOW CATALOGS")
    result = []
    for r in rows:
        name = r.get("Catalog") or r.get("catalog") or ""
        ctype = r.get("Type") or r.get("type") or "InternalCatalog"
        result.append(CatalogItem(name=name, catalog_type=ctype))
    with _catalog_cache_lock:
        _catalog_cache[cache_key] = result
    return result


@router.get("/databases", response_model=list[DatabaseItem])
def list_databases(catalog: str = Query(...), conn=Depends(get_db)):
    execute_query(conn, f"SET CATALOG `{catalog}`")
    rows = execute_query(conn, "SHOW DATABASES")
    result = []
    for r in rows:
        name = r.get("Database") or r.get("database") or ""
        if name == "information_schema":
            continue
        result.append(DatabaseItem(name=name, catalog=catalog))
    return result


@router.get("/tables", response_model=list[ObjectItem])
def list_tables(
    catalog: str = Query(...),
    database: str = Query(...),
    conn=Depends(get_db),
):
    execute_query(conn, f"SET CATALOG `{catalog}`")
    rows = execute_query(
        conn,
        "SELECT TABLE_NAME, TABLE_TYPE FROM information_schema.tables "
        "WHERE TABLE_SCHEMA = %s AND TABLE_TYPE != 'SYSTEM VIEW'",
        (database,),
    )
    # Also get MVs
    mvs = set()
    try:
        mv_rows = execute_query(
            conn,
            "SELECT TABLE_NAME FROM information_schema.materialized_views WHERE TABLE_SCHEMA = %s",
            (database,),
        )
        mvs = {r.get("TABLE_NAME") or r.get("table_name") for r in mv_rows}
    except Exception:
        logger.debug("Failed to query materialized views for %s.%s", catalog, database)

    result = []
    for r in rows:
        name = r.get("TABLE_NAME") or r.get("table_name") or ""
        ttype = r.get("TABLE_TYPE") or r.get("table_type") or ""
        if name in mvs:
            obj_type = "MATERIALIZED VIEW"
        elif "VIEW" in ttype.upper():
            obj_type = "VIEW"
        else:
            obj_type = "TABLE"
        result.append(ObjectItem(name=name, object_type=obj_type, catalog=catalog, database=database))

    # Functions
    try:
        fn_rows = execute_query(conn, f"SHOW FUNCTIONS FROM `{safe_identifier(database)}`")
        seen_fns: set[str] = set()
        for r in fn_rows:
            name = r.get("Signature") or r.get("signature") or r.get("Function Name") or ""
            if "(" in name:
                name = name.split("(")[0]
            if name and name not in seen_fns:
                seen_fns.add(name)
                result.append(ObjectItem(name=name, object_type="FUNCTION", catalog=catalog, database=database))
    except Exception:
        logger.debug("Failed to list functions for %s.%s", catalog, database)

    return result


@router.get("/table-detail", response_model=TableDetail)
def get_table_detail(
    catalog: str = Query(...),
    database: str = Query(...),
    table: str = Query(...),
    conn=Depends(get_db),
):
    import logging

    logger = logging.getLogger("objects")

    # Set catalog and database context
    try:
        execute_query(conn, f"SET CATALOG `{catalog}`")
    except Exception as e:
        logger.warning(f"SET CATALOG failed: {e}")
    try:
        execute_query(conn, f"USE `{database}`")
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
            name=c.get("COLUMN_NAME") or c.get("column_name") or "",
            column_type=c.get("COLUMN_TYPE") or c.get("column_type") or "",
            ordinal_position=c.get("ORDINAL_POSITION") or c.get("ordinal_position") or 0,
            is_nullable=c.get("IS_NULLABLE") or c.get("is_nullable") or "YES",
            column_default=c.get("COLUMN_DEFAULT") or c.get("column_default"),
            column_key=c.get("COLUMN_KEY") or c.get("column_key"),
            comment=c.get("COLUMN_COMMENT") or c.get("column_comment"),
        )
        for c in col_rows
    ]

    # DDL (works across most catalogs)
    ddl = None
    try:
        ddl_row = execute_single(conn, f"SHOW CREATE TABLE `{safe_identifier(database)}`.`{safe_identifier(table)}`")
        if ddl_row:
            # StarRocks returns different column names depending on object type
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
        table_name=tbl.get("TABLE_NAME") or tbl.get("table_name") or table,
        table_type=tbl.get("TABLE_TYPE") or tbl.get("table_type") or "",
        engine=tbl.get("ENGINE") or tbl.get("engine"),
        row_count=tbl.get("TABLE_ROWS") or tbl.get("table_rows"),
        data_size=tbl.get("DATA_LENGTH") or tbl.get("data_length"),
        create_time=str(tbl.get("CREATE_TIME") or tbl.get("create_time") or ""),
        update_time=str(tbl.get("UPDATE_TIME") or tbl.get("update_time") or ""),
        comment=tbl.get("TABLE_COMMENT") or tbl.get("table_comment"),
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
    # Hive/Iceberg: PARTITION BY (col1, col2) — no method keyword
    m = _RE_PARTITION_SIMPLE.search(ddl)
    if m:
        cols = ", ".join(c.strip().strip("`") for c in m.group(1).split(","))
        return "PARTITION", cols
    return None, None


def _parse_property(ddl: str, key: str) -> str | None:
    m = re.search(rf'"{key}"\s*=\s*"([^"]*)"', ddl, re.I)
    return m.group(1) if m else None
