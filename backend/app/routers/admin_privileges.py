"""Admin Privilege API endpoints.

Admin-only endpoints using Layer 2 (sys.* tables).
Uses GrantCollector(is_admin=True) → GrantResolver for all privilege queries.
"""

from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, Query

from app.dependencies import get_credentials, get_db, require_admin
from app.models.schemas import PrivilegeGrant
from app.services.common.grant_classifier import ObjectQuery
from app.services.grant_collector import GrantCollector
from app.services.common.grant_resolver import GrantResolver
from app.services.starrocks_client import execute_query
from app.utils.sql_safety import safe_name

logger = logging.getLogger("admin_privileges")
router = APIRouter(dependencies=[Depends(require_admin)])


# ══════════════════════════════════════════════════════════════════════
# Helpers
# ══════════════════════════════════════════════════════════════════════


def _collect(conn, credentials: dict) -> GrantCollector:
    return GrantCollector(
        conn,
        username=credentials["username"],
        is_admin=True,
    )


# ══════════════════════════════════════════════════════════════════════
# API Endpoints
# ══════════════════════════════════════════════════════════════════════


@router.get("/user/{username}", response_model=list[PrivilegeGrant])
def get_user_privileges(username: str, credentials: dict = Depends(get_credentials), conn=Depends(get_db)):
    """Get direct privileges for a user (admin path via sys.* tables)."""
    collected = _collect(conn, credentials).collect()
    return GrantResolver(collected, conn).for_user(username)


@router.get("/user/{username}/effective", response_model=list[PrivilegeGrant])
def get_user_effective_privileges(username: str, credentials: dict = Depends(get_credentials), conn=Depends(get_db)):
    """Resolve all privileges including inherited through roles (admin path)."""
    collected = _collect(conn, credentials).collect()
    return GrantResolver(collected, conn).for_user_effective(username)


@router.get("/role/{rolename}", response_model=list[PrivilegeGrant])
def get_role_privileges(rolename: str, credentials: dict = Depends(get_credentials), conn=Depends(get_db)):
    """Get privileges for a role, including inherited from parent roles (admin path)."""
    collected = _collect(conn, credentials).collect()
    return GrantResolver(collected, conn).for_role(rolename)


@router.get("/role/{rolename}/raw")
def get_role_privileges_raw(rolename: str, conn=Depends(get_db)):
    """Return raw GRANT data for a role from sys.grants_to_roles + SHOW GRANTS FOR ROLE."""
    results: dict = {"sys_grants_to_roles": [], "show_grants": []}
    try:
        rows = execute_query(conn, "SELECT * FROM sys.grants_to_roles WHERE GRANTEE = %s", (rolename,))
        results["sys_grants_to_roles"] = [dict(r) for r in rows]
    except Exception as e:
        results["sys_grants_to_roles_error"] = str(e)
    try:
        rows = execute_query(conn, f"SHOW GRANTS FOR ROLE '{safe_name(rolename)}'")
        results["show_grants"] = [dict(r) for r in rows]
    except Exception as e:
        results["show_grants_error"] = str(e)
    return results


@router.get("/object", response_model=list[PrivilegeGrant])
def get_object_privileges(
    catalog: str = Query(None),
    database: str = Query(None),
    name: str = Query(None),
    object_type: str = Query(None, description="Object type: TABLE, VIEW, MATERIALIZED VIEW, FUNCTION, SYSTEM"),
    credentials: dict = Depends(get_credentials),
    conn=Depends(get_db),
):
    """Get all grants on a specific object, including inherited from parent scopes (admin path)."""
    q = ObjectQuery(catalog=catalog, database=database, name=name, object_type=object_type)
    collected = _collect(conn, credentials).collect()
    return GrantResolver(collected, conn).for_object(q)
