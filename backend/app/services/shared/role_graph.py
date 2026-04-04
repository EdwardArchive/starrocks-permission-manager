"""Shared role graph helpers (used by both admin and common layers)."""

from __future__ import annotations

import logging

from app.services.starrocks_client import execute_query

logger = logging.getLogger("privileges")


def fetch_role_child_map(conn) -> dict[str, list[str]]:
    """Fetch sys.role_edges → {parent: [child_roles]}.

    Falls back to empty dict if sys.role_edges is not accessible (non-admin).
    """
    children_of: dict[str, list[str]] = {}
    try:
        rows = execute_query(
            conn,
            "SELECT FROM_ROLE, TO_ROLE FROM sys.role_edges WHERE TO_ROLE IS NOT NULL AND TO_ROLE != ''",
        )
        for e in rows:
            parent = e.get("FROM_ROLE") or ""
            child = e.get("TO_ROLE") or ""
            if parent and child:
                children_of.setdefault(parent, []).append(child)
    except Exception:
        logger.debug("Failed to query sys.role_edges for role child map")
    return children_of
