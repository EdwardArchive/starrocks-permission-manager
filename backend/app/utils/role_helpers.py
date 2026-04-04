"""Shared helpers for role/user discovery with sys.role_edges → SHOW GRANTS fallback."""

from __future__ import annotations

import logging
import re

from app.services.starrocks_client import execute_query
from app.utils.sql_safety import safe_name

logger = logging.getLogger(__name__)


def get_user_roles(conn, username: str) -> list[str]:
    """Get roles assigned to a user. Tries sys.role_edges first, falls back to SHOW GRANTS."""
    roles: list[str] = []
    try:
        rows = execute_query(conn, "SELECT FROM_ROLE FROM sys.role_edges WHERE TO_USER = %s", (username,))
        for r in rows:
            role = r.get("FROM_ROLE") or r.get("ROLE_NAME")
            if role:
                roles.append(role)
    except Exception:
        logger.debug("sys.role_edges failed for user %s, falling back to SHOW GRANTS", username)
    if not roles:
        roles = parse_role_assignments(conn, username, "USER")
    return roles


def get_parent_roles(conn, role_name: str) -> list[str]:
    """Get parent roles inherited by a role. Tries sys.role_edges first, falls back to SHOW GRANTS."""
    parents: list[str] = []
    try:
        rows = execute_query(
            conn,
            "SELECT FROM_ROLE FROM sys.role_edges WHERE TO_ROLE = %s",
            (role_name,),
        )
        for r in rows:
            p = r.get("FROM_ROLE") or r.get("PARENT_ROLE_NAME")
            if p:
                parents.append(p)
    except Exception:
        logger.debug("sys.role_edges failed for role %s, falling back to SHOW GRANTS", role_name)
    if not parents:
        parents = parse_role_assignments(conn, role_name, "ROLE")
    return parents


def parse_role_assignments(conn, grantee: str, grantee_type: str) -> list[str]:
    """Extract role names from SHOW GRANTS output (handles comma-separated roles)."""
    roles: list[str] = []
    try:
        if grantee_type == "USER":
            rows = execute_query(conn, f"SHOW GRANTS FOR '{safe_name(grantee)}'")
        else:
            rows = execute_query(conn, f"SHOW GRANTS FOR ROLE '{safe_name(grantee)}'")
        for row in rows:
            for val in row.values():
                s = str(val)
                if s.upper().startswith("GRANT") and " ON " not in s.upper():
                    for role_name in re.findall(r"'([^']+)'", s.split(" TO ")[0]):
                        if role_name not in roles:
                            roles.append(role_name)
    except Exception:
        logger.debug("Failed to parse role assignments for %s %s", grantee_type, grantee)
    return roles


def build_role_chain(conn, username: str, include_public: bool = True) -> dict[str, str]:
    """BFS upward through user's role chain. Returns {role: origin_role}.

    Consolidates the 3 duplicated BFS patterns:
    - privileges.py get_user_effective_privileges
    - privileges.py _object_privs_via_grants
    - my_permissions.py get_my_permissions

    Args:
        conn: StarRocks DB connection
        username: user to resolve roles for
        include_public: auto-include 'public' (all users have it implicitly)

    Returns:
        dict mapping each role to the direct role it was discovered through
        (the "origin" role for source attribution).
    """
    direct_roles = get_user_roles(conn, username)
    if include_public and "public" not in direct_roles:
        direct_roles.append("public")

    role_origin: dict[str, str] = {}
    visited: set[str] = set()
    queue: list[tuple[str, str]] = [(r, r) for r in direct_roles]

    while queue and len(visited) < 100:
        role, origin = queue.pop(0)
        if role in visited:
            continue
        visited.add(role)
        role_origin[role] = origin
        for parent in get_parent_roles(conn, role):
            if parent not in visited:
                queue.append((parent, origin))

    return role_origin


def collect_all_roles_via_grants(conn, username: str) -> set[str]:
    """BFS through role chain. Returns set of all role names.
    Convenience wrapper around build_role_chain().
    """
    return set(build_role_chain(conn, username, include_public=True).keys())
