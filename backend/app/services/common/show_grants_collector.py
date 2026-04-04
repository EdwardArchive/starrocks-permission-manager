"""Layer 1 collector: SHOW GRANTS only (no sys.* tables).

Used for non-admin users who cannot access sys.grants_to_* tables.
"""

from __future__ import annotations

import logging

from app.models.schemas import PrivilegeGrant
from app.services.grant_collector import CollectedGrants
from app.services.common.grant_parser import _parse_show_grants
from app.services.shared.role_graph import fetch_role_child_map
from app.services.starrocks_client import execute_query
from app.utils.role_helpers import build_role_chain
from app.utils.sql_safety import safe_identifier

logger = logging.getLogger("privileges")


def collect_non_admin(conn, username: str) -> CollectedGrants:
    """Collect grants for a non-admin user using only SHOW GRANTS."""
    grants: list[PrivilegeGrant] = []

    # 1. User's direct grants (SHOW GRANTS only)
    grants.extend(_parse_show_grants(conn, username, "USER"))

    # 2. BFS role chain (including public)
    role_chain = build_role_chain(conn, username, include_public=True)

    # 3. Each role's grants
    public_empty = False
    for role in role_chain:
        role_grants = _parse_show_grants(conn, role, "ROLE")
        if role == "public" and not role_grants:
            public_empty = True
        grants.extend(role_grants)

    # 4. Public fallback: probe storage volumes
    if public_empty:
        grants.extend(_probe_public_defaults(conn))

    # 5. Role child map (try sys, silently fail for non-admin)
    role_child_map = fetch_role_child_map(conn)

    return CollectedGrants(
        grants=grants,
        user_role_chain=role_chain,
        role_child_map=role_child_map,
        all_users=set(),
    )


def _probe_public_defaults(conn) -> list[PrivilegeGrant]:
    """Probe implicit public access for system objects.

    - STORAGE VOLUME: DESC requires USAGE → probe per volume
    - WAREHOUSE: default_warehouse is implicitly available to all users
    """
    results: list[PrivilegeGrant] = []

    # Storage volumes — DESC requires USAGE
    try:
        sv_rows = execute_query(conn, "SHOW STORAGE VOLUMES")
        for r in sv_rows:
            sv_name = r.get("Storage Volume") or r.get("Name") or r.get("name") or ""
            if not sv_name:
                continue
            try:
                execute_query(conn, f"DESC STORAGE VOLUME `{safe_identifier(sv_name)}`")
                results.append(
                    PrivilegeGrant(
                        grantee="public",
                        grantee_type="ROLE",
                        object_catalog=None,
                        object_database=None,
                        object_name=sv_name,
                        object_type="STORAGE VOLUME",
                        privilege_type="USAGE",
                        is_grantable=False,
                        source="public (inferred)",
                    )
                )
            except Exception:
                pass
    except Exception:
        pass

    # Warehouses — default_warehouse is implicitly available to all users
    try:
        wh_rows = execute_query(conn, "SHOW WAREHOUSES")
        for r in wh_rows:
            wh_name = r.get("Name") or r.get("name") or ""
            if wh_name:
                results.append(
                    PrivilegeGrant(
                        grantee="public",
                        grantee_type="ROLE",
                        object_catalog=None,
                        object_database=None,
                        object_name=wh_name,
                        object_type="WAREHOUSE",
                        privilege_type="USAGE",
                        is_grantable=False,
                        source="public (inferred)",
                    )
                )
    except Exception:
        pass

    return results
