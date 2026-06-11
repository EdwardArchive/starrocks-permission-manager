from __future__ import annotations
import os
from concurrent.futures import ThreadPoolExecutor, as_completed
from contextlib import contextmanager
from threading import Lock, Semaphore
from collections.abc import Callable
from typing import Any
import mysql.connector
import mysql.connector.pooling

import logging

logger = logging.getLogger(__name__)

# Max parallel DB connections per request (prevents connection flood)
_MAX_PARALLEL = 10
_semaphore = Semaphore(_MAX_PARALLEL)

# ── Connection pooling ──
# Pool physical connections per (host, port, user) so each request avoids the
# TCP + auth handshake (~2-5 RTT). mysql-connector's pool reset is a no-op
# against StarRocks, so we explicitly reset session state on every borrow.
_POOL_SIZE = int(os.getenv("SRPM_DB_POOL_SIZE", "16"))
_pools: dict[tuple, mysql.connector.pooling.MySQLConnectionPool] = {}
_pools_lock = Lock()


@contextmanager
def get_connection(host: str, port: int, username: str, password: str):
    conn = mysql.connector.connect(
        host=host,
        port=port,
        user=username,
        password=password,
        connection_timeout=10,
    )
    try:
        yield conn
    finally:
        conn.close()


def _get_pool(host: str, port: int, username: str, password: str):
    key = (host, port, username)
    with _pools_lock:
        pool = _pools.get(key)
        if pool is None:
            pool = mysql.connector.pooling.MySQLConnectionPool(
                pool_name=f"srpm_pool_{len(_pools)}",
                pool_size=_POOL_SIZE,
                pool_reset_session=False,  # StarRocks ignores the driver reset; we reset explicitly
                host=host,
                port=port,
                user=username,
                password=password,
                connection_timeout=10,
            )
            _pools[key] = pool
    return pool


def _reset_session(conn) -> None:
    """Return a borrowed connection to a clean baseline that mimics a fresh one:
    reset catalog/database context and re-activate all roles. Both are non-fatal."""
    cur = conn.cursor()
    try:
        try:
            cur.execute("SET CATALOG default_catalog")
        except Exception:
            logger.debug("SET CATALOG default_catalog failed on pooled connection")
        try:
            cur.execute("SET ROLE ALL")
        except Exception:
            logger.debug("SET ROLE ALL failed on pooled connection")
    finally:
        cur.close()


@contextmanager
def get_pooled_connection(host: str, port: int, username: str, password: str):
    """Yield a pooled connection reset to a clean baseline (catalog + roles).

    Falls back to a direct connection if the pool is exhausted or a borrowed
    connection is stale (e.g. after a StarRocks restart).
    """
    conn = None
    try:
        conn = _get_pool(host, port, username, password).get_connection()
        conn.ping(reconnect=True, attempts=1, delay=0)  # revive stale pooled connections
    except Exception:
        if conn is not None:
            try:
                conn.close()
            except Exception:
                logger.debug("Failed to return stale pooled connection")
        logger.debug("Pool unavailable/stale; using a direct connection")
        conn = mysql.connector.connect(host=host, port=port, user=username, password=password, connection_timeout=10)
    try:
        _reset_session(conn)
        yield conn
    finally:
        conn.close()  # pooled connection returns to the pool; direct one closes


def execute_query(conn, sql: str, params: tuple | None = None) -> list[dict[str, Any]]:
    cursor = conn.cursor(dictionary=True)
    cursor.execute(sql, params or ())
    rows = cursor.fetchall()
    cursor.close()
    return rows


def execute_single(conn, sql: str, params: tuple | None = None) -> dict[str, Any] | None:
    rows = execute_query(conn, sql, params)
    return rows[0] if rows else None


def execute_statement(conn, sql: str, params: tuple | None = None) -> None:
    """Run a write statement (GRANT/REVOKE/INSERT/SET) that returns no result set."""
    cursor = conn.cursor()
    cursor.execute(sql, params or ())
    cursor.close()


def test_connection(host: str, port: int, username: str, password: str) -> bool:
    try:
        with get_connection(host, port, username, password) as conn:
            execute_single(conn, "SELECT 1")
        return True
    except Exception:
        return False


def parallel_queries(
    credentials: dict,
    tasks: list[tuple[str, Callable]],
    max_workers: int | None = None,
    timeout: float = 5.0,
) -> dict[str, Any]:
    """Execute multiple query tasks in parallel, each on its own connection.
    Args:
        credentials: {host, port, username, password} for creating connections
        tasks: list of (key, fn) where fn(conn) -> result
        max_workers: max threads (default: _MAX_PARALLEL)
        timeout: per-task timeout in seconds (default: 5s)
    Returns:
        dict of {key: result} for successful tasks (failed/timed-out tasks are skipped)
    """
    workers = min(max_workers or _MAX_PARALLEL, len(tasks), _MAX_PARALLEL)
    results: dict[str, Any] = {}

    def _run(key: str, fn: Callable):
        _semaphore.acquire()
        try:
            with get_pooled_connection(
                credentials["host"],
                credentials["port"],
                credentials["username"],
                credentials["password"],
            ) as conn:
                return key, fn(conn)
        finally:
            _semaphore.release()

    with ThreadPoolExecutor(max_workers=workers) as pool:
        futures = {pool.submit(_run, k, fn): k for k, fn in tasks}
        try:
            for future in as_completed(futures, timeout=timeout + 2):
                try:
                    key, result = future.result(timeout=timeout)
                    results[key] = result
                except Exception:
                    logger.debug("Query failed, skipping")
        except TimeoutError:
            # Some tasks didn't finish in time — collect whatever completed
            for future in futures:
                if future.done() and not future.exception():
                    try:
                        key, result = future.result(timeout=0)
                        if key not in results:
                            results[key] = result
                    except Exception:  # pragma: no cover (unreachable defensive branch)
                        logger.debug("Parallel query failed for key %s", futures[future])
    return results
