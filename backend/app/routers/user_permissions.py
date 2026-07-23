"""Router for /api/user/privileges/my-permissions endpoint.

Layer 1 endpoint: delegates to services.common.my_permissions (no sys.* tables).
"""

from __future__ import annotations

from fastapi import APIRouter, Depends

from app.dependencies import get_credentials, get_db
from app.services.common.my_permissions import (
    collect_catalog_objects,
    collect_catalogs,
    collect_role_chain,
    collect_system_objects,
    flatten_effective_privileges,
)

router = APIRouter()


@router.get("/my-permissions")
def get_my_permissions(
    credentials: dict = Depends(get_credentials),
    conn=Depends(get_db),
):
    """Build the current user's full permission tree using only privilege reads."""
    username = credentials["username"]

    # Roles are already activated by the pooled connection reset (get_db).
    direct_roles, direct_privileges, role_tree = collect_role_chain(conn, username)

    accessible_catalogs = collect_catalogs(conn)
    accessible_databases, accessible_objects = collect_catalog_objects(conn, accessible_catalogs)

    system_objects = collect_system_objects(conn, credentials.get("is_admin", False))

    effective_privileges = flatten_effective_privileges(direct_privileges, direct_roles, role_tree)

    return {
        "username": username,
        "direct_roles": direct_roles,
        "role_tree": {
            k: {
                "grants": [
                    {
                        "privilege_type": g.privilege_type,
                        "object_type": g.object_type,
                        "object_catalog": g.object_catalog,
                        "object_database": g.object_database,
                        "object_name": g.object_name,
                    }
                    for g in v["grants"]
                ],
                "parent_roles": v["parent_roles"],
            }
            for k, v in role_tree.items()
        },
        "effective_privileges": effective_privileges,
        "accessible_databases": accessible_databases,
        "accessible_catalogs": accessible_catalogs,
        "accessible_objects": accessible_objects,
        "system_objects": system_objects,
    }
