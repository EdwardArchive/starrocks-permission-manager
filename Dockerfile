# ── Stage 1: Build frontend ──
FROM node:20-alpine AS frontend-build

WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci

COPY frontend/ ./
RUN npm run build


# ── Stage 2: Production image ──
FROM python:3.12-slim

WORKDIR /app

# Install Python dependencies
COPY backend/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt && \
    pip install --no-cache-dir gunicorn

# Copy backend
COPY backend/app/ ./app/

# Copy frontend build output
COPY --from=frontend-build /app/frontend/dist ./static/

# Serve frontend static files via FastAPI
RUN echo '\
import os\n\
from fastapi.staticfiles import StaticFiles\n\
from fastapi.responses import FileResponse\n\
\n\
def mount_static(app):\n\
    static_dir = os.path.join(os.path.dirname(__file__), "..", "static")\n\
    if os.path.isdir(static_dir):\n\
        app.mount("/assets", StaticFiles(directory=os.path.join(static_dir, "assets")), name="assets")\n\
        @app.get("/{full_path:path}")\n\
        async def serve_spa(full_path: str):\n\
            file_path = os.path.join(static_dir, full_path)\n\
            if os.path.isfile(file_path):\n\
                return FileResponse(file_path)\n\
            return FileResponse(os.path.join(static_dir, "index.html"))\n\
' > app/static_mount.py

# Patch main.py to mount static files
RUN echo '\n\
# Mount static files (production)\n\
try:\n\
    from app.static_mount import mount_static\n\
    mount_static(app)\n\
except Exception:\n\
    pass\n\
' >> app/main.py

EXPOSE 8001

ENV SRPM_JWT_SECRET=change-me-in-production

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8001", "--workers", "1"]
