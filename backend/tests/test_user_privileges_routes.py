"""Tests for /api/user/privileges/* endpoints.

These routes are available to all users (admin → sys.* path, non-admin → SHOW
GRANTS path), both via the same GrantResolver. The frontend calls all three
(frontend/src/api/user.ts), so they need coverage.
"""

from __future__ import annotations


def test_user_effective_privileges(client, auth_header):
    resp = client.get("/api/user/privileges/user/test_admin/effective", headers=auth_header)
    assert resp.status_code == 200
    data = resp.json()
    assert isinstance(data, list)
    assert len(data) >= 1
    assert "direct" in {g["source"] for g in data}


def test_user_role_privileges(client, auth_header):
    resp = client.get("/api/user/privileges/role/analyst_role", headers=auth_header)
    assert resp.status_code == 200
    data = resp.json()
    assert isinstance(data, list)
    assert len(data) >= 1
    assert data[0]["grantee"] == "analyst_role"
    assert data[0]["grantee_type"] == "ROLE"


def test_user_object_privileges(client, auth_header):
    resp = client.get(
        "/api/user/privileges/object",
        params={
            "catalog": "default_catalog",
            "database": "analytics_db",
            "name": "user_events",
            "object_type": "TABLE",
        },
        headers=auth_header,
    )
    assert resp.status_code == 200
    assert isinstance(resp.json(), list)


def test_user_effective_privileges_non_admin(client, non_admin_auth_header):
    # Non-admin takes the SHOW GRANTS path (collector handles the split); the
    # endpoint must still return a well-formed list.
    resp = client.get("/api/user/privileges/user/kate/effective", headers=non_admin_auth_header)
    assert resp.status_code == 200
    assert isinstance(resp.json(), list)


def test_user_role_privileges_non_admin(client, non_admin_auth_header):
    resp = client.get("/api/user/privileges/role/public", headers=non_admin_auth_header)
    assert resp.status_code == 200
    assert isinstance(resp.json(), list)
