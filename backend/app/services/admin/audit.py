"""Best-effort audit trail for GRANT/REVOKE operations.

Records go to the srpm_audit.grant_log StarRocks table (created by the
operator — see the setup SQL in docs/GRANT_REVOKE_DESIGN.md §4). Writes run
under the logged-in user's credentials; the srpm_grant_admin bundle role
carries the required INSERT/SELECT.

Failed operations are logged too (result='error') — denied attempts are the
most audit-worthy events. An audit INSERT failure never fails the operation;
the caller surfaces it via the response's `audit` flag.
"""

from __future__ import annotations

import logging

from app.services.starrocks_client import execute_query, execute_statement

logger = logging.getLogger(__name__)

AUDIT_TABLE = "srpm_audit.grant_log"


def write_audit(
    conn,
    action: str,
    grant_type: str,
    sql_text: str,
    result: str,
    error_msg: str | None = None,
) -> bool:
    """Insert one audit row. Returns False (and logs) instead of raising."""
    try:
        execute_statement(
            conn,
            f"INSERT INTO {AUDIT_TABLE} (log_time, actor, action, grant_type, sql_text, result, error_msg) "
            "VALUES (NOW(), CURRENT_USER(), %s, %s, %s, %s, %s)",
            (action, grant_type, sql_text, result, error_msg),
        )
        return True
    except Exception as exc:
        logger.warning(
            "Audit insert failed (operation result unchanged): %s | action=%s result=%s sql=%s",
            exc,
            action,
            result,
            sql_text,
        )
        return False


def query_audit(conn, limit: int, actor: str | None = None, action: str | None = None) -> list[dict]:
    """Read recent audit entries, newest first. Filters are parameterized."""
    clauses: list[str] = []
    params: list = []
    if actor:
        clauses.append("actor = %s")
        params.append(actor)
    if action:
        clauses.append("action = %s")
        params.append(action)
    where = f" WHERE {' AND '.join(clauses)}" if clauses else ""
    params.append(limit)
    return execute_query(
        conn,
        f"SELECT log_time, actor, action, grant_type, sql_text, result, error_msg "
        f"FROM {AUDIT_TABLE}{where} ORDER BY log_time DESC LIMIT %s",
        tuple(params),
    )
