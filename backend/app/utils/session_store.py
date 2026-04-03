"""
In-memory session store for StarRocks credentials.

Credentials are stored server-side so that JWT tokens never contain passwords.
Each session has a TTL matching the JWT expiration time.

NOTE: This store is per-process. In multi-worker deployments (e.g. gunicorn
with multiple workers), sessions are not shared across workers. Use sticky
sessions at the load balancer or limit to a single worker if needed.
"""

from __future__ import annotations

import threading
import time
import uuid
from typing import Any

from app.config import settings


class SessionStore:
    """Thread-safe in-memory session store with TTL-based expiration."""

    def __init__(self) -> None:
        self._store: dict[str, dict[str, Any]] = {}
        self._lock = threading.Lock()

    def create(self, host: str, port: int, username: str, password: str) -> str:
        session_id = uuid.uuid4().hex
        expires_at = time.time() + settings.jwt_expire_minutes * 60
        with self._lock:
            self._store[session_id] = {
                "host": host,
                "port": port,
                "username": username,
                "password": password,
                "expires_at": expires_at,
            }
        return session_id

    def get(self, session_id: str) -> dict[str, Any] | None:
        with self._lock:
            entry = self._store.get(session_id)
            if entry is None:
                return None
            if time.time() > entry["expires_at"]:
                del self._store[session_id]
                return None
            return {
                "host": entry["host"],
                "port": entry["port"],
                "username": entry["username"],
                "password": entry["password"],
            }

    def delete(self, session_id: str) -> bool:
        with self._lock:
            return self._store.pop(session_id, None) is not None

    def cleanup_expired(self) -> int:
        now = time.time()
        with self._lock:
            expired = [k for k, v in self._store.items() if now > v["expires_at"]]
            for k in expired:
                del self._store[k]
            return len(expired)

    def clear(self) -> None:
        with self._lock:
            self._store.clear()


session_store = SessionStore()
