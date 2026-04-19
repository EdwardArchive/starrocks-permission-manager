"""Check whether the current connection can access sys.* system tables."""

from __future__ import annotations

import logging

from app.services.starrocks_client import execute_query

logger = logging.getLogger(__name__)

# MySQL error codes that indicate access was denied (authorization failure).
# 1044: DB access denied · 1045: bad user/password · 1142: table op denied ·
# 1227: cluster/SYSTEM op denied.
ACCESS_DENIED_ERRNOS = frozenset({1044, 1045, 1142, 1227})


def is_access_denied(exc: Exception) -> bool:
    """True if exc represents a database access-denied error.

    Checks errno first, falls back to StarRocks' canonical "Access denied"
    prefix since some access-denied errors come back as ProgrammingError
    without the standard MySQL errno.
    """
    errno = getattr(exc, "errno", None)
    if errno in ACCESS_DENIED_ERRNOS:
        return True
    return "Access denied" in str(exc)


def can_access_sys(conn) -> bool:
    """Return True only if the connection can query all three sys tables used by admin routes.

    Calls SET ROLE ALL first so that non-default roles (e.g. cluster_admin granted
    but not active by default) are considered in the check.
    """
    try:
        execute_query(conn, "SET ROLE ALL")
    except Exception:
        logger.debug("SET ROLE ALL failed during admin check — proceeding without it")

    for table in ("sys.role_edges", "sys.grants_to_users", "sys.grants_to_roles"):
        try:
            execute_query(conn, f"SELECT 1 FROM {table} LIMIT 1")
        except Exception:
            logger.debug("sys table not accessible (%s) — treating as non-admin", table)
            return False

    # SHOW ROLES requires user_admin/security_admin — verifies full admin capability
    try:
        execute_query(conn, "SHOW ROLES")
    except Exception:
        logger.debug("SHOW ROLES denied — treating as non-admin")
        return False

    return True
