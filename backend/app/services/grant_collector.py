"""
Unified grant collection facade.

Delegates to:
- Layer 1 (common/show_grants_collector): SHOW GRANTS only — non-admin path
- Layer 2 (admin/sys_collector): sys.* tables + SHOW GRANTS — admin path

The GrantCollector class and CollectedGrants dataclass remain here as the
public API that routers and services import.
"""

from __future__ import annotations

import logging
import threading
from copy import deepcopy
from dataclasses import dataclass, field

from cachetools import TTLCache

from app.config import settings
from app.models.schemas import PrivilegeGrant

logger = logging.getLogger("privileges")

# Collecting all grants is expensive (full sys.* scans + a SHOW GRANTS per
# grantee). Cache the assembled CollectedGrants per (host, username, is_admin).
_grants_cache: TTLCache = TTLCache(maxsize=256, ttl=settings.cache_ttl_seconds)
_grants_cache_lock = threading.Lock()


# ══════════════════════════════════════════════════════════════════════
# Data structures
# ══════════════════════════════════════════════════════════════════════


@dataclass
class CollectedGrants:
    """Complete grant data for a session."""

    grants: list[PrivilegeGrant] = field(default_factory=list)
    user_role_chain: dict[str, str] = field(default_factory=dict)  # {role: origin}
    role_child_map: dict[str, list[str]] = field(default_factory=dict)  # {parent: [children]}
    all_users: set[str] = field(default_factory=set)


# ══════════════════════════════════════════════════════════════════════
# GrantCollector (facade)
# ══════════════════════════════════════════════════════════════════════


class GrantCollector:
    """Collects all raw grants visible to the current session.

    Usage:
        collector = GrantCollector(conn, "kate_intern", is_admin=False)
        collected = collector.collect()
    """

    def __init__(self, conn, username: str, is_admin: bool, host: str | None = None):
        self._conn = conn
        self._username = username
        self._is_admin = is_admin
        self._host = host

    def collect(self) -> CollectedGrants:
        key = (self._host, self._username, self._is_admin)
        with _grants_cache_lock:
            cached = _grants_cache.get(key)
        if cached is not None:
            # GrantResolver mutates grant.source in place, so every caller must
            # get an independent deepcopy — never the shared cached object.
            return deepcopy(cached)

        result = self._collect_uncached()
        with _grants_cache_lock:
            _grants_cache[key] = result
        return deepcopy(result)

    def _collect_uncached(self) -> CollectedGrants:
        if self._is_admin:
            from app.services.admin.sys_collector import collect_admin

            return collect_admin(self._conn, self._username)

        from app.services.common.show_grants_collector import collect_non_admin

        return collect_non_admin(self._conn, self._username)
