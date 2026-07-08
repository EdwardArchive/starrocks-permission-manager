"""Admin DAG API endpoints.

Admin-only endpoints for DAG visualization using sys.* tables.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, Query

from app.config import settings
from app.dependencies import get_credentials, get_db, require_admin
from app.models.schemas import DAGGraph
from app.services.common.object_dag import build_object_hierarchy

# Re-exported only so conftest can monkeypatch this module attr in tests; the
# actual fan-out now runs inside object_dag via starrocks_client.parallel_queries.
from app.services.starrocks_client import parallel_queries  # noqa: F401
from app.utils.cache import make_ttl_cache

router = APIRouter(dependencies=[Depends(require_admin)])

# Server-side TTL cache for admin DAG results
_dag_cache = make_ttl_cache("admin_dag.dag", maxsize=64, ttl=settings.cache_ttl_seconds)


@router.get("/object-hierarchy", response_model=DAGGraph)
def get_object_hierarchy(
    catalog: str = Query("default_catalog", description="Catalog to load (default: default_catalog)"),
    depth: str = Query("full", description="'shallow' = catalogs+DBs only, 'full' = include objects"),
    conn=Depends(get_db),
    credentials: dict = Depends(get_credentials),
):
    """Build object hierarchy DAG (admin only)."""
    cache_key = f"admin_obj_hier_{catalog}_{depth}"
    if cache_key in _dag_cache:
        return _dag_cache[cache_key]

    result = build_object_hierarchy(conn, credentials, catalog, depth)
    _dag_cache[cache_key] = result
    return result


@router.get("/role-hierarchy", response_model=DAGGraph)
def get_role_hierarchy(conn=Depends(get_db)):
    """Role hierarchy DAG (admin only). Delegates to admin_roles hierarchy."""
    cache_key = "admin_role_hier"
    if cache_key in _dag_cache:
        return _dag_cache[cache_key]

    from app.routers.admin_roles import get_role_hierarchy as _get

    result = _get(conn=conn)
    _dag_cache[cache_key] = result
    return result
