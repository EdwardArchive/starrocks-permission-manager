"""Tests for /api/admin/dag/* endpoints.

Covers: admin_dag.py router — object hierarchy, role hierarchy, auth guard.
"""
from __future__ import annotations


def test_admin_object_hierarchy(client, auth_header):
    """GET /api/admin/dag/object-hierarchy returns a DAGGraph with SYSTEM node."""
    resp = client.get(
        "/api/admin/dag/object-hierarchy",
        params={"catalog": "default_catalog"},
        headers=auth_header,
    )
    assert resp.status_code == 200
    data = resp.json()
    assert "nodes" in data
    assert "edges" in data
    # SYSTEM node is always present
    sys_nodes = [n for n in data["nodes"] if n["type"] == "system"]
    assert len(sys_nodes) == 1
    assert sys_nodes[0]["label"] == "SYSTEM"
    # Should have catalog node
    cat_nodes = [n for n in data["nodes"] if n["type"] == "catalog"]
    assert any(n["label"] == "default_catalog" for n in cat_nodes)
    # Should have database nodes
    db_nodes = [n for n in data["nodes"] if n["type"] == "database"]
    assert len(db_nodes) >= 1


def test_admin_object_hierarchy_shallow(client, auth_header):
    """depth=shallow returns catalogs+DBs but no individual objects."""
    resp = client.get(
        "/api/admin/dag/object-hierarchy",
        params={"catalog": "default_catalog", "depth": "shallow"},
        headers=auth_header,
    )
    assert resp.status_code == 200
    data = resp.json()
    # Should have system, catalog, database nodes
    node_types = {n["type"] for n in data["nodes"]}
    assert "system" in node_types
    assert "catalog" in node_types
    assert "database" in node_types
    # Should NOT have individual table/view nodes (no group nodes either)
    table_nodes = [n for n in data["nodes"] if n["type"] == "table" and n.get("node_role") != "group"]
    assert len(table_nodes) == 0


def test_admin_role_hierarchy(client, auth_header):
    """GET /api/admin/dag/role-hierarchy returns a DAGGraph with role+user nodes."""
    resp = client.get("/api/admin/dag/role-hierarchy", headers=auth_header)
    assert resp.status_code == 200
    data = resp.json()
    assert "nodes" in data
    assert "edges" in data
    node_types = {n["type"] for n in data["nodes"]}
    assert "role" in node_types
    # Should have user nodes (from sys.role_edges)
    assert "user" in node_types
    # Should have edges
    assert len(data["edges"]) >= 1


def test_admin_object_hierarchy_default_catalog(client, auth_header):
    """Object hierarchy without catalog param defaults to default_catalog."""
    resp = client.get("/api/admin/dag/object-hierarchy", headers=auth_header)
    assert resp.status_code == 200
    data = resp.json()
    cat_nodes = [n for n in data["nodes"] if n["type"] == "catalog"]
    # Default param is "default_catalog" so only that catalog appears
    assert len(cat_nodes) == 1
    assert cat_nodes[0]["label"] == "default_catalog"


def test_admin_object_hierarchy_has_edges(client, auth_header):
    """Object hierarchy edges connect SYSTEM->catalog->database."""
    resp = client.get(
        "/api/admin/dag/object-hierarchy",
        params={"catalog": "default_catalog"},
        headers=auth_header,
    )
    assert resp.status_code == 200
    data = resp.json()
    edge_sources = {e["source"] for e in data["edges"]}
    edge_targets = {e["target"] for e in data["edges"]}
    # SYSTEM should be a source
    assert "sys" in edge_sources
    # Catalog node should be a target of SYSTEM and source of DB edges
    assert "c_default_catalog" in edge_targets
    assert "c_default_catalog" in edge_sources
