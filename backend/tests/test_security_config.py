"""Tests for production secret enforcement, CORS allowlist, and security headers."""
from __future__ import annotations

import pytest
from pydantic import ValidationError

from app.config import Settings


class TestProductionSecret:
    def test_production_rejects_placeholder_secret(self):
        with pytest.raises(ValidationError):
            Settings(environment="production", jwt_secret="change-me-in-production")

    def test_production_rejects_default_placeholder(self):
        with pytest.raises(ValidationError):
            Settings(environment="production", jwt_secret="change-me-in-production-use-env-var")

    def test_production_accepts_strong_secret(self):
        s = Settings(environment="production", jwt_secret="a-genuinely-random-strong-secret")
        assert not s.is_default_secret

    def test_development_allows_placeholder(self):
        s = Settings(environment="development", jwt_secret="change-me-in-production-use-env-var")
        assert s.is_default_secret


class TestCorsOriginList:
    def test_parses_comma_separated(self):
        s = Settings(cors_origins="http://a.com, http://b.com ,")
        assert s.cors_origin_list == ["http://a.com", "http://b.com"]


class TestSecurityHeaders:
    def test_headers_present(self, client):
        h = client.get("/api/health").headers
        assert h["X-Content-Type-Options"] == "nosniff"
        assert h["X-Frame-Options"] == "DENY"
        assert h["Referrer-Policy"] == "no-referrer"
        assert "frame-ancestors" in h["Content-Security-Policy"]


class TestCors:
    def test_allowed_origin_is_reflected(self, client):
        r = client.get("/api/health", headers={"Origin": "http://localhost:5173"})
        assert r.headers.get("access-control-allow-origin") == "http://localhost:5173"

    def test_disallowed_origin_not_reflected(self, client):
        r = client.get("/api/health", headers={"Origin": "http://evil.example"})
        assert r.headers.get("access-control-allow-origin") != "http://evil.example"
