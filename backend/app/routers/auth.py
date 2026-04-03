from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, Header, HTTPException

from app.dependencies import get_credentials, get_db
from app.models.schemas import LoginRequest, LoginResponse, UserInfo
from app.services.starrocks_client import (
    execute_query,
    get_connection,
    test_connection,
)
from app.utils.session import create_token, decode_token
from app.utils.session_store import session_store
from app.utils.sql_safety import safe_name
from app.utils.cache import clear_all_caches

router = APIRouter()
logger = logging.getLogger(__name__)

BUILTIN_ROLES = {"root", "db_admin", "user_admin", "cluster_admin", "security_admin", "public"}


@router.post("/login", response_model=LoginResponse)
def login(req: LoginRequest):
    if not test_connection(req.host, req.port, req.username, req.password):
        raise HTTPException(status_code=401, detail="Failed to connect to StarRocks")

    session_id = session_store.create(req.host, req.port, req.username, req.password)
    token = create_token(session_id, req.username)

    # Clear all server-side caches on new login (connection may differ)
    clear_all_caches()

    with get_connection(req.host, req.port, req.username, req.password) as conn:
        roles = _get_user_roles(conn, req.username)
        default_role = _get_default_role(conn)

    return LoginResponse(
        token=token,
        username=req.username,
        roles=roles,
        default_role=default_role,
    )


@router.get("/me", response_model=UserInfo)
def me(credentials: dict = Depends(get_credentials), conn=Depends(get_db)):
    username = credentials["username"]
    roles = _get_user_roles(conn, username)
    default_role = _get_default_role(conn)
    is_admin = "root" in roles or "user_admin" in roles
    return UserInfo(
        username=username,
        roles=roles,
        default_role=default_role,
        is_user_admin=is_admin,
    )


def _get_user_roles(conn, username: str) -> list[str]:
    try:
        rows = execute_query(conn, "SHOW GRANTS FOR %s", (username,))
        roles = set()
        for row in rows:
            # SHOW GRANTS output varies; extract role names from GrantPrivilege column
            for val in row.values():
                s = str(val)
                if "ROLE" in s.upper():
                    # Extract role name from patterns like "GRANT role_name TO ..."
                    pass
            # Simpler: query role_edges
        # Fallback: use sys.role_edges if available
        edges = execute_query(
            conn,
            "SELECT FROM_ROLE FROM sys.role_edges WHERE TO_USER = %s",
            (username,),
        )
        for e in edges:
            role_name = e.get("FROM_ROLE") or e.get("ROLE_NAME") or e.get("role_name")
            if role_name:
                roles.add(role_name)
    except Exception:
        # sys views may not be available; try SHOW GRANTS parsing
        try:
            rows = execute_query(conn, f"SHOW GRANTS FOR '{safe_name(username)}'")
            for row in rows:
                for val in row.values():
                    s = str(val)
                    if s.startswith("GRANT") and "TO ROLE" not in s:
                        continue
        except Exception:
            logger.debug("Failed to parse SHOW GRANTS for user %s", username)
    if not roles:
        roles.add("public")
    return sorted(roles)


@router.post("/logout")
def logout(authorization: str = Header(None)):
    if authorization and authorization.startswith("Bearer "):
        token = authorization[7:]
        try:
            payload = decode_token(token)
            session_id = payload.get("session_id")
            if session_id:
                session_store.delete(session_id)
        except Exception:
            logger.debug("Failed to decode token during logout")
    return {"detail": "Logged out"}


def _get_default_role(conn) -> str | None:
    try:
        row = execute_query(conn, "SELECT CURRENT_ROLE() as r")
        if row:
            return str(row[0].get("r") or row[0].get("CURRENT_ROLE()") or "")
    except Exception:
        logger.debug("Failed to get default role via CURRENT_ROLE()")
    return None
