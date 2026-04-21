"""HTTP smoke tests against a running container.

Used during CI to profile workload for Rapidfort stub hardening.
Unlike test_integration.py (in-process TestClient), this hits a real
HTTP server so the Rapidfort stub container records actual syscalls,
file accesses, and package usage.

Run locally:
    export SMOKE_BASE_URL=http://localhost:8001
    export SR_TEST_HOST=your-sr-host
    export SR_TEST_USER=your-user
    export SR_TEST_PASS=your-password
    cd backend && python -m pytest tests/test_smoke_http.py -v -s
"""

from __future__ import annotations

import os

import httpx
import pytest

BASE_URL = os.environ.get("SMOKE_BASE_URL", "")
SR_HOST = os.environ.get("SR_TEST_HOST", "")
SR_PORT = int(os.environ.get("SR_TEST_PORT", "9030"))
SR_USER = os.environ.get("SR_TEST_USER", "")
SR_PASS = os.environ.get("SR_TEST_PASS", "")

skip_no_smoke = pytest.mark.skipif(
    not BASE_URL or not SR_HOST or not SR_USER,
    reason="SMOKE_BASE_URL or SR_TEST_* not set. Skipping smoke tests.",
)


@pytest.fixture(scope="module")
def http_client():
    with httpx.Client(base_url=BASE_URL, timeout=30.0) as client:
        yield client


@pytest.fixture(scope="module")
def auth_token(http_client):
    resp = http_client.post(
        "/api/auth/login",
        json={"host": SR_HOST, "port": SR_PORT, "username": SR_USER, "password": SR_PASS},
    )
    assert resp.status_code == 200, f"Login failed: {resp.status_code} {resp.text}"
    return resp.json()["token"]


@pytest.fixture(scope="module")
def auth_headers(auth_token):
    return {"Authorization": f"Bearer {auth_token}"}


@pytest.fixture(scope="module")
def is_admin(http_client, auth_headers):
    resp = http_client.get("/api/auth/me", headers=auth_headers)
    assert resp.status_code == 200
    return resp.json().get("is_user_admin", False)


@skip_no_smoke
def test_health(http_client):
    resp = http_client.get("/api/health")
    assert resp.status_code == 200


@skip_no_smoke
def test_me(http_client, auth_headers):
    resp = http_client.get("/api/auth/me", headers=auth_headers)
    assert resp.status_code == 200


@skip_no_smoke
def test_my_permissions(http_client, auth_headers):
    resp = http_client.get("/api/user/my-permissions", headers=auth_headers)
    assert resp.status_code == 200


@skip_no_smoke
@pytest.mark.parametrize(
    "path",
    [
        "/api/user/objects/catalogs",
        "/api/user/objects/databases",
        "/api/user/roles",
        "/api/user/roles/hierarchy",
        "/api/user/dag/object-hierarchy",
        "/api/user/dag/role-hierarchy",
    ],
)
def test_user_endpoints(http_client, auth_headers, path):
    resp = http_client.get(path, headers=auth_headers)
    assert resp.status_code == 200, f"{path} returned {resp.status_code}: {resp.text[:200]}"


@skip_no_smoke
def test_cluster_status(http_client, auth_headers):
    # May return 403 if user lacks cluster_admin — that's fine, we just want to exercise the path
    resp = http_client.get("/api/cluster/status", headers=auth_headers)
    assert resp.status_code in (200, 403)


@skip_no_smoke
def test_admin_endpoints(http_client, auth_headers, is_admin):
    if not is_admin:
        pytest.skip("User is not admin")
    for path in (
        "/api/admin/roles",
        "/api/admin/roles/hierarchy",
        "/api/admin/dag/object-hierarchy",
        "/api/admin/dag/role-hierarchy",
    ):
        resp = http_client.get(path, headers=auth_headers)
        assert resp.status_code == 200, f"{path} returned {resp.status_code}: {resp.text[:200]}"


@skip_no_smoke
def test_logout(http_client, auth_headers):
    resp = http_client.post("/api/auth/logout", headers=auth_headers)
    assert resp.status_code == 200
