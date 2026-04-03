"""Unit tests for the in-memory session store."""
from __future__ import annotations

from unittest.mock import patch

from app.utils.session_store import SessionStore


def test_create_and_get():
    store = SessionStore()
    sid = store.create("h", 9030, "user", "pass")
    creds = store.get(sid)
    assert creds is not None
    assert creds["host"] == "h"
    assert creds["port"] == 9030
    assert creds["username"] == "user"
    assert creds["password"] == "pass"


def test_get_missing():
    store = SessionStore()
    assert store.get("nonexistent") is None


def test_delete():
    store = SessionStore()
    sid = store.create("h", 9030, "user", "pass")
    assert store.delete(sid) is True
    assert store.get(sid) is None
    assert store.delete(sid) is False


def test_expired_session():
    store = SessionStore()
    sid = store.create("h", 9030, "user", "pass")
    # Simulate time passing beyond expiration
    with patch("app.utils.session_store.time") as mock_time:
        mock_time.time.return_value = 9999999999.0
        assert store.get(sid) is None


def test_cleanup_expired():
    store = SessionStore()
    store.create("h", 9030, "user1", "p1")
    store.create("h", 9030, "user2", "p2")

    with patch("app.utils.session_store.time") as mock_time:
        mock_time.time.return_value = 9999999999.0
        removed = store.cleanup_expired()
    assert removed == 2


def test_clear():
    store = SessionStore()
    store.create("h", 9030, "u1", "p1")
    store.create("h", 9030, "u2", "p2")
    store.clear()
    assert store.cleanup_expired() == 0
