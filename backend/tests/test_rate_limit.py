"""Tests for the login rate limiter."""
from __future__ import annotations

from unittest.mock import patch

from app.utils.rate_limit import SlidingWindowRateLimiter


class TestSlidingWindow:
    def test_allows_up_to_limit(self):
        rl = SlidingWindowRateLimiter(max_attempts=3, window_seconds=60)
        assert [rl.allow("ip", now=t) for t in (0, 1, 2)] == [True, True, True]

    def test_blocks_over_limit(self):
        rl = SlidingWindowRateLimiter(max_attempts=3, window_seconds=60)
        for t in (0, 1, 2):
            rl.allow("ip", now=t)
        assert rl.allow("ip", now=3) is False

    def test_window_slides(self):
        rl = SlidingWindowRateLimiter(max_attempts=2, window_seconds=10)
        rl.allow("ip", now=0)
        rl.allow("ip", now=1)
        assert rl.allow("ip", now=5) is False
        # After the window passes, earlier hits expire.
        assert rl.allow("ip", now=12) is True

    def test_keys_are_independent(self):
        rl = SlidingWindowRateLimiter(max_attempts=1, window_seconds=60)
        assert rl.allow("a", now=0) is True
        assert rl.allow("b", now=0) is True
        assert rl.allow("a", now=1) is False


def test_login_endpoint_throttles(client):
    body = {"host": "h", "port": 9030, "username": "u", "password": "p"}
    with patch("app.routers.auth.test_connection", return_value=False):
        # Default limit is 10/min; the first 10 reach auth logic (401), the 11th is throttled.
        statuses = [client.post("/api/auth/login", json=body).status_code for _ in range(11)]
    assert statuses[:10] == [401] * 10
    assert statuses[10] == 429
