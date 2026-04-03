from __future__ import annotations

from fastapi import Depends, Header, HTTPException

from app.services.starrocks_client import get_connection
from app.utils.session import decode_token


def get_credentials(authorization: str = Header(...)) -> dict:
    if not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Invalid authorization header")
    token = authorization[7:]
    try:
        return decode_token(token)
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid or expired token")


def get_db(credentials: dict = Depends(get_credentials)):
    with get_connection(
        host=credentials["host"],
        port=credentials["port"],
        username=credentials["username"],
        password=credentials["password"],
    ) as conn:
        yield conn
