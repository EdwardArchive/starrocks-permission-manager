"""Layer 2 collector: sys.* tables + SHOW GRANTS supplementation.

Used for admin users who can access sys.grants_to_users/roles tables.
"""

from __future__ import annotations

import logging

from app.models.schemas import PrivilegeGrant
from app.services.common.show_grants_collector import _probe_public_defaults
from app.services.grant_collector import CollectedGrants
from app.services.common.grant_parser import _parse_show_grants, _row_to_grants
from app.services.shared.constants import BUILTIN_ROLES
from app.services.shared.name_utils import normalize_fn_name
from app.services.shared.role_graph import fetch_role_child_map
from app.services.starrocks_client import execute_query
from app.utils.role_helpers import build_role_chain

logger = logging.getLogger("privileges")


def collect_admin(conn, username: str) -> CollectedGrants:
    """Collect all grants visible to an admin user via sys.* tables."""
    grants: list[PrivilegeGrant] = []

    # 1. sys.grants_to_users + sys.grants_to_roles (ALL rows)
    for table, gtype in [("sys.grants_to_users", "USER"), ("sys.grants_to_roles", "ROLE")]:
        try:
            rows = execute_query(conn, f"SELECT * FROM {table}")
            for r in rows:
                grants.extend(_row_to_grants(r, gtype))
        except Exception:
            logger.debug("Failed to query %s", table)

    # 2. Supplement builtin roles not in sys tables via SHOW GRANTS
    found_roles = {g.grantee for g in grants if g.grantee_type == "ROLE"}
    for role in BUILTIN_ROLES - found_roles:
        try:
            grants.extend(_parse_show_grants(conn, role, "ROLE"))
        except Exception:
            logger.debug("Failed to get SHOW GRANTS for builtin role %s", role)

    # 3. Supplement users not in sys tables
    all_users = _get_all_users(conn)
    found_users = {g.grantee for g in grants if g.grantee_type == "USER"}
    for u in all_users - found_users:
        try:
            grants.extend(_parse_show_grants(conn, u, "USER"))
        except Exception:
            logger.debug("Failed to get SHOW GRANTS for user %s", u)

    # 4. Merge scope-level grants from SHOW GRANTS (sys expands wildcards)
    grants = _merge_show_grants_scope(conn, grants)

    # 4b. Add implicit public defaults (default_warehouse etc.)
    grants.extend(_probe_public_defaults(conn))

    # 5. Role hierarchy
    role_chain = build_role_chain(conn, username, include_public=True)
    role_child_map = fetch_role_child_map(conn)

    return CollectedGrants(
        grants=grants,
        user_role_chain=role_chain,
        role_child_map=role_child_map,
        all_users=all_users,
    )


def _get_all_users(conn) -> set[str]:
    from app.services.admin.user_service import get_all_users

    return get_all_users(conn)


def _merge_show_grants_scope(conn, sys_grants: list[PrivilegeGrant]) -> list[PrivilegeGrant]:
    """Supplement sys grants with scope-level SHOW GRANTS
    that sys tables don't contain (SYSTEM, STORAGE VOLUME, etc.)."""
    grantees = {(g.grantee, g.grantee_type) for g in sys_grants}
    _sys_covered_types = {"TABLE", "DATABASE", "CATALOG"}

    existing = {
        (g.grantee, g.object_type, normalize_fn_name(g.object_name or ""), g.privilege_type) for g in sys_grants
    }

    for grantee, gtype in grantees:
        try:
            show = _parse_show_grants(conn, grantee, gtype)
            for g in show:
                if g.object_type in _sys_covered_types and g.object_name:
                    continue
                key = (g.grantee, g.object_type, normalize_fn_name(g.object_name or ""), g.privilege_type)
                if key not in existing:
                    sys_grants.append(g)
                    existing.add(key)
        except Exception:
            logger.debug("SHOW GRANTS failed for builtin role %s", role)

    return sys_grants


def query_grants_merged(conn, grantee: str, grantee_type: str) -> list[PrivilegeGrant]:
    """Get grants for a single grantee. Merges sys + SHOW GRANTS.
    sys.grants_to_* expands wildcards; SHOW GRANTS captures scope-level grants."""
    table = "sys.grants_to_users" if grantee_type == "USER" else "sys.grants_to_roles"
    sys_grants: list[PrivilegeGrant] = []
    try:
        rows = execute_query(conn, f"SELECT * FROM {table} WHERE GRANTEE = %s", (grantee,))
        if rows:
            sys_grants = [g for r in rows for g in _row_to_grants(r, grantee_type)]
    except Exception:
        logger.debug("Query failed, skipping")

    if not sys_grants:
        return _parse_show_grants(conn, grantee, grantee_type)

    # Supplement with scope-level grants from SHOW GRANTS
    show_grants = _parse_show_grants(conn, grantee, grantee_type)
    _sys_covered_types = {"TABLE", "DATABASE", "CATALOG"}

    existing = {(g.object_type, normalize_fn_name(g.object_name or ""), g.privilege_type) for g in sys_grants}
    for g in show_grants:
        if g.object_type in _sys_covered_types and g.object_name:
            continue
        key = (g.object_type, normalize_fn_name(g.object_name or ""), g.privilege_type)
        if key not in existing:
            sys_grants.append(g)
            existing.add(key)
    return sys_grants
