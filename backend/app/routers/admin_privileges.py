"""Admin Privilege API endpoints.

Admin-only endpoints using Layer 2 (sys.* tables).
Uses GrantCollector(is_admin=True) → GrantResolver for all privilege queries.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, Query

from app.dependencies import get_credentials, get_db, require_admin
from app.models.schemas import PrivilegeGrant
from app.services.admin.sys_collector import fetch_role_grants_raw
from app.services.common.grant_classifier import ObjectQuery
from app.services.common.grant_resolver import GrantResolver
from app.services.grant_collector import GrantCollector

router = APIRouter(dependencies=[Depends(require_admin)])


# ══════════════════════════════════════════════════════════════════════
# Helpers
# ══════════════════════════════════════════════════════════════════════


def _collect(conn, credentials: dict) -> GrantCollector:
    return GrantCollector(
        conn,
        username=credentials["username"],
        is_admin=True,
        host=credentials.get("host"),
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
    """Return raw GRANT data for a role (delegates to sys_collector)."""
    return fetch_role_grants_raw(conn, rolename)


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
