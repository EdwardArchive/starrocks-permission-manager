"""The catalog list cache must be keyed per user (SHOW CATALOGS is filtered)."""
from __future__ import annotations

from app.routers.user_objects import _catalog_cache
from app.utils.session import create_token
from app.utils.session_store import session_store

from tests.conftest import TEST_HOST, TEST_PORT


def _token(username: str) -> str:
    sid = session_store.create(TEST_HOST, TEST_PORT, username, "pw", is_admin=False)
    return create_token(sid, username)


def test_catalog_cache_is_per_user(client):
    headers_a = {"Authorization": f"Bearer {_token('alice')}"}
    headers_b = {"Authorization": f"Bearer {_token('bob')}"}

    assert client.get("/api/user/objects/catalogs", headers=headers_a).status_code == 200
    assert client.get("/api/user/objects/catalogs", headers=headers_b).status_code == 200

    keys = list(_catalog_cache.keys())
    users_cached = {k[1] for k in keys}
    assert "alice" in users_cached
    assert "bob" in users_cached
    # Distinct entries — no shared constant "catalogs" key.
    assert "catalogs" not in keys
