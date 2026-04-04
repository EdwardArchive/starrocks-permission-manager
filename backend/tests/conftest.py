"""
Shared fixtures for backend unit tests.

All StarRocks interactions are mocked via FakeConnection.
No real database connection is needed to run tests.
"""
from __future__ import annotations

from typing import Any
from unittest.mock import MagicMock

import pytest
from fastapi.testclient import TestClient

from app.dependencies import get_credentials, get_db
from app.main import app
from app.utils.session import create_token
from app.utils.session_store import session_store

# ── Test credentials ──
TEST_HOST = "test-sr-host"
TEST_PORT = 9030
TEST_USER = "test_admin"
TEST_PASS = "test_pass"


def make_token() -> str:
    session_id = session_store.create(TEST_HOST, TEST_PORT, TEST_USER, TEST_PASS, is_admin=True)
    return create_token(session_id, TEST_USER)


# ── Fake StarRocks connection ──
# Maps (sql_prefix) → rows returned.  Tests can override via `mock_db` fixture.
DEFAULT_QUERY_MAP: dict[str, list[dict[str, Any]]] = {
    "SELECT 1": [{"1": 1}],
    "SHOW CATALOGS": [
        {"Catalog": "default_catalog", "Type": "InternalCatalog"},
        {"Catalog": "iceberg_catalog", "Type": "IcebergCatalog"},
    ],
    "SHOW DATABASES": [
        {"Database": "analytics_db"},
        {"Database": "sales_db"},
        {"Database": "information_schema"},
    ],
    "SHOW ROLES": [
        {"Name": "root"},
        {"Name": "db_admin"},
        {"Name": "user_admin"},
        {"Name": "cluster_admin"},
        {"Name": "security_admin"},
        {"Name": "public"},
        {"Name": "analyst_role"},
        {"Name": "etl_role"},
    ],
    "SELECT CURRENT_ROLE()": [{"r": "root"}],
    "SELECT FROM_ROLE FROM sys.role_edges WHERE TO_USER": [
        {"FROM_ROLE": "root"},
        {"FROM_ROLE": "public"},
    ],
    "SELECT * FROM sys.role_edges": [
        {"FROM_ROLE": "root", "TO_ROLE": "db_admin", "TO_USER": None},
        {"FROM_ROLE": "root", "TO_ROLE": "user_admin", "TO_USER": None},
        {"FROM_ROLE": "db_admin", "TO_ROLE": "analyst_role", "TO_USER": None},
        {"FROM_ROLE": "analyst_role", "TO_ROLE": None, "TO_USER": "analyst_kim"},
        {"FROM_ROLE": "root", "TO_ROLE": None, "TO_USER": "test_admin"},
        {"FROM_ROLE": "public", "TO_ROLE": None, "TO_USER": "test_admin"},
        {"FROM_ROLE": "public", "TO_ROLE": None, "TO_USER": "analyst_kim"},
    ],
    "SELECT * FROM sys.grants_to_users WHERE GRANTEE": [
        {
            "GRANTEE": "test_admin",
            "OBJECT_CATALOG": "default_catalog",
            "OBJECT_DATABASE": "analytics_db",
            "OBJECT_NAME": "user_events",
            "OBJECT_TYPE": "TABLE",
            "PRIVILEGE_TYPE": "SELECT",
            "IS_GRANTABLE": "YES",
        },
    ],
    "SELECT * FROM sys.grants_to_roles WHERE GRANTEE": [
        {
            "GRANTEE": "analyst_role",
            "OBJECT_CATALOG": "default_catalog",
            "OBJECT_DATABASE": "analytics_db",
            "OBJECT_NAME": "user_events",
            "OBJECT_TYPE": "TABLE",
            "PRIVILEGE_TYPE": "SELECT",
            "IS_GRANTABLE": "NO",
        },
    ],
    "SELECT * FROM sys.grants_to_users WHERE": [
        {
            "GRANTEE": "test_admin",
            "OBJECT_CATALOG": "default_catalog",
            "OBJECT_DATABASE": "analytics_db",
            "OBJECT_NAME": "user_events",
            "OBJECT_TYPE": "TABLE",
            "PRIVILEGE_TYPE": "SELECT",
            "IS_GRANTABLE": "YES",
        },
    ],
    "SELECT * FROM sys.grants_to_roles WHERE": [
        {
            "GRANTEE": "analyst_role",
            "OBJECT_CATALOG": "default_catalog",
            "OBJECT_DATABASE": "analytics_db",
            "OBJECT_NAME": "user_events",
            "OBJECT_TYPE": "TABLE",
            "PRIVILEGE_TYPE": "SELECT",
            "IS_GRANTABLE": "NO",
        },
    ],
    "SELECT FROM_ROLE FROM sys.role_edges WHERE TO_ROLE": [],
    "SELECT TO_ROLE FROM sys.role_edges WHERE FROM_ROLE": [
        {"TO_ROLE": "analyst_role"},
    ],
    "SELECT TO_ROLE, TO_USER FROM sys.role_edges WHERE FROM_ROLE": [
        {"TO_ROLE": "analyst_role", "TO_USER": None},
        {"TO_ROLE": None, "TO_USER": "analyst_kim"},
    ],
    "SELECT TO_USER FROM sys.role_edges WHERE FROM_ROLE": [
        {"TO_USER": "analyst_kim"},
    ],
    "SELECT TABLE_NAME, TABLE_TYPE FROM information_schema.tables": [
        {"TABLE_NAME": "user_events", "TABLE_TYPE": "BASE TABLE"},
        {"TABLE_NAME": "page_views", "TABLE_TYPE": "BASE TABLE"},
        {"TABLE_NAME": "daily_summary", "TABLE_TYPE": "VIEW"},
    ],
    "SELECT TABLE_SCHEMA, TABLE_NAME, TABLE_TYPE FROM information_schema.tables": [
        {"TABLE_SCHEMA": "analytics_db", "TABLE_NAME": "user_events", "TABLE_TYPE": "BASE TABLE"},
        {"TABLE_SCHEMA": "analytics_db", "TABLE_NAME": "page_views", "TABLE_TYPE": "BASE TABLE"},
        {"TABLE_SCHEMA": "analytics_db", "TABLE_NAME": "daily_summary", "TABLE_TYPE": "VIEW"},
    ],
    "SELECT SCHEMA_NAME FROM information_schema.schemata": [
        {"SCHEMA_NAME": "analytics_db"},
        {"SCHEMA_NAME": "sales_db"},
    ],
    "SELECT DISTINCT TO_USER FROM sys.role_edges": [
        {"TO_USER": "test_admin"},
        {"TO_USER": "analyst_kim"},
    ],
    "SELECT DISTINCT GRANTEE FROM sys.grants_to_users": [
        {"GRANTEE": "test_admin"},
        {"GRANTEE": "analyst_kim"},
    ],
    "SELECT TABLE_NAME FROM information_schema.materialized_views": [
        {"TABLE_NAME": "hourly_agg_mv"},
    ],
    "SHOW FUNCTIONS FROM": [
        {"Signature": "parse_ua(VARCHAR)"},
    ],
    "SELECT TABLE_NAME, TABLE_TYPE, ENGINE": [
        {
            "TABLE_NAME": "user_events",
            "TABLE_TYPE": "BASE TABLE",
            "ENGINE": "StarRocks",
            "TABLE_ROWS": 12847293,
            "DATA_LENGTH": 2576980377,
            "CREATE_TIME": "2025-03-15 09:22:41",
            "UPDATE_TIME": "2026-04-01 22:00:00",
            "TABLE_COMMENT": "Event tracking",
        },
    ],
    "SELECT COLUMN_NAME, COLUMN_TYPE, ORDINAL_POSITION": [
        {
            "COLUMN_NAME": "event_id",
            "COLUMN_TYPE": "bigint",
            "ORDINAL_POSITION": 1,
            "IS_NULLABLE": "NO",
            "COLUMN_DEFAULT": None,
            "COLUMN_KEY": "DUP",
            "COLUMN_COMMENT": "",
        },
        {
            "COLUMN_NAME": "event_date",
            "COLUMN_TYPE": "date",
            "ORDINAL_POSITION": 2,
            "IS_NULLABLE": "NO",
            "COLUMN_DEFAULT": None,
            "COLUMN_KEY": "",
            "COLUMN_COMMENT": "",
        },
    ],
    "SHOW CREATE TABLE": [
        {
            "Create Table": (
                'CREATE TABLE `user_events` (\n'
                '  `event_id` BIGINT NOT NULL,\n'
                '  `event_date` DATE NOT NULL\n'
                ') ENGINE=OLAP\n'
                'DUPLICATE KEY(`event_id`)\n'
                'PARTITION BY RANGE(`event_date`) (\n'
                "  PARTITION p20250101 VALUES LESS THAN ('2025-01-02')\n"
                ')\n'
                'DISTRIBUTED BY HASH(`event_id`) BUCKETS 16\n'
                'PROPERTIES (\n'
                '  "replication_num" = "3",\n'
                '  "storage_medium" = "SSD",\n'
                '  "compression" = "LZ4"\n'
                ')'
            )
        },
    ],
    "SELECT COUNT(*) as cnt FROM information_schema.partitions_meta": [
        {"cnt": 365},
    ],
    "SET CATALOG": [],
    "SHOW GRANTS FOR": [],
}


class FakeCursor:
    def __init__(self, query_map: dict):
        self._query_map = query_map
        self._results: list[dict] = []

    def execute(self, sql: str, params: tuple = ()):
        self._results = []
        for prefix, rows in self._query_map.items():
            if sql.strip().upper().startswith(prefix.upper()):
                self._results = rows
                return
        # No match → empty result
        self._results = []

    def fetchall(self) -> list[dict]:
        return self._results

    def close(self):
        pass


class FakeConnection:
    def __init__(self, query_map: dict):
        self._query_map = query_map

    def cursor(self, dictionary=False):
        return FakeCursor(self._query_map)

    def close(self):
        pass


# ── Fixtures ──

@pytest.fixture()
def query_map():
    """Override this in tests to customize mock query results."""
    return dict(DEFAULT_QUERY_MAP)


@pytest.fixture()
def mock_db(query_map):
    """FakeConnection with the given query_map."""
    return FakeConnection(query_map)


@pytest.fixture()
def client(mock_db, query_map):
    """FastAPI TestClient with mocked DB dependency."""

    # Clear TTL caches to prevent cross-test leakage
    from app.routers.objects import _catalog_cache
    from app.routers.roles import _role_cache
    from app.services.user_service import _user_cache
    _catalog_cache.clear()
    _role_cache.clear()
    _user_cache.clear()

    def _override_credentials():
        return {
            "host": TEST_HOST,
            "port": TEST_PORT,
            "username": TEST_USER,
            "password": TEST_PASS,
            "is_admin": True,
        }

    def _override_db():
        yield mock_db

    app.dependency_overrides[get_credentials] = _override_credentials
    app.dependency_overrides[get_db] = _override_db

    # Mock parallel_queries to use FakeConnection instead of real connections
    # Patch both the module attr AND the already-imported references in routers
    import app.services.starrocks_client as sc
    import app.routers.dag as dag_mod
    import app.routers.search as search_mod
    _orig_sc = sc.parallel_queries
    _orig_dag = dag_mod.parallel_queries
    _orig_search = search_mod.parallel_queries
    _qmap = query_map

    def _mock_parallel(credentials, tasks, max_workers=None, timeout=5.0):
        results = {}
        for key, fn in tasks:
            try:
                fake = FakeConnection(_qmap)
                results[key] = fn(fake)
            except Exception:
                pass
        return results

    sc.parallel_queries = _mock_parallel
    dag_mod.parallel_queries = _mock_parallel
    search_mod.parallel_queries = _mock_parallel

    with TestClient(app) as c:
        yield c

    sc.parallel_queries = _orig_sc
    dag_mod.parallel_queries = _orig_dag
    search_mod.parallel_queries = _orig_search
    app.dependency_overrides.clear()


@pytest.fixture()
def auth_header():
    """Authorization header with a valid JWT token."""
    return {"Authorization": f"Bearer {make_token()}"}
