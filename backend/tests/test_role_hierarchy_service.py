"""Unit pins for the extracted role-hierarchy builders.

The router→router lazy imports were removed by moving the two role-hierarchy
bodies into tier-correct services:

  * ``services/shared/role_dag.build_role_hierarchy_from_grants`` (user tier,
    ``SHOW GRANTS``) — shared by ``user_roles`` and ``user_dag``.
  * ``services/admin/role_hierarchy.build_admin_role_hierarchy`` (admin tier,
    ``sys.role_edges``) — shared by ``admin_roles`` and ``admin_dag``.

The router endpoints only ever feed these single-role / already-assigned mocks,
so the builders' inner branches (the SHOW-GRANTS parent BFS + revisit skip, and
the implicit-``public`` assignment) are pinned here directly.
"""

from __future__ import annotations

from app.services.admin.role_hierarchy import build_admin_role_hierarchy
from app.services.shared.role_dag import build_role_hierarchy_from_grants
from app.utils.cache import clear_all_caches

from tests.conftest import FakeConnection


def test_build_role_hierarchy_from_grants_diamond():
    """Diamond alice -> {b, c} -> d: parent BFS runs and the shared parent d is
    visited once, exercising the ``for parent`` block and the revisit ``continue``."""
    qmap = {
        "SHOW GRANTS FOR 'alice'": [{"Grants": "GRANT 'b', 'c' TO 'alice'@'%'"}],
        "SHOW GRANTS FOR ROLE 'b'": [{"Grants": "GRANT 'd' TO ROLE 'b'"}],
        "SHOW GRANTS FOR ROLE 'c'": [{"Grants": "GRANT 'd' TO ROLE 'c'"}],
        "SHOW GRANTS FOR ROLE 'd'": [],
        "SHOW GRANTS FOR ROLE 'public'": [],
        "SHOW GRANTS FOR": [],
    }
    graph = build_role_hierarchy_from_grants(FakeConnection(qmap), "alice")

    node_ids = {n.id for n in graph.nodes}
    assert node_ids == {"u_alice", "r_b", "r_c", "r_public", "r_d"}
    # r_d appears exactly once despite being reached through both b and c.
    assert [n.id for n in graph.nodes].count("r_d") == 1

    inheritance = {(e.source, e.target) for e in graph.edges if e.edge_type == "inheritance"}
    assert inheritance == {("r_d", "r_b"), ("r_d", "r_c")}
    assignments = {(e.source, e.target) for e in graph.edges if e.edge_type == "assignment"}
    assert assignments == {("r_b", "u_alice"), ("r_c", "u_alice"), ("r_public", "u_alice")}


def test_build_admin_role_hierarchy_implicit_public():
    """A user known via get_all_users but with no role edge gets an implicit
    ``public`` assignment edge."""
    clear_all_caches()  # get_all_users caches globally ("all_users")
    qmap = {
        "SHOW ROLES": [{"Name": "public"}, {"Name": "db_admin"}],
        "SELECT DISTINCT TO_USER FROM sys.role_edges": [{"TO_USER": "lonely_user"}],
        "SELECT DISTINCT GRANTEE FROM sys.grants_to_users": [],
        "SELECT * FROM sys.role_edges": [],
    }
    graph = build_admin_role_hierarchy(FakeConnection(qmap))

    assert ("r_public", "u_lonely_user") in {(e.source, e.target) for e in graph.edges if e.edge_type == "assignment"}
    clear_all_caches()  # don't leak the mutated user set into other tests


def test_admin_role_hierarchy_endpoint_caches(client, auth_header):
    """The extracted admin builder is still fronted by the router TTL cache:
    a repeat request is served from cache and returns byte-identical JSON."""
    r1 = client.get("/api/admin/roles/hierarchy", headers=auth_header)
    assert r1.status_code == 200
    r2 = client.get("/api/admin/roles/hierarchy", headers=auth_header)
    assert r2.status_code == 200
    assert r2.json() == r1.json()
