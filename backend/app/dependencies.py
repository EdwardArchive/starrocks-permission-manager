from __future__ import annotations

from fastapi import Depends, Header, HTTPException

from app.services.starrocks_client import get_pooled_connection
from app.utils.session import decode_token
from app.utils.session_store import session_store


def get_credentials(authorization: str = Header(...)) -> dict:
    if not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Invalid authorization header")
    token = authorization[7:]
    try:
        payload = decode_token(token)
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid or expired token") from None

    session_id = payload.get("session_id")
    if not session_id:
        raise HTTPException(status_code=401, detail="Invalid token: missing session")

    credentials = session_store.get(session_id)
    if credentials is None:
        raise HTTPException(status_code=401, detail="Session expired. Please log in again.")

    return credentials


def require_admin(credentials: dict = Depends(get_credentials)) -> dict:
    """Dependency that ensures the user has admin privileges."""
    if not credentials.get("is_admin", False):
        raise HTTPException(status_code=403, detail="Admin access required")
    return credentials


def require_grant_admin(credentials: dict = Depends(get_credentials)) -> dict:
    """Dependency for write (GRANT/REVOKE) routes.

    Admin alone is not enough: a security_admin-only user passes require_admin
    but lacks StarRocks' GRANT ON SYSTEM capability (carried by user_admin).
    """
    if not credentials.get("is_admin", False):
        raise HTTPException(status_code=403, detail="Admin access required")
    if not credentials.get("can_manage_grants", False):
        raise HTTPException(status_code=403, detail="Grant management requires the user_admin role")
    return credentials


def get_db(credentials: dict = Depends(get_credentials)):
    # Pooled connection; get_pooled_connection resets the session on borrow
    # (SET CATALOG default_catalog + SET ROLE ALL), so role activation and a
    # clean catalog/db baseline are guaranteed without a fresh handshake.
    with get_pooled_connection(
        host=credentials["host"],
        port=credentials["port"],
        username=credentials["username"],
        password=credentials["password"],
    ) as conn:
        yield conn
