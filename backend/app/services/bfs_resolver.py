"""BFS traversal helpers for resolving privilege inheritance through role graphs."""

from __future__ import annotations

import logging

from app.models.schemas import PrivilegeGrant
from app.services.grant_classifier import (
    ObjectQuery,
    Relevance,
    _deduplicate,
)
from app.services.starrocks_client import execute_query
from app.utils.role_helpers import get_parent_roles, get_user_roles

logger = logging.getLogger("privileges")


def _fetch_role_child_map(conn) -> dict[str, list[str]]:
    """Fetch sys.role_edges → {parent: [child_roles]}."""
    children_of: dict[str, list[str]] = {}
    try:
        rows = execute_query(
            conn, "SELECT FROM_ROLE, TO_ROLE FROM sys.role_edges WHERE TO_ROLE IS NOT NULL AND TO_ROLE != ''"
        )
        for e in rows:
            parent = e.get("FROM_ROLE") or ""
            child = e.get("TO_ROLE") or ""
            if parent and child:
                children_of.setdefault(parent, []).append(child)
    except Exception:
        logger.debug("Failed to query sys.role_edges")
    return children_of


def _bfs_child_roles(
    role_privs: dict[str, set[str]],
    children_of: dict[str, list[str]],
) -> dict[str, tuple[set[str], str]]:
    """BFS downward from privileged roles to find all inheriting child roles.
    Returns: {child_role: (inherited_privs, origin_seed_role)}"""
    result: dict[str, tuple[set[str], str]] = {}
    queue: list[tuple[str, str]] = [(r, r) for r in role_privs]
    visited: set[str] = set()
    while queue:
        role, origin = queue.pop(0)
        if role in visited:
            continue
        visited.add(role)
        privs = role_privs.get(role) or role_privs.get(origin, set())
        for child in children_of.get(role, []):
            if child in result:
                result[child][0].update(privs)
            else:
                result[child] = (set(privs), origin)
            if child not in visited:
                queue.append((child, origin))
    return result


def _bfs_user_privs(conn, user: str, role_privs: dict[str, set[str]]) -> dict[str, str]:
    """Check if user's roles intersect with role_privs. Returns {priv: source_role}."""
    user_roles = get_user_roles(conn, user)
    if not user_roles:
        return {}
    # Fast path: direct role check (covers most cases since role_privs already includes inherited roles)
    result: dict[str, str] = {}
    for role in user_roles:
        if role in role_privs:
            for priv in role_privs[role]:
                result.setdefault(priv, role)
    if result:
        return result
    # Slow path: BFS upward (only needed if user's direct roles aren't in role_privs)
    visited: set[str] = set()
    queue: list[tuple[str, str]] = [(r, r) for r in user_roles]
    while queue and len(visited) < 100:
        role, origin = queue.pop(0)
        if role in visited:
            continue
        visited.add(role)
        if role in role_privs:
            for priv in role_privs[role]:
                result.setdefault(priv, origin)
        queue.extend((p, origin) for p in get_parent_roles(conn, role))
    return result


def _finalize(classified: list[tuple[PrivilegeGrant, Relevance]], q: ObjectQuery) -> list[PrivilegeGrant]:
    """Convert IMPLICIT_USAGE grants + deduplicate."""
    results: list[PrivilegeGrant] = []
    usage_converted: set[str] = set()
    for grant, rel in classified:
        if rel == Relevance.IMPLICIT_USAGE:
            if grant.grantee not in usage_converted:
                usage_converted.add(grant.grantee)
                results.append(
                    PrivilegeGrant(
                        grantee=grant.grantee,
                        grantee_type=grant.grantee_type,
                        object_catalog=q.catalog,
                        object_database=q.database,
                        object_name=None,
                        object_type=q.type_upper,
                        privilege_type="USAGE",
                        is_grantable=False,
                        source=grant.source + " (implicit)",
                    )
                )
        else:
            results.append(grant)
    return _deduplicate(results)


def _find_ancestors_with_grants(conn, role: str, grants_map: dict[str, list]) -> list[str]:
    """Find ancestors of `role` that have matching grants (for intermediate role inheritance)."""
    found: list[str] = []
    visited: set[str] = {role}
    queue = list(get_parent_roles(conn, role))
    while queue:
        parent = queue.pop(0)
        if parent in visited:
            continue
        visited.add(parent)
        if parent in grants_map:
            found.append(parent)
        queue.extend(p for p in get_parent_roles(conn, parent) if p not in visited)
    return found
