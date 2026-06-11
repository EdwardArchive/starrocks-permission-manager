"""Tests for the production SPA static handler — path-traversal confinement."""
from __future__ import annotations

from app.static_mount import mount_static
from fastapi import FastAPI
from fastapi.testclient import TestClient


def _make_app(tmp_path) -> TestClient:
    # Fake build: <tmp>/static/{index.html,assets/app.js}, with a secret file
    # sitting OUTSIDE the static dir to attempt traversal against.
    static_dir = tmp_path / "static"
    (static_dir / "assets").mkdir(parents=True)
    (static_dir / "index.html").write_text("<spa/>")
    (static_dir / "assets" / "app.js").write_text("console.log(1)")
    (tmp_path / "secret.txt").write_text("TOP-SECRET")

    app = FastAPI()
    mount_static(app, static_dir=str(static_dir))
    return TestClient(app)


def test_serves_real_file(tmp_path):
    client = _make_app(tmp_path)
    assert client.get("/index.html").text == "<spa/>"


def test_unknown_path_falls_back_to_index(tmp_path):
    client = _make_app(tmp_path)
    r = client.get("/some/spa/route")
    assert r.status_code == 200
    assert r.text == "<spa/>"


def test_traversal_is_blocked(tmp_path):
    client = _make_app(tmp_path)
    for path in ("/../secret.txt", "/..%2f..%2fsecret.txt", "/%2e%2e/secret.txt"):
        r = client.get(path)
        # Normalized away by the router or caught by our guard — either way the
        # secret must never be served.
        assert "TOP-SECRET" not in r.text


def test_absolute_path_is_blocked(tmp_path):
    client = _make_app(tmp_path)
    r = client.get("/etc/hostname")
    assert "root:" not in r.text  # never serves /etc/* content
    assert r.text == "<spa/>"


def test_noop_without_static_dir(tmp_path):
    # Missing directory → no routes registered, no error.
    app = FastAPI()
    mount_static(app, static_dir=str(tmp_path / "does-not-exist"))
    assert not any(getattr(r, "path", None) == "/{full_path:path}" for r in app.router.routes)
