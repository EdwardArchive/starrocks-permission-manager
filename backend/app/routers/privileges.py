"""Privilege API endpoints.

All endpoints use the 2-layer architecture:
  Layer 1: GrantCollector — collects all raw grants (admin/non-admin)
  Layer 2: GrantResolver — filters/resolves for specific queries
"""

from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, Query

from app.dependencies import get_credentials, get_db
from app.models.schemas import PrivilegeGrant
from app.routers.my_permissions import router as my_perms_router
from app.services.grant_classifier import ObjectQuery
from app.services.grant_collector import GrantCollector
from app.services.grant_resolver import GrantResolver
from app.services.starrocks_client import execute_query
from app.utils.sql_safety import safe_name

logger = logging.getLogger("privileges")
router = APIRouter()
router.include_router(my_perms_router)


# ══════════════════════════════════════════════════════════════════════
# API Endpoints
# ══════════════════════════════════════════════════════════════════════


def _collect(conn, credentials: dict) -> GrantCollector:
    return GrantCollector(
        conn,
        username=credentials["username"],
        is_admin=credentials.get("is_admin", False),
    )


@router.get("/user/{username}", response_model=list[PrivilegeGrant])
def get_user_privileges(username: str, credentials: dict = Depends(get_credentials), conn=Depends(get_db)):
    collected = _collect(conn, credentials).collect()
    return GrantResolver(collected, conn).for_user(username)


@router.get("/role/{rolename}", response_model=list[PrivilegeGrant])
def get_role_privileges(rolename: str, credentials: dict = Depends(get_credentials), conn=Depends(get_db)):
    """Get privileges for a role, including inherited from parent roles."""
    collected = _collect(conn, credentials).collect()
    return GrantResolver(collected, conn).for_role(rolename)


@router.get("/role/{rolename}/raw")
def get_role_privileges_raw(rolename: str, conn=Depends(get_db)):
    """Debug: return raw SHOW GRANTS output for a role."""
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


@router.get("/user/{username}/effective", response_model=list[PrivilegeGrant])
def get_user_effective_privileges(username: str, credentials: dict = Depends(get_credentials), conn=Depends(get_db)):
    """Resolve all privileges including inherited through roles."""
    collected = _collect(conn, credentials).collect()
    return GrantResolver(collected, conn).for_user_effective(username)


@router.get("/object", response_model=list[PrivilegeGrant])
def get_object_privileges(
    catalog: str = Query(None),
    database: str = Query(None),
    name: str = Query(None),
    object_type: str = Query(None, description="Object type: TABLE, VIEW, MATERIALIZED VIEW, FUNCTION, SYSTEM"),
    credentials: dict = Depends(get_credentials),
    conn=Depends(get_db),
):
    """Get all grants on a specific object, including inherited from parent scopes."""
    q = ObjectQuery(catalog=catalog, database=database, name=name, object_type=object_type)
    collected = _collect(conn, credentials).collect()
    return GrantResolver(collected, conn).for_object(q)
