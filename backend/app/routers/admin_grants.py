"""Write routes for GRANT/REVOKE — a third route category (not Layer 1/2 reads).

All endpoints sit behind require_grant_admin (admin + user_admin capability).
Statements run under the logged-in user's own credentials; StarRocks is the
final authorization gate.
"""

from __future__ import annotations

import logging

import mysql.connector.errors
from fastapi import APIRouter, Depends, HTTPException, Query

from app.dependencies import get_db, require_grant_admin
from app.models.schemas import (
    AuditEntry,
    GrantExecuteResponse,
    GrantPreviewResponse,
    GrantRequest,
)
from app.services.admin.audit import query_audit, write_audit
from app.services.admin.grant_writer import build_statements
from app.services.shared.grant_spec import GRANTABLE_PRIVILEGES
from app.services.starrocks_client import execute_statement
from app.utils.cache import clear_all_caches
from app.utils.sys_access import is_access_denied

router = APIRouter()
logger = logging.getLogger(__name__)


@router.get("/spec")
def get_spec(_: dict = Depends(require_grant_admin)) -> dict:
    """Server-side allowlist — single source for the wizard's privilege checkboxes."""
    return {"object_types": {k: sorted(v) for k, v in GRANTABLE_PRIVILEGES.items()}}


@router.post("/preview", response_model=GrantPreviewResponse)
def preview_grant(req: GrantRequest, _: dict = Depends(require_grant_admin)):
    try:
        statements, warnings = build_statements(req)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from None
    return GrantPreviewResponse(sql=statements, warnings=warnings)


@router.post("/execute", response_model=GrantExecuteResponse)
def execute_grant(
    req: GrantRequest,
    _: dict = Depends(require_grant_admin),
    conn=Depends(get_db),
):
    try:
        statements, _warnings = build_statements(req)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from None

    sql_text = "; ".join(statements)
    try:
        for stmt in statements:
            execute_statement(conn, stmt)
    except mysql.connector.errors.Error as exc:
        # Audit the denied/failed attempt before surfacing the error.
        write_audit(conn, req.action, req.type, sql_text, "error", str(exc))
        if is_access_denied(exc):
            raise HTTPException(
                status_code=403,
                detail=f"StarRocks denied the operation: {exc}",
            ) from None
        raise HTTPException(status_code=400, detail=f"StarRocks rejected the statement: {exc}") from None

    audit_ok = write_audit(conn, req.action, req.type, sql_text, "ok")
    clear_all_caches()
    return GrantExecuteResponse(sql=statements, status="ok", audit="ok" if audit_ok else "failed")


@router.get("/audit", response_model=list[AuditEntry])
def get_audit(
    limit: int = Query(default=100, ge=1, le=1000),
    actor: str | None = Query(default=None),
    action: str | None = Query(default=None),
    _: dict = Depends(require_grant_admin),
    conn=Depends(get_db),
):
    rows = query_audit(conn, limit=limit, actor=actor, action=action)
    return [
        AuditEntry(
            log_time=str(r.get("log_time") or r.get("LOG_TIME") or ""),
            actor=str(r.get("actor") or r.get("ACTOR") or ""),
            action=str(r.get("action") or r.get("ACTION") or ""),
            grant_type=str(r.get("grant_type") or r.get("GRANT_TYPE") or ""),
            sql_text=str(r.get("sql_text") or r.get("SQL_TEXT") or ""),
            result=str(r.get("result") or r.get("RESULT") or ""),
            error_msg=r.get("error_msg") or r.get("ERROR_MSG"),
        )
        for r in rows
    ]
