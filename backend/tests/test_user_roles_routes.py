"""Tests for /api/user/roles/* endpoints.

Covers: user_roles.py router — list roles, hierarchy DAG, inheritance DAG.
"""
from __future__ import annotations


def test_user_list_roles(client, auth_header, query_map):
    """GET /api/user/roles returns a list of role items."""
    # get_user_roles tries sys.role_edges first → override to include analyst_role
    query_map["SELECT FROM_ROLE FROM sys.role_edges WHERE TO_USER"] = [
        {"FROM_ROLE": "analyst_role"},
        {"FROM_ROLE": "public"},
    ]
    # get_parent_roles for analyst_role → no parents
    query_map["SELECT FROM_ROLE FROM sys.role_edges WHERE TO_ROLE"] = []
    resp = client.get("/api/user/roles", headers=auth_header)
    assert resp.status_code == 200
    data = resp.json()
    assert isinstance(data, list)
    names = {r["name"] for r in data}
    assert "analyst_role" in names
    assert "public" in names


def test_user_list_roles_returns_builtin_flag(client, auth_header, query_map):
    """Builtin roles have is_builtin=True."""
    query_map["SELECT FROM_ROLE FROM sys.role_edges WHERE TO_USER"] = [
        {"FROM_ROLE": "public"},
    ]
    query_map["SELECT FROM_ROLE FROM sys.role_edges WHERE TO_ROLE"] = []
    resp = client.get("/api/user/roles", headers=auth_header)
    assert resp.status_code == 200
    data = resp.json()
    public_role = next((r for r in data if r["name"] == "public"), None)
    assert public_role is not None
    assert public_role["is_builtin"] is True


def test_user_role_hierarchy(client, auth_header, query_map):
    """GET /api/user/roles/hierarchy returns a DAGGraph with nodes and edges."""
    # parse_role_assignments for USER calls SHOW GRANTS FOR 'test_admin'
    query_map["SHOW GRANTS FOR 'test_admin'"] = [
        {"Grants": "GRANT 'analyst_role' TO 'test_admin'@'%'"},
    ]
    # parse_role_assignments for ROLE calls SHOW GRANTS FOR ROLE 'analyst_role'
    query_map["SHOW GRANTS FOR ROLE 'analyst_role'"] = []
    query_map["SHOW GRANTS FOR ROLE"] = []
    resp = client.get("/api/user/roles/hierarchy", headers=auth_header)
    assert resp.status_code == 200
    data = resp.json()
    assert "nodes" in data
    assert "edges" in data
    # Should have user node + role nodes
    node_types = {n["type"] for n in data["nodes"]}
    assert "user" in node_types
    assert "role" in node_types


def test_user_inheritance_dag_user(client, auth_header, query_map):
    """GET /api/user/roles/inheritance-dag?name=test_admin&type=user returns DAG with user node."""
    # get_user_roles tries sys.role_edges first, which exists in DEFAULT_QUERY_MAP
    resp = client.get(
        "/api/user/roles/inheritance-dag",
        params={"name": "test_admin", "type": "user"},
        headers=auth_header,
    )
    assert resp.status_code == 200
    data = resp.json()
    assert "nodes" in data
    assert "edges" in data
    # User node must be present and highlighted
    user_nodes = [n for n in data["nodes"] if n["type"] == "user"]
    assert len(user_nodes) >= 1
    assert user_nodes[0]["label"] == "test_admin"
    assert user_nodes[0]["metadata"]["highlight"] is True


def test_user_inheritance_dag_role(client, auth_header):
    """GET /api/user/roles/inheritance-dag?name=analyst_role&type=role returns DAG with role node."""
    resp = client.get(
        "/api/user/roles/inheritance-dag",
        params={"name": "analyst_role", "type": "role"},
        headers=auth_header,
    )
    assert resp.status_code == 200
    data = resp.json()
    assert "nodes" in data
    role_nodes = [n for n in data["nodes"] if n["type"] == "role"]
    assert any(n["label"] == "analyst_role" for n in role_nodes)
    # The highlighted node should be analyst_role
    highlighted = [n for n in data["nodes"] if n.get("metadata", {}).get("highlight")]
    assert any(n["label"] == "analyst_role" for n in highlighted)


def test_user_inheritance_dag_missing_name(client, auth_header):
    """inheritance-dag with empty name returns a DAG (not an error)."""
    resp = client.get(
        "/api/user/roles/inheritance-dag",
        params={"name": "", "type": "user"},
        headers=auth_header,
    )
    # Empty name is valid (defaults to ""), should still return 200 with nodes
    assert resp.status_code == 200
    data = resp.json()
    assert "nodes" in data
