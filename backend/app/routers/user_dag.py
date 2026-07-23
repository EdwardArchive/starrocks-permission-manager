"""Router for /api/user/dag/* endpoints.

Non-admin DAG endpoints using only SHOW + INFORMATION_SCHEMA (no sys.* tables).
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, Query

from app.config import settings
from app.dependencies import get_credentials, get_db
from app.models.schemas import DAGGraph
from app.services.common.object_dag import build_object_hierarchy
from app.services.shared.role_dag import build_role_hierarchy_from_grants

# Re-exported only so conftest can monkeypatch this module attr in tests; the
# actual fan-out now runs inside object_dag via starrocks_client.parallel_queries.
from app.services.starrocks_client import parallel_queries  # noqa: F401
from app.utils.cache import make_ttl_cache

router = APIRouter()

# Server-side TTL cache for DAG results
_dag_cache = make_ttl_cache("user_dag.dag", maxsize=64, ttl=settings.cache_ttl_seconds)


@router.get("/object-hierarchy", response_model=DAGGraph)
def get_object_hierarchy(
    catalog: str = Query("default_catalog", description="Catalog to load (default: default_catalog)"),
    depth: str = Query("full", description="'shallow' = catalogs+DBs only, 'full' = include objects"),
    conn=Depends(get_db),
    credentials: dict = Depends(get_credentials),
):
    """Build object hierarchy DAG using only SHOW + INFORMATION_SCHEMA."""
    username = credentials["username"]
    cache_key = f"user_obj_hier_{username}_{catalog}_{depth}"
    if cache_key in _dag_cache:
        return _dag_cache[cache_key]

    result = build_object_hierarchy(conn, credentials, catalog, depth)
    _dag_cache[cache_key] = result
    return result


@router.get("/role-hierarchy", response_model=DAGGraph)
def get_role_hierarchy(conn=Depends(get_db), credentials: dict = Depends(get_credentials)):
    """Build role hierarchy DAG for the current user via SHOW GRANTS."""
    username = credentials["username"]
    cache_key = f"user_role_hier_dag_{username}"
    if cache_key in _dag_cache:
        return _dag_cache[cache_key]

    result = build_role_hierarchy_from_grants(conn, username)
    _dag_cache[cache_key] = result
    return result
