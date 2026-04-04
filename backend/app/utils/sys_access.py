"""Check whether the current connection can access sys.* system tables."""

from __future__ import annotations

import logging

from app.services.starrocks_client import execute_query

logger = logging.getLogger(__name__)


def can_access_sys(conn) -> bool:
    """Return True if the current connection can query sys.role_edges."""
    try:
        execute_query(conn, "SELECT 1 FROM sys.role_edges LIMIT 1")
        return True
    except Exception:
        logger.debug("sys.role_edges not accessible — falling back to SHOW GRANTS")
        return False
