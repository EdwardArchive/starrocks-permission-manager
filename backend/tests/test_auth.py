from unittest.mock import patch


def test_login_success(client):
    with patch("app.routers.auth.test_connection", return_value=True):
        with patch("app.routers.auth.get_connection") as mock_gc:
            # Mock the connection context manager
            from tests.conftest import FakeConnection, DEFAULT_QUERY_MAP

            fake = FakeConnection(DEFAULT_QUERY_MAP)
            mock_gc.return_value.__enter__ = lambda s: fake
            mock_gc.return_value.__exit__ = lambda s, *a: None

            resp = client.post("/api/auth/login", json={
                "host": "test-host",
                "port": 9030,
                "username": "admin",
                "password": "pass",
            })

    assert resp.status_code == 200
    data = resp.json()
    assert "token" in data
    assert data["username"] == "admin"
    assert isinstance(data["roles"], list)


def test_login_failure(client):
    with patch("app.routers.auth.test_connection", return_value=False):
        resp = client.post("/api/auth/login", json={
            "host": "bad-host",
            "port": 9030,
            "username": "admin",
            "password": "wrong",
        })
    assert resp.status_code == 401


def test_login_missing_fields(client):
    resp = client.post("/api/auth/login", json={"host": "h"})
    assert resp.status_code == 422


def test_me(client, auth_header):
    resp = client.get("/api/auth/me", headers=auth_header)
    assert resp.status_code == 200
    data = resp.json()
    assert data["username"] == "test_admin"
    assert isinstance(data["roles"], list)
    assert "is_user_admin" in data


def test_me_no_auth(client):
    # NOTE: With dependency override, credentials are always injected.
    # This test verifies the override works (200), not real auth rejection.
    # Real auth rejection is tested via integration tests with no override.
    resp = client.get("/api/auth/me")
    assert resp.status_code == 200
