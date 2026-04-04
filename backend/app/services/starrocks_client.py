from __future__ import annotations
from concurrent.futures import ThreadPoolExecutor, as_completed
from contextlib import contextmanager
from threading import Semaphore
from collections.abc import Callable
from typing import Any
import mysql.connector

import logging

logger = logging.getLogger(__name__)

# Max parallel DB connections per request (prevents connection flood)
_MAX_PARALLEL = 10
_semaphore = Semaphore(_MAX_PARALLEL)


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


def execute_query(conn, sql: str, params: tuple | None = None) -> list[dict[str, Any]]:
    cursor = conn.cursor(dictionary=True)
    cursor.execute(sql, params or ())
    rows = cursor.fetchall()
    cursor.close()
    return rows


def execute_single(conn, sql: str, params: tuple | None = None) -> dict[str, Any] | None:
    rows = execute_query(conn, sql, params)
    return rows[0] if rows else None


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
    conn_timeout = min(int(timeout), 3)

    def _run(key: str, fn: Callable):
        _semaphore.acquire()
        try:
            conn = mysql.connector.connect(
                host=credentials["host"],
                port=credentials["port"],
                user=credentials["username"],
                password=credentials["password"],
                connection_timeout=conn_timeout,
            )
            try:
                return key, fn(conn)
            finally:
                conn.close()
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
                    except Exception:
                        logger.debug("Parallel query failed for key %s", key if "key" in dir() else "?")
    return results
