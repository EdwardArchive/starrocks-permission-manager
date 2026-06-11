import asyncio
import logging
from contextlib import asynccontextmanager

import mysql.connector.errors
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.config import settings
from app.routers import (
    admin_dag,
    admin_grants,
    admin_privileges,
    admin_roles,
    admin_search,
    auth,
    cluster,
    user_dag,
    user_objects,
    user_permissions,
    user_privileges,
    user_roles,
    user_search,
)
from app.routers.cluster import shutdown_metrics_executor
from app.utils.session_store import session_store
from app.utils.sys_access import is_access_denied

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup: warn loudly if running on the placeholder JWT secret
    if settings.is_default_secret:
        logger.warning(
            "SRPM_JWT_SECRET is the built-in placeholder. Set a strong, unique secret "
            "(SRPM_ENVIRONMENT=production refuses to start without one)."
        )

    # Startup: periodic cleanup of expired sessions
    async def _cleanup_loop():
        while True:
            await asyncio.sleep(300)
            session_store.cleanup_expired()

    cleanup_task = asyncio.create_task(_cleanup_loop())
    yield
    # Shutdown
    cleanup_task.cancel()
    shutdown_metrics_executor()


app = FastAPI(title=settings.app_name, version="1.0.0", lifespan=lifespan)

# Auth is via the Authorization header (not cookies), so credentialed CORS is
# unnecessary; restrict origins to an explicit allowlist instead of "*".
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def security_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault("X-Frame-Options", "DENY")
    response.headers.setdefault("Referrer-Policy", "no-referrer")
    # frame-ancestors blocks clickjacking without constraining the SPA's own
    # script/style loading (a stricter CSP is left to a follow-up).
    response.headers.setdefault("Content-Security-Policy", "frame-ancestors 'none'")
    return response


app.include_router(auth.router, prefix="/api/auth", tags=["auth"])

# User routes (Layer 1 — all users)
app.include_router(user_objects.router, prefix="/api/user/objects", tags=["user-objects"])
app.include_router(user_permissions.router, prefix="/api/user", tags=["user-permissions"])
app.include_router(user_roles.router, prefix="/api/user/roles", tags=["user-roles"])
app.include_router(user_privileges.router, prefix="/api/user/privileges", tags=["user-privileges"])
app.include_router(user_dag.router, prefix="/api/user/dag", tags=["user-dag"])
app.include_router(user_search.router, prefix="/api/user/search", tags=["user-search"])

# Admin routes (Layer 1+2 — admin only)
app.include_router(admin_privileges.router, prefix="/api/admin/privileges", tags=["admin-privileges"])
app.include_router(admin_roles.router, prefix="/api/admin/roles", tags=["admin-roles"])
app.include_router(admin_dag.router, prefix="/api/admin/dag", tags=["admin-dag"])
app.include_router(admin_search.router, prefix="/api/admin/search", tags=["admin-search"])

# Cluster routes (all logged-in users; StarRocks enforces cluster_admin / SYSTEM OPERATE)
app.include_router(cluster.router, prefix="/api/cluster", tags=["cluster"])

# Grant write routes (admin + user_admin capability; require_grant_admin enforced)
app.include_router(admin_grants.router, prefix="/api/admin/grants", tags=["admin-grants"])


@app.exception_handler(mysql.connector.errors.Error)
async def mysql_error_handler(request: Request, exc: mysql.connector.errors.Error):
    if is_access_denied(exc):
        logger.warning("DB access denied for %s: %s", request.url.path, exc)
        return JSONResponse(
            status_code=403,
            content={"detail": "Insufficient database privileges. Try re-logging in or contact your admin."},
        )
    logger.error("Unexpected DB error for %s: %s", request.url.path, exc)
    return JSONResponse(status_code=500, content={"detail": "Database error"})


@app.get("/api/health")
def health():
    return {"status": "ok"}


# Mount the built SPA (production only — no-op when ./static is absent)
from app.static_mount import mount_static  # noqa: E402

mount_static(app)
