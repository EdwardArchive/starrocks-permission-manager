"""Role-DAG assembly for the user (Layer-1, ``SHOW GRANTS``) tier.

The role-hierarchy endpoints in ``routers/user_roles.py`` and
``routers/admin_roles.py`` share the same *assembly* shape while differing in
their *data source*: the user tier walks roles via ``SHOW GRANTS`` and the admin
tier reads ``sys.role_edges``. This module owns the Layer-1 assembly:

  * :func:`role_category` -- node-metadata classifier shared by both tiers.
  * :func:`add_role_ancestry` -- the upward ancestry BFS shared verbatim by both
    ``get_inheritance_dag`` endpoints (dag_builder sites 4/5).
  * :func:`build_role_hierarchy_from_grants` -- the user-tier role-hierarchy DAG
    (dag_builder site 6, the capped ``SHOW GRANTS`` chain walk).

The admin-tier mixed-dedup role hierarchy (site 3) reads ``sys.role_edges`` and
so lives in ``services/admin/role_hierarchy.py`` instead of here.
"""

from __future__ import annotations

from collections.abc import Callable

from app.models.schemas import DAGGraph
from app.services.shared.constants import BFS_MAX_DEPTH, BUILTIN_ROLES
from app.services.shared.dag_builder import DAGBuilder
from app.utils.role_helpers import parse_role_assignments


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


def build_role_hierarchy_from_grants(conn, username: str) -> DAGGraph:
    """Build role hierarchy DAG for non-admin using only SHOW GRANTS."""
    dag = DAGBuilder()

    # User node
    dag.add_node(f"u_{username}", username, "user")

    # BFS through role chain
    direct_roles = parse_role_assignments(conn, username, "USER")
    # Every user implicitly has 'public' — SHOW GRANTS omits it but it should appear in the DAG
    if "public" not in direct_roles:
        direct_roles = [*direct_roles, "public"]
    for role in direct_roles:
        dag.add_node(f"r_{role}", role, "role", metadata={"role_category": role_category(role)})
        dag.add_edge(f"r_{role}", f"u_{username}", "assignment")

    visited: set[str] = set()
    queue = list(direct_roles)
    while queue and len(visited) < BFS_MAX_DEPTH:
        role = queue.pop(0)
        if role in visited:
            continue
        visited.add(role)
        parent_roles = parse_role_assignments(conn, role, "ROLE")
        for parent in parent_roles:
            if parent not in visited:
                queue.append(parent)
            dag.add_node(f"r_{parent}", parent, "role", metadata={"role_category": role_category(parent)})
            dag.add_edge(f"r_{parent}", f"r_{role}", "inheritance")

    return dag.build()
