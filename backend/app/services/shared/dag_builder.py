"""Shared DAG builder for router node/edge assembly.

Collapses the duplicated idiom -- ``nodes``/``edges`` lists + a ``node_ids``
dedup set + an ``edge_idx`` counter + nested ``add_node``/``add_edge`` closures --
that is currently re-implemented across six DAG-building sites. Each site can be
mechanically rewritten onto this builder with zero behavior change:

  1. routers/user_dag.py::get_object_hierarchy                  (nodes NOT deduped; node_role="group")
  2. routers/admin_dag.py::get_object_hierarchy                 (identical to #1)
  3. routers/admin_roles.py::get_role_hierarchy                 (roles NOT deduped, users deduped;
                                                                 assignment edges deduped on source/target)
  4. routers/admin_roles.py::get_inheritance_dag                (nodes deduped; edges NOT deduped)
  5. routers/user_roles.py::get_inheritance_dag                 (identical to #4)
  6. routers/user_roles.py::_build_role_hierarchy_from_grants   (nodes deduped; edges NOT deduped)

The builder owns only the bookkeeping. Metadata *shaping* stays in each router:
sites 4/5 merge ``{"highlight": ...}`` with per-node extras, sites 1/2 derive
``catalog``/``database`` keys -- the caller builds that dict and hands it in as
``metadata``. The builder stores whatever it is given.
"""

from __future__ import annotations

from app.models.schemas import DAGEdge, DAGGraph, DAGNode


class DAGBuilder:
    """Accumulates DAG nodes and edges, then emits a :class:`DAGGraph`.

    Node ids are de-duplicated by default (the common case: 4 of 6 sites, plus
    the user nodes in :func:`admin_roles.get_role_hierarchy`). Edge ids
    auto-increment as ``e0``, ``e1``, ``e2`` ... in append order and are NOT
    de-duplicated by default (only the assignment edges in
    :func:`admin_roles.get_role_hierarchy` opt in). Per-call ``dedup`` switches
    reproduce each site's exact semantics.
    """

    def __init__(self) -> None:
        self._nodes: list[DAGNode] = []
        self._edges: list[DAGEdge] = []
        self._node_ids: set[str] = set()
        self._edge_keys: set[tuple[str, str]] = set()
        self._edge_idx: int = 0

    def add_node(
        self,
        id: str,
        label: str,
        type: str,
        *,
        metadata: dict | None = None,
        node_role: str | None = None,
        dedup: bool = True,
    ) -> bool:
        """Append a :class:`DAGNode`; return True if appended, False if skipped.

        With ``dedup=True`` (default) a node whose ``id`` was already recorded is
        skipped and ``False`` is returned. With ``dedup=False`` the node is always
        appended -- but its ``id`` is still recorded, so a later ``dedup=True``
        call sees it. That mirrors :func:`admin_roles.get_role_hierarchy`, where
        role nodes append unconditionally yet still populate ``node_ids`` so the
        subsequent user loop can dedup against them.
        """
        if dedup and id in self._node_ids:
            return False
        self._nodes.append(DAGNode(id=id, label=label, type=type, color=None, node_role=node_role, metadata=metadata))
        self._node_ids.add(id)
        return True

    def add_edge(self, source: str, target: str, edge_type: str, *, dedup: bool = False) -> bool:
        """Append a :class:`DAGEdge` with an auto-incrementing ``e{n}`` id.

        Return True if appended, False if skipped as a duplicate. The id counter
        advances only on an actual append, so a skipped edge never consumes an id
        (matching :func:`admin_roles.get_role_hierarchy`, where ``edge_idx += 1``
        lives inside the "not already added" guard).

        With ``dedup=True`` an edge whose ``(source, target)`` pair was already
        added *with dedup* is skipped. Only ``dedup=True`` edges populate and
        consult the dedup set -- ``dedup=False`` edges neither record nor block a
        later pair -- which mirrors that site's ``added_user_edges`` tracking only
        the assignment edges. ``edge_type`` is not part of the dedup key.
        """
        if dedup and (source, target) in self._edge_keys:
            return False
        self._edges.append(DAGEdge(id=f"e{self._edge_idx}", source=source, target=target, edge_type=edge_type))
        self._edge_idx += 1
        if dedup:
            self._edge_keys.add((source, target))
        return True

    def build(self) -> DAGGraph:
        """Emit the accumulated nodes and edges as a :class:`DAGGraph`."""
        return DAGGraph(nodes=self._nodes, edges=self._edges)
