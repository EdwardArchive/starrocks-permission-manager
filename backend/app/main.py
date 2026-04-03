from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from app.routers import auth, dag, objects, privileges, roles, search

app = FastAPI(title=settings.app_name, version="1.0.0")

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
