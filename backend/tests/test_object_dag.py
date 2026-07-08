"""Tests for the shared object-hierarchy service and the DAG router delegators.

`services/common/object_dag.build_object_hierarchy` is the single implementation
that `user_dag`/`admin_dag` collapsed onto; the object-hierarchy route behaviour
itself is pinned by test_dag.py / test_admin_dag_routes.py. Here we unit-pin the
extracted helper directly (shallow path + the parallel SHOW FUNCTIONS seam) and
cover the user role-hierarchy route (build-via-service + caching), whose only
other exercise is the skipped HTTP smoke test.
"""

from __future__ import annotations

from app.models.schemas import DAGGraph, DAGNode
from app.services.common.object_dag import build_object_hierarchy
from tests.conftest import DEFAULT_QUERY_MAP, FakeConnection


def test_build_object_hierarchy_shallow():
    """depth='shallow' skips the object-loading block (no parallel fan-out)."""
    conn = FakeConnection(dict(DEFAULT_QUERY_MAP))
    graph = build_object_hierarchy(conn, {}, "default_catalog", "shallow")

    types = {n.type for n in graph.nodes}
    assert {"system", "catalog", "database"} <= types
    # Shallow → only catalogs + DBs, so no grouping nodes and no object leaves.
    assert all(n.node_role != "group" for n in graph.nodes)
    # Only default_catalog is enumerated (the filter arg).
    assert [n.label for n in graph.nodes if n.type == "catalog"] == ["default_catalog"]
    assert graph.edges  # sys->catalog and catalog->db edges


def test_build_object_hierarchy_loads_functions(monkeypatch):
    """depth='full' fans out SHOW FUNCTIONS via starrocks_client.parallel_queries.

    Pins the module-attr seam: object_dag must call parallel_queries through the
    starrocks_client module so a monkeypatch on the source attr reaches it.
    """
    monkeypatch.setattr(
        "app.services.starrocks_client.parallel_queries",
        lambda credentials, tasks, **kw: {"analytics_db": ["parse_ua(VARCHAR)"]},
    )
    conn = FakeConnection(dict(DEFAULT_QUERY_MAP))
    creds = {"host": "h", "port": 9030, "username": "u", "password": "p"}
    graph = build_object_hierarchy(conn, creds, "default_catalog", "full")

    fn_nodes = [n for n in graph.nodes if n.type == "function"]
    assert any(n.label == "parse_ua(VARCHAR)" for n in fn_nodes)
    assert any(n.node_role == "group" and n.label == "Functions (1)" for n in graph.nodes)


def test_user_role_hierarchy_builds_and_caches(client, auth_header, monkeypatch):
    """user_dag /role-hierarchy builds via the shared service and caches the result."""
    calls = []

    def _stub(conn, username):
        calls.append(1)
        return DAGGraph(nodes=[DAGNode(id="r_x", label="x", type="role")], edges=[])

    monkeypatch.setattr("app.routers.user_dag.build_role_hierarchy_from_grants", _stub)

    r1 = client.get("/api/user/dag/role-hierarchy", headers=auth_header)
    assert r1.status_code == 200
    assert r1.json()["nodes"][0]["id"] == "r_x"

    r2 = client.get("/api/user/dag/role-hierarchy", headers=auth_header)
    assert r2.json() == r1.json()
    assert calls == [1]  # second request served from cache; stub not re-invoked
