"""Shared constants for the privilege management system."""

from __future__ import annotations

BUILTIN_ROLES: frozenset[str] = frozenset(
    {"root", "db_admin", "user_admin", "cluster_admin", "security_admin", "public"}
)

BFS_MAX_DEPTH = 100
