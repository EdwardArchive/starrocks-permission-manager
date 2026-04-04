def test_list_roles(client, auth_header):
    resp = client.get("/api/admin/roles", headers=auth_header)
    assert resp.status_code == 200
    data = resp.json()
    assert isinstance(data, list)
    assert len(data) == 8

    names = {r["name"] for r in data}
    assert "root" in names
    assert "db_admin" in names
    assert "analyst_role" in names

    # Check builtin flag
    builtin_map = {r["name"]: r["is_builtin"] for r in data}
    assert builtin_map["root"] is True
    assert builtin_map["db_admin"] is True
    assert builtin_map["analyst_role"] is False


def test_role_hierarchy(client, auth_header):
    resp = client.get("/api/admin/roles/hierarchy", headers=auth_header)
    assert resp.status_code == 200
    data = resp.json()

    assert "nodes" in data
    assert "edges" in data
    assert isinstance(data["nodes"], list)
    assert isinstance(data["edges"], list)
    assert len(data["nodes"]) > 0
    assert len(data["edges"]) > 0

    # Check node structure
    node = data["nodes"][0]
    assert "id" in node
    assert "label" in node
    assert "type" in node
    assert node["type"] in ("role", "user")

    # Check edge structure
    edge = data["edges"][0]
    assert "id" in edge
    assert "source" in edge
    assert "target" in edge
    assert edge["edge_type"] in ("assignment", "inheritance")


def test_inheritance_dag_user(client, auth_header):
    """GET /roles/inheritance-dag?name=analyst_kim&type=user returns user node + role nodes + edges."""
    resp = client.get("/api/admin/roles/inheritance-dag?name=analyst_kim&type=user", headers=auth_header)
    assert resp.status_code == 200
    data = resp.json()

    assert "nodes" in data
    assert "edges" in data

    node_ids = {n["id"] for n in data["nodes"]}
    node_types = {n["id"]: n["type"] for n in data["nodes"]}

    # The user node must be present
    assert "u_analyst_kim" in node_ids
    assert node_types["u_analyst_kim"] == "user"

    # At least one role node should be present (from _get_user_roles mock)
    role_nodes = [n for n in data["nodes"] if n["type"] == "role"]
    assert len(role_nodes) >= 1

    # Edges should exist (role -> user assignment)
    assert len(data["edges"]) > 0
    edge_types = {e["edge_type"] for e in data["edges"]}
    assert "assignment" in edge_types

    # Check highlighted user node
    user_node = next(n for n in data["nodes"] if n["id"] == "u_analyst_kim")
    assert user_node.get("metadata", {}).get("highlight") is True


def test_inheritance_dag_role(client, auth_header):
    """GET /roles/inheritance-dag?name=db_admin&type=role returns role node + children + users."""
    resp = client.get("/api/admin/roles/inheritance-dag?name=db_admin&type=role", headers=auth_header)
    assert resp.status_code == 200
    data = resp.json()

    assert "nodes" in data
    assert "edges" in data

    node_ids = {n["id"] for n in data["nodes"]}

    # The selected role node must be present and highlighted
    assert "r_db_admin" in node_ids
    db_admin_node = next(n for n in data["nodes"] if n["id"] == "r_db_admin")
    assert db_admin_node["type"] == "role"
    assert db_admin_node.get("metadata", {}).get("highlight") is True

    # Child role from "SELECT TO_ROLE FROM sys.role_edges WHERE FROM_ROLE" mock
    assert "r_analyst_role" in node_ids

    # User from "SELECT TO_USER FROM sys.role_edges WHERE FROM_ROLE" mock
    assert "u_analyst_kim" in node_ids

    # Edges should contain both inheritance and assignment
    edge_types = {e["edge_type"] for e in data["edges"]}
    assert "inheritance" in edge_types
    assert "assignment" in edge_types


def test_inheritance_dag_empty(client, auth_header):
    """GET /roles/inheritance-dag?name=unknown_user&type=user returns minimal response."""
    resp = client.get("/api/admin/roles/inheritance-dag?name=unknown_user&type=user", headers=auth_header)
    assert resp.status_code == 200
    data = resp.json()

    assert "nodes" in data
    assert "edges" in data

    # Should have the user node
    node_ids = {n["id"] for n in data["nodes"]}
    assert "u_unknown_user" in node_ids

    # With no matching roles from mock, falls back to "public"
    assert "r_public" in node_ids

    # Should have at least one edge (public -> unknown_user)
    assert len(data["edges"]) >= 1


def test_role_users(client, auth_header):
    resp = client.get("/api/admin/roles/root/users", headers=auth_header)
    assert resp.status_code == 200
    data = resp.json()
    assert isinstance(data, list)
