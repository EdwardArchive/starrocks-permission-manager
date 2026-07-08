"""Data-agnostic role-DAG assembly helpers built on :class:`DAGBuilder`.

The role-hierarchy endpoints in ``routers/user_roles.py`` and
``routers/admin_roles.py`` share the same *assembly* shape while differing in
their *data source*: the user tier walks roles via ``SHOW GRANTS`` and the admin
tier reads ``sys.role_edges``. This module owns the tier-agnostic assembly; the
routers keep their tier-specific fetching and metadata shaping.

Only the upward ancestry BFS shared verbatim by both ``get_inheritance_dag``
endpoints (dag_builder sites 4/5) is abstracted here. The mixed-dedup role
hierarchy (site 3) and the capped SHOW-GRANTS chain walk (site 6) are one-off
shapes and stay on direct :class:`DAGBuilder` calls in their routers -- a shared
helper for either would be contrived.
"""

from __future__ import annotations

from collections.abc import Callable

from app.services.shared.constants import BUILTIN_ROLES
from app.services.shared.dag_builder import DAGBuilder


def role_category(name: str) -> str:
    """Classify a role for node metadata: ``root`` / ``builtin`` / ``custom``."""
    return "root" if name == "root" else "builtin" if name in BUILTIN_ROLES else "custom"


def add_role_ancestry(
    dag: DAGBuilder,
    seed_roles: list[str],
    get_parents: Callable[[str], list[str]],
    node_metadata: Callable[[str], dict],
) -> None:
    """Upward BFS over parent roles, emitting deduped nodes + inheritance edges.

    For every parent ``p`` of a processed role ``current``, append a role node
    ``r_{p}`` (de-duplicated by :class:`DAGBuilder`) carrying ``node_metadata(p)``
    and an inheritance edge ``r_{p} -> r_{current}`` (NOT de-duplicated -- a
    parent reached through several children yields one edge per child). ``current``
    itself is never (re-)added here: its node/edge belongs to the caller.

    ``seed_roles`` are pre-marked visited and enqueued, so each role is processed
    exactly once regardless of how many children point at it. There is no depth
    cap -- termination is by the ``visited`` set -- which mirrors the two
    ``get_inheritance_dag`` upward traversals exactly. Metadata shaping (the
    ``{"highlight": ...}`` merge) stays with the caller via ``node_metadata``.
    """
    queue = list(seed_roles)
    visited: set[str] = set(seed_roles)
    while queue:
        current = queue.pop(0)
        for parent in get_parents(current):
            if parent not in visited:
                visited.add(parent)
                queue.append(parent)
            dag.add_node(f"r_{parent}", parent, "role", metadata=node_metadata(parent))
            dag.add_edge(f"r_{parent}", f"r_{current}", "inheritance")
