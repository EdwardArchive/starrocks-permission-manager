"""
Integration tests against a real StarRocks cluster.

These tests are SKIPPED by default. To run them, set environment variables:

    export SR_TEST_HOST=your-starrocks-host
    export SR_TEST_PORT=9030
    export SR_TEST_USER=admin
    export SR_TEST_PASS=your-password
    cd backend && python -m pytest tests/test_integration.py -v

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

    def _real_credentials():
        return {
            "host": SR_HOST,
            "port": SR_PORT,
            "username": SR_USER,
            "password": SR_PASS,
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
    return create_token(SR_HOST, SR_PORT, SR_USER, SR_PASS)


@pytest.fixture()
def real_header(real_token):
    return {"Authorization": f"Bearer {real_token}"}


# ── Auth ──

@skip_no_sr
def test_real_login(real_client):
    resp = real_client.post("/api/auth/login", json={
        "host": SR_HOST,
        "port": SR_PORT,
        "username": SR_USER,
        "password": SR_PASS,
    })
    assert resp.status_code == 200
    data = resp.json()
    assert "token" in data
    assert data["username"] == SR_USER
    assert isinstance(data["roles"], list)
    print(f"\n  Login OK: user={data['username']}, roles={data['roles']}")


@skip_no_sr
def test_real_me(real_client, real_header):
    resp = real_client.get("/api/auth/me", headers=real_header)
    assert resp.status_code == 200
    data = resp.json()
    print(f"\n  Me: {data}")
    assert data["username"] == SR_USER


# ── Objects ──

@skip_no_sr
def test_real_catalogs(real_client, real_header):
    resp = real_client.get("/api/objects/catalogs", headers=real_header)
    assert resp.status_code == 200
    data = resp.json()
    assert isinstance(data, list)
    assert len(data) >= 1
    names = [c["name"] for c in data]
    print(f"\n  Catalogs: {names}")
    assert "default_catalog" in names


@skip_no_sr
def test_real_databases(real_client, real_header):
    resp = real_client.get(
        "/api/objects/databases",
        params={"catalog": "default_catalog"},
        headers=real_header,
    )
    assert resp.status_code == 200
    data = resp.json()
    assert isinstance(data, list)
    names = [d["name"] for d in data]
    print(f"\n  Databases (default_catalog): {names}")
    assert "information_schema" not in names


@skip_no_sr
def test_real_tables(real_client, real_header):
    # Get first available database
    dbs = real_client.get(
        "/api/objects/databases",
        params={"catalog": "default_catalog"},
        headers=real_header,
    ).json()
    if not dbs:
        pytest.skip("No databases found")
    db_name = dbs[0]["name"]

    resp = real_client.get(
        "/api/objects/tables",
        params={"catalog": "default_catalog", "database": db_name},
        headers=real_header,
    )
    assert resp.status_code == 200
    data = resp.json()
    assert isinstance(data, list)
    print(f"\n  Objects in {db_name}: {[(o['name'], o['object_type']) for o in data[:10]]}")


@skip_no_sr
def test_real_table_detail(real_client, real_header):
    # Find a table to inspect
    dbs = real_client.get(
        "/api/objects/databases",
        params={"catalog": "default_catalog"},
        headers=real_header,
    ).json()
    if not dbs:
        pytest.skip("No databases found")

    for db in dbs:
        tables = real_client.get(
            "/api/objects/tables",
            params={"catalog": "default_catalog", "database": db["name"]},
            headers=real_header,
        ).json()
        base_tables = [t for t in tables if t["object_type"] == "TABLE"]
        if base_tables:
            tbl = base_tables[0]
            resp = real_client.get(
                "/api/objects/table-detail",
                params={
                    "catalog": "default_catalog",
                    "database": db["name"],
                    "table": tbl["name"],
                },
                headers=real_header,
            )
            assert resp.status_code == 200
            data = resp.json()
            print(f"\n  Table detail: {data['table_name']}")
            print(f"    key_type={data.get('key_type')}, dist={data.get('distribution_type')}")
            print(f"    buckets={data.get('bucket_count')}, partitions={data.get('partition_count')}")
            print(f"    columns={len(data.get('columns', []))}")
            assert len(data["columns"]) > 0
            return

    pytest.skip("No tables found in any database")


# ── Privileges ──

@skip_no_sr
def test_real_user_privileges(real_client, real_header):
    resp = real_client.get(f"/api/privileges/user/{SR_USER}", headers=real_header)
    assert resp.status_code == 200
    data = resp.json()
    assert isinstance(data, list)
    print(f"\n  Direct grants for {SR_USER}: {len(data)}")


@skip_no_sr
def test_real_effective_privileges(real_client, real_header):
    resp = real_client.get(f"/api/privileges/user/{SR_USER}/effective", headers=real_header)
    assert resp.status_code == 200
    data = resp.json()
    assert isinstance(data, list)
    print(f"\n  Effective grants for {SR_USER}: {len(data)}")
    sources = {g["source"] for g in data}
    print(f"    Sources: {sources}")


# ── Roles ──

@skip_no_sr
def test_real_roles(real_client, real_header):
    resp = real_client.get("/api/roles", headers=real_header)
    assert resp.status_code == 200
    data = resp.json()
    assert isinstance(data, list)
    names = [r["name"] for r in data]
    print(f"\n  Roles: {names}")
    assert "root" in names
    assert "public" in names


@skip_no_sr
def test_real_role_hierarchy(real_client, real_header):
    resp = real_client.get("/api/roles/hierarchy", headers=real_header)
    assert resp.status_code == 200
    data = resp.json()
    print(f"\n  Role hierarchy: {len(data['nodes'])} nodes, {len(data['edges'])} edges")
    assert len(data["nodes"]) > 0


# ── DAG ──

@skip_no_sr
def test_real_object_hierarchy(real_client, real_header):
    resp = real_client.get(
        "/api/dag/object-hierarchy",
        params={"catalog": "default_catalog"},
        headers=real_header,
    )
    assert resp.status_code == 200
    data = resp.json()
    print(f"\n  Object DAG: {len(data['nodes'])} nodes, {len(data['edges'])} edges")
    types = {n["type"] for n in data["nodes"]}
    print(f"    Node types: {types}")
    assert "system" in types
    assert "catalog" in types


@skip_no_sr
def test_real_full_graph(real_client, real_header):
    resp = real_client.get("/api/dag/full", headers=real_header)
    assert resp.status_code == 200
    data = resp.json()
    print(f"\n  Full graph: {len(data['nodes'])} nodes, {len(data['edges'])} edges")
    types = {n["type"] for n in data["nodes"]}
    edge_types = {e["edge_type"] for e in data["edges"]}
    print(f"    Node types: {types}")
    print(f"    Edge types: {edge_types}")
