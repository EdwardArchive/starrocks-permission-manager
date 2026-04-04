from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, Header, HTTPException

from app.dependencies import get_credentials, get_db
from app.models.schemas import LoginRequest, LoginResponse, UserInfo
from app.services.starrocks_client import execute_query, get_connection, test_connection
from app.utils.cache import clear_all_caches
from app.utils.role_helpers import get_user_roles
from app.utils.session import create_token, decode_token
from app.utils.session_store import session_store
from app.utils.sys_access import can_access_sys

router = APIRouter()
logger = logging.getLogger(__name__)


@router.post("/login", response_model=LoginResponse)
def login(req: LoginRequest):
    if not test_connection(req.host, req.port, req.username, req.password):
        raise HTTPException(status_code=401, detail="Failed to connect to StarRocks")

    with get_connection(req.host, req.port, req.username, req.password) as conn:
        is_admin = can_access_sys(conn)
        roles = get_user_roles(conn, req.username)
        default_role = _get_default_role(conn)

    session_id = session_store.create(req.host, req.port, req.username, req.password, is_admin=is_admin)
    token = create_token(session_id, req.username)
    clear_all_caches()

    return LoginResponse(
        token=token,
        username=req.username,
        roles=roles,
        default_role=default_role,
    )


@router.get("/me", response_model=UserInfo)
def me(credentials: dict = Depends(get_credentials), conn=Depends(get_db)):
    username = credentials["username"]
    is_admin = credentials.get("is_admin", False)
    roles = get_user_roles(conn, username)
    default_role = _get_default_role(conn)
    return UserInfo(
        username=username,
        roles=roles,
        default_role=default_role,
        is_user_admin=is_admin,
    )


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
