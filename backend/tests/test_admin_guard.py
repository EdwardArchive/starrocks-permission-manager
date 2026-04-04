"""Tests that /api/admin/* routes return 403 for non-admin users."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app.dependencies import get_credentials, get_db
from app.main import app
from app.utils.session import create_token
from app.utils.session_store import session_store

from tests.conftest import FakeConnection, DEFAULT_QUERY_MAP


def _make_non_admin_client():
    """Create a test client with non-admin credentials."""
    session_id = session_store.create("test-host", 9030, "viewer", "pass", is_admin=False)
    token = create_token(session_id, "viewer")

    def _override_credentials():
        return {
            "host": "test-host",
            "port": 9030,
            "username": "viewer",
            "password": "pass",
            "is_admin": False,
        }

    def _override_db():
        yield FakeConnection(dict(DEFAULT_QUERY_MAP))

    app.dependency_overrides[get_credentials] = _override_credentials
    app.dependency_overrides[get_db] = _override_db

    return TestClient(app), {"Authorization": f"Bearer {token}"}


@pytest.fixture()
def non_admin():
    client, headers = _make_non_admin_client()
    with client as c:
        yield c, headers
    app.dependency_overrides.clear()


ADMIN_ROUTES = [
    "/api/admin/privileges/user/test_admin",
    "/api/admin/privileges/user/test_admin/effective",
    "/api/admin/privileges/role/analyst_role",
    "/api/admin/privileges/role/analyst_role/raw",
    "/api/admin/privileges/object?catalog=default_catalog&database=analytics_db&name=user_events&object_type=TABLE",
    "/api/admin/roles",
    "/api/admin/roles/hierarchy",
    "/api/admin/roles/inheritance-dag?name=test_admin&type=user",
    "/api/admin/roles/analyst_role/users",
    "/api/admin/dag/object-hierarchy",
    "/api/admin/dag/role-hierarchy",
    "/api/admin/search?q=test",
    "/api/admin/search/users-roles?q=test",
]


@pytest.mark.parametrize("route", ADMIN_ROUTES)
def test_admin_routes_reject_non_admin(non_admin, route):
    client, headers = non_admin
    resp = client.get(route, headers=headers)
    assert resp.status_code == 403, f"{route} should return 403, got {resp.status_code}"
