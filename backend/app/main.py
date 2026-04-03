import asyncio
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from app.routers import auth, dag, objects, privileges, roles, search
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
app.include_router(objects.router, prefix="/api/objects", tags=["objects"])
app.include_router(privileges.router, prefix="/api/privileges", tags=["privileges"])
app.include_router(roles.router, prefix="/api/roles", tags=["roles"])
app.include_router(dag.router, prefix="/api/dag", tags=["dag"])
app.include_router(search.router, prefix="/api/search", tags=["search"])


@app.get("/api/health")
def health():
    return {"status": "ok"}
