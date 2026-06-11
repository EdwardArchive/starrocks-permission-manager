"""In-memory sliding-window rate limiter.

Sized for the single-worker deployment (the session store is already in-process,
so a process-local limiter is consistent with the rest of the app).
"""

from __future__ import annotations

import os
import threading
import time
from collections import defaultdict, deque

# Defaults are deliberately generous for an internal admin tool; override via env.
_LOGIN_MAX_ATTEMPTS = int(os.getenv("SRPM_LOGIN_MAX_ATTEMPTS", "10"))
_LOGIN_WINDOW_SECONDS = float(os.getenv("SRPM_LOGIN_WINDOW_SECONDS", "60"))


class SlidingWindowRateLimiter:
    def __init__(self, max_attempts: int, window_seconds: float):
        self._max = max_attempts
        self._window = window_seconds
        self._hits: dict[str, deque[float]] = defaultdict(deque)
        self._lock = threading.Lock()

    def allow(self, key: str, now: float | None = None) -> bool:
        """Record an attempt for ``key``; return False if it exceeds the window limit."""
        now = time.monotonic() if now is None else now
        cutoff = now - self._window
        with self._lock:
            hits = self._hits[key]
            while hits and hits[0] <= cutoff:
                hits.popleft()
            if len(hits) >= self._max:
                return False
            hits.append(now)
            return True

    def reset(self) -> None:
        with self._lock:
            self._hits.clear()


login_rate_limiter = SlidingWindowRateLimiter(_LOGIN_MAX_ATTEMPTS, _LOGIN_WINDOW_SECONDS)
