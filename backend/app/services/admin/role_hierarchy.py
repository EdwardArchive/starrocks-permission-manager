"""Admin-tier role-hierarchy DAG assembly (Layer 2: ``sys.role_edges`` + ``SHOW ROLES``).

The user-tier counterpart (:func:`app.services.shared.role_dag.build_role_hierarchy_from_grants`)
walks roles via ``SHOW GRANTS``; this admin-tier builder reads the full graph from
``sys.role_edges`` and is therefore Layer 2. It is the shared body behind both
``routers/admin_roles.get_role_hierarchy`` and ``routers/admin_dag.get_role_hierarchy``
(dag_builder site 3: roles NOT deduped, users deduped, assignment edges deduped on
source/target).
"""

from __future__ import annotations

from app.models.schemas import DAGGraph
from app.services.admin.user_service import get_all_users
from app.services.shared.dag_builder import DAGBuilder
from app.services.shared.role_dag import role_category
from app.services.shared.row_utils import col
from app.services.starrocks_client import execute_query


def build_admin_role_hierarchy(conn) -> DAGGraph:
    """Build full role hierarchy DAG from sys.role_edges + SHOW ROLES (admin only)."""
    # Get all roles
    roles_rows = execute_query(conn, "SHOW ROLES")
    roles = []
    for r in roles_rows:
        name = col(r, "Name") or ""
        if name:
            roles.append(name)

    # Get all role edges from sys.role_edges
    edges_data = []
    edge_rows = execute_query(conn, "SELECT * FROM sys.role_edges")
    for e in edge_rows:
        parent = e.get("FROM_ROLE") or e.get("PARENT_ROLE_NAME") or ""
        child = e.get("TO_ROLE") or e.get("ROLE_NAME") or ""
        user = e.get("TO_USER") or e.get("USER_NAME") or ""
        if parent and (child or user):
            edges_data.append({"parent": parent, "child": child, "user": user})

    all_users = get_all_users(conn)
    for e in edges_data:
        if e["user"]:
            all_users.add(e["user"])

    user_roles: dict[str, set[str]] = {}
    for e in edges_data:
        if e["user"]:
            user_roles.setdefault(e["user"], set()).add(e["parent"])

    dag = DAGBuilder()
    # Role nodes append unconditionally (dedup=False), but still record their ids
    # so the user loop below de-dups against them.
    for role in roles:
        dag.add_node(f"r_{role}", role, "role", metadata={"role_category": role_category(role)}, dedup=False)
    for u in all_users:
        dag.add_node(f"u_{u}", u, "user")

    # One shared edge counter: inheritance edges (no dedup), then user-assignment
    # edges (deduped on source/target), then implicit-public assignments.
    for e in edges_data:
        if e["parent"] and e["child"]:
            dag.add_edge(f"r_{e['parent']}", f"r_{e['child']}", "inheritance")

    for e in edges_data:
        if e["user"] and e["parent"]:
            dag.add_edge(f"r_{e['parent']}", f"u_{e['user']}", "assignment", dedup=True)

    for u in all_users:
        if u not in user_roles and "public" in roles:
            dag.add_edge("r_public", f"u_{u}", "assignment", dedup=True)

    return dag.build()
