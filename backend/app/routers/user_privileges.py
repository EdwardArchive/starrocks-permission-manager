"""User Privilege API endpoints.

Available to all users. Uses GrantCollector with credentials-based is_admin flag.
Non-admin: SHOW GRANTS path. Admin: sys.* path. Same GrantResolver for both.
"""

from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, Query

from app.dependencies import get_credentials, get_db
from app.models.schemas import PrivilegeGrant
from app.services.common.grant_classifier import ObjectQuery
from app.services.common.grant_resolver import GrantResolver
from app.services.grant_collector import GrantCollector

logger = logging.getLogger("user_privileges")
router = APIRouter()


def _collect(conn, credentials: dict) -> GrantCollector:
    return GrantCollector(
        conn,
        username=credentials["username"],
        is_admin=credentials.get("is_admin", False),
    )


@router.get("/user/{username}/effective", response_model=list[PrivilegeGrant])
def get_user_effective_privileges(
    username: str, credentials: dict = Depends(get_credentials), conn=Depends(get_db)
):
    collected = _collect(conn, credentials).collect()
    return GrantResolver(collected, conn).for_user_effective(username)


@router.get("/role/{rolename}", response_model=list[PrivilegeGrant])
def get_role_privileges(
    rolename: str, credentials: dict = Depends(get_credentials), conn=Depends(get_db)
):
    collected = _collect(conn, credentials).collect()
    return GrantResolver(collected, conn).for_role(rolename)


@router.get("/object", response_model=list[PrivilegeGrant])
def get_object_privileges(
    catalog: str = Query(None),
    database: str = Query(None),
    name: str = Query(None),
    object_type: str = Query(None),
    credentials: dict = Depends(get_credentials),
    conn=Depends(get_db),
):
    q = ObjectQuery(catalog=catalog, database=database, name=name, object_type=object_type)
    collected = _collect(conn, credentials).collect()
    return GrantResolver(collected, conn).for_object(q)
