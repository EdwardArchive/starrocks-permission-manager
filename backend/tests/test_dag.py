def test_object_hierarchy(client, auth_header):
    resp = client.get("/api/user/dag/object-hierarchy", headers=auth_header)
    assert resp.status_code == 200
    data = resp.json()

    assert "nodes" in data
    assert "edges" in data
    nodes = data["nodes"]
    edges = data["edges"]
    assert len(nodes) > 0
    assert len(edges) > 0

    # Should have SYSTEM node
    sys_nodes = [n for n in nodes if n["type"] == "system"]
    assert len(sys_nodes) == 1
    assert sys_nodes[0]["label"] == "SYSTEM"

    # Should have catalog nodes
    cat_nodes = [n for n in nodes if n["type"] == "catalog"]
    assert len(cat_nodes) >= 1

    # Should have group nodes
    group_nodes = [n for n in nodes if n.get("node_role") == "group"]
    assert len(group_nodes) >= 1

    # Edges should be hierarchy type
    for e in edges:
        assert e["edge_type"] == "hierarchy"


def test_object_hierarchy_filtered(client, auth_header):
    resp = client.get(
        "/api/user/dag/object-hierarchy",
        params={"catalog": "default_catalog"},
        headers=auth_header,
    )
    assert resp.status_code == 200
    data = resp.json()
    cat_nodes = [n for n in data["nodes"] if n["type"] == "catalog"]
    # Only default_catalog should appear
    assert len(cat_nodes) == 1
    assert cat_nodes[0]["label"] == "default_catalog"


def test_role_hierarchy(client, auth_header):
    resp = client.get("/api/admin/dag/role-hierarchy", headers=auth_header)
    assert resp.status_code == 200
    data = resp.json()

    nodes = data["nodes"]
    edges = data["edges"]
    assert len(nodes) > 0
    assert len(edges) > 0

    types = {n["type"] for n in nodes}
    assert "role" in types
    assert "user" in types

    edge_types = {e["edge_type"] for e in edges}
    assert "inheritance" in edge_types or "assignment" in edge_types


def test_dag_node_structure(client, auth_header):
    """Verify DAGNode schema compliance across all DAG endpoints."""
    for endpoint in [
        "/api/user/dag/object-hierarchy",
        "/api/admin/dag/role-hierarchy",
    ]:
        resp = client.get(endpoint, headers=auth_header)
        assert resp.status_code == 200
        data = resp.json()
        for node in data["nodes"]:
            assert "id" in node
            assert "label" in node
            assert "type" in node
        for edge in data["edges"]:
            assert "id" in edge
            assert "source" in edge
            assert "target" in edge
            assert "edge_type" in edge
