# ── Stage 1: Build frontend ──
FROM node:24-alpine AS frontend-build

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

# Static files are served by app/static_mount.py (mounted from app/main.py),
# which confines requests to ./static to prevent path traversal.

EXPOSE 8001

# Production refuses to start unless a strong SRPM_JWT_SECRET is supplied at
# runtime (no secret is baked into the image).
ENV SRPM_ENVIRONMENT=production

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8001", "--workers", "1"]
