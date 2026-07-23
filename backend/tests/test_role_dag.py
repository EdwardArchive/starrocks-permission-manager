"""Unit tests for the pure role-DAG assembly helpers (services/shared/role_dag.py).

These cover the upward ancestry BFS body that the router-level mocks never reach
(the default query map returns no parent roles), pinning the semantics that
hard-invariant #1 depends on: node de-dup + one inheritance edge per child.
"""
from __future__ import annotations

from app.services.shared.dag_builder import DAGBuilder
from app.services.shared.role_dag import add_role_ancestry, role_category


def test_role_category():
    assert role_category("root") == "root"
    assert role_category("db_admin") == "builtin"
    assert role_category("public") == "builtin"
    assert role_category("analyst_role") == "custom"


def _meta(role: str) -> dict:
    return {"highlight": False, "role_category": role_category(role)}


def test_ancestry_linear_chain():
    """seed a -> b -> c: two nodes, two inheritance edges, e{n} in append order."""
    parents = {"a": ["b"], "b": ["c"], "c": []}
    dag = DAGBuilder()
    add_role_ancestry(dag, ["a"], lambda r: parents.get(r, []), _meta)
    graph = dag.build()

    assert [n.id for n in graph.nodes] == ["r_b", "r_c"]  # seed 'a' is caller-owned, not re-added
    assert all(n.type == "role" for n in graph.nodes)
    assert graph.nodes[0].metadata == {"highlight": False, "role_category": "custom"}
    assert [(e.id, e.source, e.target, e.edge_type) for e in graph.edges] == [
        ("e0", "r_b", "r_a", "inheritance"),
        ("e1", "r_c", "r_b", "inheritance"),
    ]


def test_ancestry_diamond_dedup():
    """a -> {b,c}, b -> d, c -> d: node d de-duped once, but an inheritance edge
    per child (d->b and d->c), and edge ids never skip on the node-dedup."""
    parents = {"a": ["b", "c"], "b": ["d"], "c": ["d"], "d": []}
    dag = DAGBuilder()
    add_role_ancestry(dag, ["a"], lambda r: parents.get(r, []), _meta)
    graph = dag.build()

    assert [n.id for n in graph.nodes] == ["r_b", "r_c", "r_d"]  # r_d appears once
    edges = [(e.source, e.target) for e in graph.edges]
    assert edges == [("r_b", "r_a"), ("r_c", "r_a"), ("r_d", "r_b"), ("r_d", "r_c")]
    assert [e.id for e in graph.edges] == ["e0", "e1", "e2", "e3"]  # contiguous


def test_ancestry_no_parents_is_noop():
    parents: dict[str, list[str]] = {}
    dag = DAGBuilder()
    add_role_ancestry(dag, ["solo"], lambda r: parents.get(r, []), _meta)
    graph = dag.build()
    assert graph.nodes == []
    assert graph.edges == []


def test_ancestry_composes_on_prepopulated_builder():
    """Mirror the router: seed nodes + assignment edges already on the dag before
    add_role_ancestry runs. Pins the composition the golden diff can't reach --
    (1) ancestry edges continue the e{n} counter (start at e2, not e0), and
    (2) a parent equal to a pre-added direct role is de-duped, not re-appended.
    """
    dag = DAGBuilder()
    # Router-side prelude: user node + two direct-role nodes + two assignment edges.
    dag.add_node("u_alice", "alice", "user", metadata={"highlight": True})
    dag.add_node("r_role_a", "role_a", "role", metadata=_meta("role_a"))
    dag.add_edge("r_role_a", "u_alice", "assignment")  # e0
    dag.add_node("r_public", "public", "role", metadata=_meta("public"))
    dag.add_edge("r_public", "u_alice", "assignment")  # e1

    # role_a inherits public (already a direct role); public is a leaf.
    parents = {"role_a": ["public"], "public": []}
    add_role_ancestry(dag, ["role_a", "public"], lambda r: parents.get(r, []), _meta)
    graph = dag.build()

    # r_public added once (pre-added) — ancestry's add_node(r_public) is de-duped.
    assert [n.id for n in graph.nodes] == ["u_alice", "r_role_a", "r_public"]
    # The lone inheritance edge continues the counter at e2 (after e0/e1).
    inh = [e for e in graph.edges if e.edge_type == "inheritance"]
    assert len(inh) == 1
    assert (inh[0].id, inh[0].source, inh[0].target) == ("e2", "r_public", "r_role_a")
    assert [e.id for e in graph.edges] == ["e0", "e1", "e2"]  # contiguous, no reset
