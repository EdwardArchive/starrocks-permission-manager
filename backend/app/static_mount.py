"""Production static-file mounting for the built SPA.

Kept as a real, version-controlled module (instead of being generated inside
the Dockerfile) so the path-traversal guard is reviewable and testable.

In development / tests there is no ``static`` directory, so ``mount_static`` is
a no-op and the SPA catch-all route is never registered.
"""

from __future__ import annotations

import os

from fastapi import FastAPI
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles


def mount_static(app: FastAPI, static_dir: str | None = None) -> None:
    if static_dir is None:
        static_dir = os.path.join(os.path.dirname(__file__), "..", "static")
    static_dir = os.path.abspath(static_dir)
    if not os.path.isdir(static_dir):
        return

    assets_dir = os.path.join(static_dir, "assets")
    if os.path.isdir(assets_dir):
        app.mount("/assets", StaticFiles(directory=assets_dir), name="assets")

    index_file = os.path.join(static_dir, "index.html")

    @app.get("/{full_path:path}")
    async def serve_spa(full_path: str):
        # Confine the resolved path to static_dir. normpath collapses "..", and
        # an absolute full_path makes os.path.join discard static_dir entirely —
        # both cases land outside static_dir and fall back to the SPA entrypoint.
        candidate = os.path.normpath(os.path.join(static_dir, full_path))
        if (candidate == static_dir or candidate.startswith(static_dir + os.sep)) and os.path.isfile(candidate):
            return FileResponse(candidate)
        return FileResponse(index_file)
