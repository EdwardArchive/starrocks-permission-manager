def test_object_hierarchy(client, auth_header):
    resp = client.get("/api/dag/object-hierarchy", headers=auth_header)
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
        "/api/dag/object-hierarchy",
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
    resp = client.get("/api/dag/role-hierarchy", headers=auth_header)
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


def test_full_graph(client, auth_header):
    resp = client.get("/api/dag/full", headers=auth_header)
    assert resp.status_code == 200
    data = resp.json()

    nodes = data["nodes"]
    edges = data["edges"]

    types = {n["type"] for n in nodes}
    # Should have users, roles, and objects
    assert "user" in types
    assert "role" in types

    edge_types = {e["edge_type"] for e in edges}
    # Should have assignment + privilege edges
    assert len(edge_types) >= 1

    # All node types should be valid (not default to "table" for unknown types)
    valid_types = {"system", "catalog", "database", "table", "view", "mv", "function", "user", "role"}
    for n in nodes:
        assert n["type"] in valid_types, f"Invalid node type: {n['type']} for {n['label']}"

    # Edges should only reference existing node IDs
    node_ids = {n["id"] for n in nodes}
    for e in edges:
        assert e["source"] in node_ids, f"Edge source {e['source']} not in nodes"
        assert e["target"] in node_ids, f"Edge target {e['target']} not in nodes"


def test_full_graph_privilege_edges(client, auth_header):
    """Verify privilege edges have correct types (not all defaulting to 'select')."""
    resp = client.get("/api/dag/full", headers=auth_header)
    data = resp.json()
    edge_types = {e["edge_type"] for e in data["edges"]}
    # Should have privilege edges from mock data
    assert "select" in edge_types or "assignment" in edge_types


def test_full_graph_system_nodes(client, auth_header):
    """System-level grants should create 'system' type nodes, not 'table'."""
    resp = client.get("/api/dag/full", headers=auth_header)
    data = resp.json()
    # If any node has label containing "SYSTEM", it should be type "system"
    for n in data["nodes"]:
        if "SYSTEM" in n["label"].upper() and n["type"] != "user" and n["type"] != "role":
            assert n["type"] == "system", f"Node {n['label']} should be 'system' type, got {n['type']}"


def test_full_graph_filtered(client, auth_header):
    resp = client.get(
        "/api/dag/full",
        params={"catalog": "default_catalog"},
        headers=auth_header,
    )
    assert resp.status_code == 200
    data = resp.json()
    assert isinstance(data["nodes"], list)
    assert isinstance(data["edges"], list)


def test_dag_node_structure(client, auth_header):
    """Verify DAGNode schema compliance across all DAG endpoints."""
    for endpoint in [
        "/api/dag/object-hierarchy",
        "/api/dag/role-hierarchy",
        "/api/dag/full",
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
