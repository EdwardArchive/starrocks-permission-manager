import asyncio
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from app.routers import auth
from app.routers import (
    admin_dag,
    admin_privileges,
    admin_roles,
    admin_search,
    user_dag,
    user_objects,
    user_permissions,
    user_roles,
    user_search,
)
from app.utils.session_store import session_store


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup: periodic cleanup of expired sessions
    async def _cleanup_loop():
        while True:
            await asyncio.sleep(300)
            session_store.cleanup_expired()

    cleanup_task = asyncio.create_task(_cleanup_loop())
    yield
    # Shutdown
    cleanup_task.cancel()


app = FastAPI(title=settings.app_name, version="1.0.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router, prefix="/api/auth", tags=["auth"])

# User routes (Layer 1 — all users)
app.include_router(user_objects.router, prefix="/api/user/objects", tags=["user-objects"])
app.include_router(user_permissions.router, prefix="/api/user", tags=["user-permissions"])
app.include_router(user_roles.router, prefix="/api/user/roles", tags=["user-roles"])
app.include_router(user_dag.router, prefix="/api/user/dag", tags=["user-dag"])
app.include_router(user_search.router, prefix="/api/user/search", tags=["user-search"])

# Admin routes (Layer 1+2 — admin only)
app.include_router(admin_privileges.router, prefix="/api/admin/privileges", tags=["admin-privileges"])
app.include_router(admin_roles.router, prefix="/api/admin/roles", tags=["admin-roles"])
app.include_router(admin_dag.router, prefix="/api/admin/dag", tags=["admin-dag"])
app.include_router(admin_search.router, prefix="/api/admin/search", tags=["admin-search"])


@app.get("/api/health")
def health():
    return {"status": "ok"}
