"""
Integration tests against a real StarRocks cluster.

These tests are SKIPPED by default. To run them, set environment variables:

    export SR_TEST_HOST=your-starrocks-host
    export SR_TEST_PORT=9030
    export SR_TEST_USER=admin
    export SR_TEST_PASS=your-password
    cd backend && python -m pytest tests/test_integration.py -v -s

All tests use read-only queries (no DDL/DML).
"""

from __future__ import annotations

import os

import pytest
from fastapi.testclient import TestClient

from app.dependencies import get_credentials, get_db
from app.main import app
from app.services.starrocks_client import get_connection
from app.utils.session import create_token
from app.utils.session_store import session_store

SR_HOST = os.environ.get("SR_TEST_HOST", "")
SR_PORT = int(os.environ.get("SR_TEST_PORT", "9030"))
SR_USER = os.environ.get("SR_TEST_USER", "")
SR_PASS = os.environ.get("SR_TEST_PASS", "")

skip_no_sr = pytest.mark.skipif(
    not SR_HOST or not SR_USER,
    reason="SR_TEST_HOST / SR_TEST_USER not set. Skipping integration tests.",
)


@pytest.fixture()
def real_client():
    """TestClient that connects to a real StarRocks cluster."""

    # Detect admin status once
    from app.utils.sys_access import can_access_sys

    with get_connection(SR_HOST, SR_PORT, SR_USER, SR_PASS) as _probe:
        _is_admin = can_access_sys(_probe)

    def _real_credentials():
        return {
            "host": SR_HOST,
            "port": SR_PORT,
            "username": SR_USER,
            "password": SR_PASS,
            "is_admin": _is_admin,
        }

    def _real_db():
        with get_connection(SR_HOST, SR_PORT, SR_USER, SR_PASS) as conn:
            yield conn

    app.dependency_overrides[get_credentials] = _real_credentials
    app.dependency_overrides[get_db] = _real_db

    with TestClient(app) as c:
        yield c

    app.dependency_overrides.clear()


@pytest.fixture()
def real_token():
    session_id = session_store.create(SR_HOST, SR_PORT, SR_USER, SR_PASS, is_admin=True)
    return create_token(session_id, SR_USER)


@pytest.fixture()
def real_header(real_token):
    return {"Authorization": f"Bearer {real_token}"}


# ── Auth ──


@skip_no_sr
def test_real_login(real_client):
    resp = real_client.post(
        "/api/auth/login",
        json={"host": SR_HOST, "port": SR_PORT, "username": SR_USER, "password": SR_PASS},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert "token" in data
    assert data["username"] == SR_USER
    assert isinstance(data["roles"], list)
    print(f"\n  Login OK: user={data['username']}, roles={data['roles']}")


@skip_no_sr
def test_real_login_failure(real_client):
    resp = real_client.post(
        "/api/auth/login",
        json={"host": SR_HOST, "port": SR_PORT, "username": "nonexistent_user", "password": "wrong"},
    )
    assert resp.status_code == 401


@skip_no_sr
def test_real_me(real_client, real_header):
    resp = real_client.get("/api/auth/me", headers=real_header)
    assert resp.status_code == 200
    data = resp.json()
    assert data["username"] == SR_USER
    assert isinstance(data["roles"], list)
    assert isinstance(data["is_user_admin"], bool)
    print(f"\n  Me: {data}")


@skip_no_sr
def test_real_logout():
    """Logout should invalidate the session — subsequent API calls must fail.
    Uses a raw TestClient without dependency overrides so session store is used."""
    with TestClient(app) as client:
        # Login to get a fresh token (goes through real session store)
        resp = client.post(
            "/api/auth/login",
            json={"host": SR_HOST, "port": SR_PORT, "username": SR_USER, "password": SR_PASS},
        )
        assert resp.status_code == 200
        token = resp.json()["token"]
        header = {"Authorization": f"Bearer {token}"}

        # Verify token works before logout
        resp = client.get("/api/auth/me", headers=header)
        assert resp.status_code == 200

        # Logout — destroys server-side session
        resp = client.post("/api/auth/logout", headers=header)
        assert resp.status_code == 200
        assert resp.json()["detail"] == "Logged out"

        # Token should now be invalid — session destroyed
        resp = client.get("/api/auth/me", headers=header)
        assert resp.status_code == 401, f"Expected 401 after logout, got {resp.status_code}"
        print("\n  Logout verified: token rejected after session invalidation")


# ── Objects ──


@skip_no_sr
def test_real_catalogs(real_client, real_header):
    resp = real_client.get("/api/user/objects/catalogs", headers=real_header)
    assert resp.status_code == 200
    data = resp.json()
    assert isinstance(data, list)
    assert len(data) >= 1
    names = [c["name"] for c in data]
    assert "default_catalog" in names
    print(f"\n  Catalogs: {names}")


@skip_no_sr
def test_real_databases(real_client, real_header):
    resp = real_client.get("/api/user/objects/databases", params={"catalog": "default_catalog"}, headers=real_header)
    assert resp.status_code == 200
    data = resp.json()
    assert isinstance(data, list)
    names = [d["name"] for d in data]
    assert len(names) >= 1
    # information_schema should be filtered by the API
    assert "information_schema" not in names
    print(f"\n  Databases: {names}")


@skip_no_sr
def test_real_tables(real_client, real_header):
    dbs = real_client.get("/api/user/objects/databases", params={"catalog": "default_catalog"}, headers=real_header).json()
    if not dbs:
        pytest.skip("No databases found")
    db_name = dbs[0]["name"]
    resp = real_client.get(
        "/api/user/objects/tables", params={"catalog": "default_catalog", "database": db_name}, headers=real_header
    )
    assert resp.status_code == 200
    data = resp.json()
    assert isinstance(data, list)
    # Each object should have required fields
    for obj in data[:5]:
        assert "name" in obj
        assert "object_type" in obj
        assert obj["object_type"] in ("TABLE", "VIEW", "MATERIALIZED VIEW", "FUNCTION")
    print(f"\n  Objects in {db_name}: {[(o['name'], o['object_type']) for o in data[:10]]}")


@skip_no_sr
def test_real_table_detail(real_client, real_header):
    dbs = real_client.get("/api/user/objects/databases", params={"catalog": "default_catalog"}, headers=real_header).json()
    if not dbs:
        pytest.skip("No databases found")

    for db in dbs:
        tables = real_client.get(
            "/api/user/objects/tables",
            params={"catalog": "default_catalog", "database": db["name"]},
            headers=real_header,
        ).json()
        base_tables = [t for t in tables if t["object_type"] == "TABLE"]
        if base_tables:
            tbl = base_tables[0]
            resp = real_client.get(
                "/api/user/objects/table-detail",
                params={"catalog": "default_catalog", "database": db["name"], "table": tbl["name"]},
                headers=real_header,
            )
            assert resp.status_code == 200
            data = resp.json()
            assert data["table_name"] == tbl["name"]
            assert len(data["columns"]) > 0
            # Each column should have basic fields
            for col in data["columns"]:
                assert "name" in col
                assert "column_type" in col
            print(f"\n  Table: {data['table_name']}, cols={len(data['columns'])}, key={data.get('key_type')}")
            return

    pytest.skip("No tables found in any database")


# ── Privileges ──


@skip_no_sr
def test_real_user_privileges(real_client, real_header):
    resp = real_client.get(f"/api/admin/privileges/user/{SR_USER}", headers=real_header)
    assert resp.status_code == 200
    data = resp.json()
    assert isinstance(data, list)
    print(f"\n  Direct grants for {SR_USER}: {len(data)}")


@skip_no_sr
def test_real_effective_privileges(real_client, real_header):
    resp = real_client.get(f"/api/admin/privileges/user/{SR_USER}/effective", headers=real_header)
    assert resp.status_code == 200
    data = resp.json()
    assert isinstance(data, list)
    sources = {g["source"] for g in data} if data else set()
    print(f"\n  Effective grants for {SR_USER}: {len(data)}, sources: {sources}")


@skip_no_sr
def test_real_object_privileges(real_client, real_header):
    """Test object privilege matrix — should include inherited roles and users."""
    # Find a table to test
    dbs = real_client.get("/api/user/objects/databases", params={"catalog": "default_catalog"}, headers=real_header).json()
    for db in dbs:
        tables = real_client.get(
            "/api/user/objects/tables",
            params={"catalog": "default_catalog", "database": db["name"]},
            headers=real_header,
        ).json()
        base_tables = [t for t in tables if t["object_type"] == "TABLE"]
        if base_tables:
            tbl = base_tables[0]
            resp = real_client.get(
                "/api/admin/privileges/object",
                params={"catalog": "default_catalog", "database": db["name"], "name": tbl["name"]},
                headers=real_header,
            )
            assert resp.status_code == 200
            data = resp.json()
            assert isinstance(data, list)
            # Should at least have root/db_admin
            grantees = {g["grantee"] for g in data}
            print(f"\n  Object privs for {db['name']}.{tbl['name']}: {len(data)} grants, grantees: {sorted(grantees)}")
            assert len(grantees) >= 1  # At least builtin roles
            # Verify grant structure
            for g in data[:5]:
                assert "grantee" in g
                assert "grantee_type" in g
                assert g["grantee_type"] in ("USER", "ROLE")
                assert "privilege_type" in g
            return

    pytest.skip("No tables found")


@skip_no_sr
def test_real_object_privileges_inheritance(real_client, real_header):
    """Verify inherited roles appear in object privilege results."""
    dbs = real_client.get("/api/user/objects/databases", params={"catalog": "default_catalog"}, headers=real_header).json()
    for db in dbs:
        tables = real_client.get(
            "/api/user/objects/tables",
            params={"catalog": "default_catalog", "database": db["name"]},
            headers=real_header,
        ).json()
        base_tables = [t for t in tables if t["object_type"] == "TABLE"]
        if base_tables:
            tbl = base_tables[0]
            resp = real_client.get(
                "/api/admin/privileges/object",
                params={"catalog": "default_catalog", "database": db["name"], "name": tbl["name"]},
                headers=real_header,
            )
            data = resp.json()
            roles = {g["grantee"] for g in data if g["grantee_type"] == "ROLE"}
            users = {g["grantee"] for g in data if g["grantee_type"] == "USER"}
            # Inherited entries should have source != "direct"
            inherited = [g for g in data if g.get("source") and g["source"] != "direct"]
            print(f"\n  Roles: {sorted(roles)}")
            print(f"  Users: {sorted(users)}")
            print(f"  Inherited grants: {len(inherited)}")
            # If there are roles, some users should also appear (via inheritance)
            if len(roles) > 2:  # More than just root/db_admin
                assert len(users) > 0, "Expected inherited users when custom roles have access"
            return

    pytest.skip("No tables found")


@skip_no_sr
def test_real_role_privileges(real_client, real_header):
    """Test role privilege endpoint including inherited grants."""
    resp = real_client.get("/api/admin/privileges/role/root", headers=real_header)
    assert resp.status_code == 200
    data = resp.json()
    assert isinstance(data, list)
    assert len(data) > 0
    obj_types = {g.get("object_type", "") for g in data}
    print(f"\n  root role: {len(data)} grants, types: {obj_types}")


# ── Roles ──


@skip_no_sr
def test_real_roles(real_client, real_header):
    resp = real_client.get("/api/admin/roles", headers=real_header)
    assert resp.status_code == 200
    data = resp.json()
    assert isinstance(data, list)
    names = [r["name"] for r in data]
    assert "root" in names
    assert "public" in names
    # Verify builtin flag
    for r in data:
        if r["name"] in ("root", "db_admin", "user_admin", "cluster_admin", "security_admin", "public"):
            assert r["is_builtin"] is True
    print(f"\n  Roles ({len(data)}): {names}")


@skip_no_sr
def test_real_role_hierarchy(real_client, real_header):
    resp = real_client.get("/api/admin/roles/hierarchy", headers=real_header)
    assert resp.status_code == 200
    data = resp.json()
    assert len(data["nodes"]) > 0
    assert len(data["edges"]) >= 0
    # Verify node structure
    for node in data["nodes"][:5]:
        assert "id" in node
        assert "label" in node
        assert "type" in node
        assert node["type"] in ("role", "user")
    # Verify edge structure
    for edge in data["edges"][:5]:
        assert "source" in edge
        assert "target" in edge
        assert edge["edge_type"] in ("inheritance", "assignment")
    print(f"\n  Role hierarchy: {len(data['nodes'])} nodes, {len(data['edges'])} edges")


@skip_no_sr
def test_real_role_users(real_client, real_header):
    """Test getting users assigned to a specific role."""
    resp = real_client.get("/api/admin/roles/public/users", headers=real_header)
    assert resp.status_code == 200
    data = resp.json()
    assert isinstance(data, list)
    print(f"\n  Users with 'public' role: {data}")


# ── DAG ──


@skip_no_sr
def test_real_object_hierarchy(real_client, real_header):
    resp = real_client.get(
        "/api/user/dag/object-hierarchy", params={"catalog": "default_catalog"}, headers=real_header
    )
    assert resp.status_code == 200
    data = resp.json()
    types = {n["type"] for n in data["nodes"]}
    assert "system" in types
    assert "catalog" in types
    # Verify group nodes exist
    group_nodes = [n for n in data["nodes"] if n.get("node_role") == "group"]
    if group_nodes:
        for g in group_nodes[:3]:
            assert "(" in g["label"]  # e.g. "Tables (5)"
    # Verify node metadata
    db_nodes = [n for n in data["nodes"] if n["type"] == "database"]
    for db in db_nodes[:3]:
        assert db.get("metadata", {}).get("catalog"), f"DB node {db['label']} missing catalog metadata"
    print(f"\n  Object DAG: {len(data['nodes'])} nodes, {len(data['edges'])} edges, types: {types}")


@skip_no_sr
def test_real_object_hierarchy_shallow(real_client, real_header):
    """Test shallow mode (catalogs + DBs only, no tables)."""
    resp = real_client.get(
        "/api/user/dag/object-hierarchy",
        params={"catalog": "default_catalog", "depth": "shallow"},
        headers=real_header,
    )
    assert resp.status_code == 200
    data = resp.json()
    types = {n["type"] for n in data["nodes"]}
    assert "table" not in types
    assert "view" not in types
    print(f"\n  Shallow DAG: {len(data['nodes'])} nodes, types: {types}")


# ── Search ──


@skip_no_sr
def test_real_search(real_client, real_header):
    resp = real_client.get("/api/admin/search", params={"q": "root"}, headers=real_header)
    assert resp.status_code == 200
    data = resp.json()
    assert isinstance(data, list)
    assert len(data) > 0
    names = [r["name"] for r in data]
    assert "root" in names
    print(f"\n  Search 'root': {data}")


@skip_no_sr
def test_real_search_empty_query(real_client, real_header):
    """Search with empty query should return 422 validation error."""
    resp = real_client.get("/api/admin/search", params={"q": ""}, headers=real_header)
    assert resp.status_code == 422


@skip_no_sr
def test_real_search_single_char(real_client, real_header):
    """Search with single char returns results (server has no min length)."""
    resp = real_client.get("/api/admin/search", params={"q": "a"}, headers=real_header)
    assert resp.status_code == 200
    data = resp.json()
    assert isinstance(data, list)
    print(f"\n  Search 'a': {len(data)} results")


@skip_no_sr
def test_real_search_tables(real_client, real_header):
    """Search should find tables."""
    # Get a table name first
    dbs = real_client.get("/api/user/objects/databases", params={"catalog": "default_catalog"}, headers=real_header).json()
    for db in dbs:
        tables = real_client.get(
            "/api/user/objects/tables",
            params={"catalog": "default_catalog", "database": db["name"]},
            headers=real_header,
        ).json()
        if tables:
            tbl_name = tables[0]["name"]
            resp = real_client.get("/api/admin/search", params={"q": tbl_name[:4]}, headers=real_header)
            assert resp.status_code == 200
            print(f"\n  Search '{tbl_name[:4]}': {len(resp.json())} results")
            return
    pytest.skip("No tables to search")


# ── Inheritance DAG ──


@skip_no_sr
def test_real_inheritance_dag_user(real_client, real_header):
    """Test inheritance DAG for a user."""
    resp = real_client.get(
        "/api/admin/roles/inheritance-dag", params={"name": SR_USER, "type": "user"}, headers=real_header
    )
    assert resp.status_code == 200
    data = resp.json()
    assert "nodes" in data
    assert "edges" in data
    # Should include the user node
    labels = {n["label"] for n in data["nodes"]}
    print(f"\n  Inheritance DAG for {SR_USER}: {len(data['nodes'])} nodes, labels: {labels}")


@skip_no_sr
def test_real_inheritance_dag_role(real_client, real_header):
    """Test inheritance DAG for a role."""
    resp = real_client.get(
        "/api/admin/roles/inheritance-dag", params={"name": "public", "type": "role"}, headers=real_header
    )
    assert resp.status_code == 200
    data = resp.json()
    assert "nodes" in data
    print(f"\n  Inheritance DAG for 'public': {len(data['nodes'])} nodes")


# ── Health ──


@skip_no_sr
def test_real_health(real_client):
    resp = real_client.get("/api/health")
    assert resp.status_code == 200
    assert resp.json()["status"] == "ok"
