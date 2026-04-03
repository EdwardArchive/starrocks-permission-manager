from __future__ import annotations

import time

import jwt

from app.config import settings


def create_token(session_id: str, username: str) -> str:
    payload = {
        "session_id": session_id,
        "username": username,
        "exp": int(time.time()) + settings.jwt_expire_minutes * 60,
    }
    return jwt.encode(payload, settings.jwt_secret, algorithm=settings.jwt_algorithm)


def decode_token(token: str) -> dict:
    return jwt.decode(token, settings.jwt_secret, algorithms=[settings.jwt_algorithm])
