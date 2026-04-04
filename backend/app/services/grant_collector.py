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
from dataclasses import dataclass, field

from app.models.schemas import PrivilegeGrant

logger = logging.getLogger("privileges")


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

    def __init__(self, conn, username: str, is_admin: bool):
        self._conn = conn
        self._username = username
        self._is_admin = is_admin

    def collect(self) -> CollectedGrants:
        if self._is_admin:
            from app.services.admin.sys_collector import collect_admin

            return collect_admin(self._conn, self._username)

        from app.services.common.show_grants_collector import collect_non_admin

        return collect_non_admin(self._conn, self._username)
