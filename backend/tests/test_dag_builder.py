"""Unit tests for the shared DAGBuilder.

Covers node dedup, edge id sequencing/format, the edge dedup switch (skip must
not consume an id), metadata/node_role passthrough, empty build, and two
"site parity" tests that reproduce how current router sites build a mini graph
and assert identical output structure.
"""

from __future__ import annotations

from app.models.schemas import DAGEdge, DAGGraph, DAGNode
from app.services.shared.dag_builder import DAGBuilder


class TestAddNode:
    def test_appends_and_returns_true(self):
        b = DAGBuilder()
        assert b.add_node("n1", "Node 1", "role") is True
        graph = b.build()
        assert len(graph.nodes) == 1
        node = graph.nodes[0]
        assert isinstance(node, DAGNode)
        assert (node.id, node.label, node.type) == ("n1", "Node 1", "role")
        # Faithful to every current site: color defaults to None.
        assert node.color is None

    def test_dedup_true_skips_duplicate_id_and_returns_false(self):
        b = DAGBuilder()
        assert b.add_node("n1", "First", "role") is True
        assert b.add_node("n1", "Second", "role") is False
        graph = b.build()
        assert len(graph.nodes) == 1
        # The first insertion wins; the duplicate is dropped, label unchanged.
        assert graph.nodes[0].label == "First"

    def test_dedup_false_allows_duplicate_ids(self):
        # Sites 1/2 (object hierarchy) never dedup — duplicate ids are appended.
        b = DAGBuilder()
        assert b.add_node("o1", "A", "table", dedup=False) is True
        assert b.add_node("o1", "B", "view", dedup=False) is True
        graph = b.build()
        assert [n.id for n in graph.nodes] == ["o1", "o1"]
        assert [n.label for n in graph.nodes] == ["A", "B"]

    def test_dedup_false_still_records_id_for_later_dedup(self):
        # Contract mirrored from admin_roles.get_role_hierarchy: role nodes append
        # with dedup=False but still populate the id set, so a later dedup=True
        # (user) node with the same id would be skipped.
        b = DAGBuilder()
        assert b.add_node("x", "role node", "role", dedup=False) is True
        assert b.add_node("x", "dup", "user", dedup=True) is False
        assert len(b.build().nodes) == 1

    def test_metadata_passthrough_dict(self):
        b = DAGBuilder()
        meta = {"role_category": "custom", "highlight": True}
        b.add_node("r1", "r1", "role", metadata=meta)
        assert b.build().nodes[0].metadata == {"role_category": "custom", "highlight": True}

    def test_metadata_defaults_none(self):
        b = DAGBuilder()
        b.add_node("u1", "u1", "user")
        assert b.build().nodes[0].metadata is None

    def test_node_role_passthrough(self):
        # Group nodes in the object hierarchy carry node_role="group".
        b = DAGBuilder()
        b.add_node("g1", "Tables (3)", "table", node_role="group", dedup=False)
        assert b.build().nodes[0].node_role == "group"

    def test_node_role_defaults_none(self):
        b = DAGBuilder()
        b.add_node("n1", "n1", "role")
        assert b.build().nodes[0].node_role is None


class TestAddEdge:
    def test_edge_id_sequence_and_format(self):
        b = DAGBuilder()
        b.add_edge("a", "b", "hierarchy")
        b.add_edge("b", "c", "hierarchy")
        b.add_edge("c", "d", "hierarchy")
        edges = b.build().edges
        assert [e.id for e in edges] == ["e0", "e1", "e2"]
        assert isinstance(edges[0], DAGEdge)
        assert (edges[0].source, edges[0].target, edges[0].edge_type) == ("a", "b", "hierarchy")

    def test_default_is_no_dedup(self):
        # No dedup by default: identical edges are appended twice.
        b = DAGBuilder()
        assert b.add_edge("a", "b", "inheritance") is True
        assert b.add_edge("a", "b", "inheritance") is True
        assert [e.id for e in b.build().edges] == ["e0", "e1"]

    def test_dedup_skip_does_not_consume_an_id(self):
        # The highest-risk behavior: a skipped dedup edge must not advance the
        # counter, so ids stay dense (e0, e1 — never e0, e2).
        b = DAGBuilder()
        assert b.add_edge("A", "B", "assignment", dedup=True) is True
        assert b.add_edge("A", "B", "assignment", dedup=True) is False
        assert b.add_edge("A", "C", "assignment", dedup=True) is True
        edges = b.build().edges
        assert [e.id for e in edges] == ["e0", "e1"]
        assert [(e.source, e.target) for e in edges] == [("A", "B"), ("A", "C")]

    def test_dedup_key_is_source_target_ignoring_edge_type(self):
        b = DAGBuilder()
        assert b.add_edge("A", "B", "assignment", dedup=True) is True
        # Same (source, target), different edge_type → still a duplicate.
        assert b.add_edge("A", "B", "inheritance", dedup=True) is False
        assert len(b.build().edges) == 1

    def test_non_dedup_edge_does_not_populate_key_set(self):
        # Forward-looking contract: a dedup=False edge neither records nor blocks
        # a later matching pair. Both survive.
        b = DAGBuilder()
        assert b.add_edge("X", "Y", "hierarchy", dedup=False) is True
        assert b.add_edge("X", "Y", "assignment", dedup=True) is True
        assert [e.id for e in b.build().edges] == ["e0", "e1"]

    def test_dedup_and_non_dedup_share_one_counter(self):
        b = DAGBuilder()
        b.add_edge("a", "b", "inheritance")  # e0, no dedup
        b.add_edge("r", "u", "assignment", dedup=True)  # e1, dedup
        b.add_edge("c", "d", "inheritance")  # e2, no dedup
        assert [e.id for e in b.build().edges] == ["e0", "e1", "e2"]


class TestBuild:
    def test_empty_build(self):
        graph = DAGBuilder().build()
        assert isinstance(graph, DAGGraph)
        assert graph.nodes == []
        assert graph.edges == []

    def test_build_returns_model_instances(self):
        b = DAGBuilder()
        b.add_node("n1", "n1", "role")
        b.add_edge("n1", "n2", "inheritance")
        graph = b.build()
        assert isinstance(graph, DAGGraph)
        assert all(isinstance(n, DAGNode) for n in graph.nodes)
        assert all(isinstance(e, DAGEdge) for e in graph.edges)


class TestSiteParity:
    """Reproduce how current router sites assemble a mini graph, then assert the
    built DAGGraph is byte-for-byte what the hand-written site would emit."""

    def test_site3_role_hierarchy_parity(self):
        """admin_roles.get_role_hierarchy — the only site with mixed semantics:
        roles append without dedup, users dedup, and inheritance-then-assignment
        edges share one counter while only assignment edges dedup.
        """
        roles = ["root", "db_admin", "public"]
        # kim: assigned db_admin AND public (public appears twice → dedup path).
        # lee: no roles → implicit public assignment.
        edges_data = [
            {"parent": "root", "child": "db_admin", "user": ""},
            {"parent": "db_admin", "child": "", "user": "kim"},
            {"parent": "db_admin", "child": "", "user": "kim"},  # duplicate → deduped
            {"parent": "public", "child": "", "user": "kim"},
        ]
        all_users = ["kim", "lee"]
        user_roles = {"kim": {"db_admin", "public"}}
        builtin = {"root", "public"}

        # ---- Build via DAGBuilder, following site-3 control flow verbatim ----
        b = DAGBuilder()
        for role in roles:
            rc = "root" if role == "root" else "builtin" if role in builtin else "custom"
            b.add_node(f"r_{role}", role, "role", metadata={"role_category": rc}, dedup=False)
        for u in all_users:
            b.add_node(f"u_{u}", u, "user", dedup=True)
        for e in edges_data:
            if e["parent"] and e["child"]:
                b.add_edge(f"r_{e['parent']}", f"r_{e['child']}", "inheritance")
        for e in edges_data:
            if e["user"] and e["parent"]:
                b.add_edge(f"r_{e['parent']}", f"u_{e['user']}", "assignment", dedup=True)
        for u in all_users:
            if u not in user_roles and "public" in roles:
                b.add_edge("r_public", f"u_{u}", "assignment", dedup=True)
        built = b.build()

        # ---- Hand-construct the exact graph the original site emits ----
        expected_nodes = [
            DAGNode(id="r_root", label="root", type="role", color=None, metadata={"role_category": "root"}),
            DAGNode(id="r_db_admin", label="db_admin", type="role", color=None, metadata={"role_category": "custom"}),
            DAGNode(id="r_public", label="public", type="role", color=None, metadata={"role_category": "builtin"}),
            DAGNode(id="u_kim", label="kim", type="user", color=None),
            DAGNode(id="u_lee", label="lee", type="user", color=None),
        ]
        expected_edges = [
            DAGEdge(id="e0", source="r_root", target="r_db_admin", edge_type="inheritance"),
            DAGEdge(id="e1", source="r_db_admin", target="u_kim", edge_type="assignment"),
            DAGEdge(id="e2", source="r_public", target="u_kim", edge_type="assignment"),
            DAGEdge(id="e3", source="r_public", target="u_lee", edge_type="assignment"),
        ]
        assert built == DAGGraph(nodes=expected_nodes, edges=expected_edges)

    def test_site1_object_hierarchy_parity(self):
        """user_dag/admin_dag.get_object_hierarchy — the opposite extreme:
        nodes never dedup and group nodes carry node_role="group".
        """
        b = DAGBuilder()

        def _add(nid, label, ntype, catalog=None, database=None, **kw):
            meta = {}
            if catalog:
                meta["catalog"] = catalog
            if database:
                meta["database"] = database
            b.add_node(nid, label, ntype, metadata=meta or None, dedup=False, **kw)

        def _edge(src, tgt, etype="hierarchy"):
            b.add_edge(src, tgt, etype)

        _add("sys", "SYSTEM", "system")
        _add("c_default", "default", "catalog", catalog="default")
        _edge("sys", "c_default")
        _add("d_default_sales", "sales", "database", catalog="default", database="sales")
        _edge("c_default", "d_default_sales")
        _add("g_default_sales_table", "Tables (1)", "table", catalog="default", database="sales", node_role="group")
        _edge("d_default_sales", "g_default_sales_table")
        _add("o_default_sales_orders", "orders", "table", catalog="default", database="sales")
        _edge("g_default_sales_table", "o_default_sales_orders")
        built = b.build()

        expected_nodes = [
            DAGNode(id="sys", label="SYSTEM", type="system", color=None, metadata=None),
            DAGNode(id="c_default", label="default", type="catalog", color=None, metadata={"catalog": "default"}),
            DAGNode(
                id="d_default_sales",
                label="sales",
                type="database",
                color=None,
                metadata={"catalog": "default", "database": "sales"},
            ),
            DAGNode(
                id="g_default_sales_table",
                label="Tables (1)",
                type="table",
                color=None,
                node_role="group",
                metadata={"catalog": "default", "database": "sales"},
            ),
            DAGNode(
                id="o_default_sales_orders",
                label="orders",
                type="table",
                color=None,
                metadata={"catalog": "default", "database": "sales"},
            ),
        ]
        expected_edges = [
            DAGEdge(id="e0", source="sys", target="c_default", edge_type="hierarchy"),
            DAGEdge(id="e1", source="c_default", target="d_default_sales", edge_type="hierarchy"),
            DAGEdge(id="e2", source="d_default_sales", target="g_default_sales_table", edge_type="hierarchy"),
            DAGEdge(id="e3", source="g_default_sales_table", target="o_default_sales_orders", edge_type="hierarchy"),
        ]
        assert built == DAGGraph(nodes=expected_nodes, edges=expected_edges)
