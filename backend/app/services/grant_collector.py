"""
Layer 1: Unified grant collection.

Collects ALL raw PrivilegeGrant[] visible to a session, handling:
- Admin path: sys.grants_to_users/roles + SHOW GRANTS for builtins
- Non-admin path: SHOW GRANTS + BFS role chain + public probe
- Public role: probe fallback when SHOW GRANTS FOR ROLE public fails

Single source of truth — replaces the duplicated collection logic in
privileges.py (_query_grants_for, _collect_sys_grants, _supplement_builtins,
_probe_public_defaults, _infer_public_access) and my_permissions.py BFS.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field

from app.models.schemas import PrivilegeGrant
from app.services.grant_classifier import _BUILTIN_ROLES
from app.services.grant_parser import _parse_show_grants, _row_to_grants
from app.services.starrocks_client import execute_query
from app.utils.role_helpers import build_role_chain
from app.utils.sql_safety import safe_identifier

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
# GrantCollector
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
            return self._collect_admin()
        return self._collect_non_admin()

    # ── Admin path ──

    def _collect_admin(self) -> CollectedGrants:
        grants: list[PrivilegeGrant] = []

        # 1. sys.grants_to_users + sys.grants_to_roles (ALL rows)
        for table, gtype in [("sys.grants_to_users", "USER"), ("sys.grants_to_roles", "ROLE")]:
            try:
                rows = execute_query(self._conn, f"SELECT * FROM {table}")
                for r in rows:
                    grants.extend(_row_to_grants(r, gtype))
            except Exception:
                logger.debug("Failed to query %s", table)

        # 2. Supplement builtin roles not in sys tables via SHOW GRANTS
        found_roles = {g.grantee for g in grants if g.grantee_type == "ROLE"}
        for role in _BUILTIN_ROLES - found_roles:
            try:
                grants.extend(_parse_show_grants(self._conn, role, "ROLE"))
            except Exception:
                logger.debug("Failed to get SHOW GRANTS for builtin role %s", role)

        # 3. Supplement users not in sys tables
        all_users = self._get_all_users()
        found_users = {g.grantee for g in grants if g.grantee_type == "USER"}
        for u in all_users - found_users:
            try:
                grants.extend(_parse_show_grants(self._conn, u, "USER"))
            except Exception:
                logger.debug("Failed to get SHOW GRANTS for user %s", u)

        # 4. Merge scope-level grants from SHOW GRANTS (sys expands wildcards)
        grants = self._merge_show_grants_scope(grants)

        # 4b. Add implicit public defaults (default_warehouse etc.)
        grants.extend(self._probe_public_defaults())

        # 5. Role hierarchy
        role_chain = build_role_chain(self._conn, self._username, include_public=True)
        role_child_map = self._fetch_role_child_map()

        return CollectedGrants(
            grants=grants,
            user_role_chain=role_chain,
            role_child_map=role_child_map,
            all_users=all_users,
        )

    # ── Non-admin path ──

    def _collect_non_admin(self) -> CollectedGrants:
        grants: list[PrivilegeGrant] = []

        # 1. User's direct grants
        grants.extend(_query_grants_merged(self._conn, self._username, "USER"))

        # 2. BFS role chain (including public)
        role_chain = build_role_chain(self._conn, self._username, include_public=True)

        # 3. Each role's grants
        public_empty = False
        for role in role_chain:
            role_grants = _query_grants_merged(self._conn, role, "ROLE")
            if role == "public" and not role_grants:
                public_empty = True
            grants.extend(role_grants)

        # 4. Public fallback: probe storage volumes
        if public_empty:
            grants.extend(self._probe_public_defaults())

        # 5. Role child map (try sys, silently fail for non-admin)
        role_child_map = self._fetch_role_child_map()

        return CollectedGrants(
            grants=grants,
            user_role_chain=role_chain,
            role_child_map=role_child_map,
            all_users=set(),
        )

    # ── Shared helpers ──

    def _get_all_users(self) -> set[str]:
        from app.services.user_service import get_all_users

        return get_all_users(self._conn)

    def _fetch_role_child_map(self) -> dict[str, list[str]]:
        children_of: dict[str, list[str]] = {}
        try:
            rows = execute_query(
                self._conn,
                "SELECT FROM_ROLE, TO_ROLE FROM sys.role_edges WHERE TO_ROLE IS NOT NULL AND TO_ROLE != ''",
            )
            for e in rows:
                parent = e.get("FROM_ROLE") or ""
                child = e.get("TO_ROLE") or ""
                if parent and child:
                    children_of.setdefault(parent, []).append(child)
        except Exception:
            logger.debug("Failed to query sys.role_edges for role child map")
        return children_of

    def _merge_show_grants_scope(self, sys_grants: list[PrivilegeGrant]) -> list[PrivilegeGrant]:
        """For admin: supplement sys grants with scope-level SHOW GRANTS
        that sys tables don't contain (SYSTEM, STORAGE VOLUME, etc.)."""
        # Group sys grants by grantee
        grantees = {(g.grantee, g.grantee_type) for g in sys_grants}
        _sys_covered_types = {"TABLE", "DATABASE", "CATALOG"}

        def _norm_name(n: str) -> str:
            return n.split("(")[0] if "(" in n else n

        existing = {(g.grantee, g.object_type, _norm_name(g.object_name or ""), g.privilege_type) for g in sys_grants}

        for grantee, gtype in grantees:
            try:
                show = _parse_show_grants(self._conn, grantee, gtype)
                for g in show:
                    if g.object_type in _sys_covered_types and g.object_name:
                        continue
                    key = (g.grantee, g.object_type, _norm_name(g.object_name or ""), g.privilege_type)
                    if key not in existing:
                        sys_grants.append(g)
                        existing.add(key)
            except Exception:
                pass

        return sys_grants

    def _probe_public_defaults(self) -> list[PrivilegeGrant]:
        """Probe implicit public access for system objects.

        - STORAGE VOLUME: DESC requires USAGE → probe per volume
        - WAREHOUSE: default_warehouse is implicitly available to all users
        """
        results: list[PrivilegeGrant] = []

        # Storage volumes — DESC requires USAGE
        try:
            sv_rows = execute_query(self._conn, "SHOW STORAGE VOLUMES")
            for r in sv_rows:
                sv_name = r.get("Storage Volume") or r.get("Name") or r.get("name") or ""
                if not sv_name:
                    continue
                try:
                    execute_query(self._conn, f"DESC STORAGE VOLUME `{safe_identifier(sv_name)}`")
                    results.append(
                        PrivilegeGrant(
                            grantee="public",
                            grantee_type="ROLE",
                            object_catalog=None,
                            object_database=None,
                            object_name=sv_name,
                            object_type="STORAGE VOLUME",
                            privilege_type="USAGE",
                            is_grantable=False,
                            source="public (inferred)",
                        )
                    )
                except Exception:
                    pass
        except Exception:
            pass

        # Warehouses — default_warehouse is implicitly available to all users
        try:
            wh_rows = execute_query(self._conn, "SHOW WAREHOUSES")
            for r in wh_rows:
                wh_name = r.get("Name") or r.get("name") or ""
                if wh_name:
                    results.append(
                        PrivilegeGrant(
                            grantee="public",
                            grantee_type="ROLE",
                            object_catalog=None,
                            object_database=None,
                            object_name=wh_name,
                            object_type="WAREHOUSE",
                            privilege_type="USAGE",
                            is_grantable=False,
                            source="public (inferred)",
                        )
                    )
        except Exception:
            pass

        return results


# ══════════════════════════════════════════════════════════════════════
# Shared per-grantee query (used by both paths)
# ══════════════════════════════════════════════════════════════════════


def _query_grants_merged(conn, grantee: str, grantee_type: str) -> list[PrivilegeGrant]:
    """Get grants for a single grantee. Merges sys + SHOW GRANTS.
    sys.grants_to_* expands wildcards; SHOW GRANTS captures scope-level grants."""
    table = "sys.grants_to_users" if grantee_type == "USER" else "sys.grants_to_roles"
    sys_grants: list[PrivilegeGrant] = []
    try:
        rows = execute_query(conn, f"SELECT * FROM {table} WHERE GRANTEE = %s", (grantee,))
        if rows:
            sys_grants = [g for r in rows for g in _row_to_grants(r, grantee_type)]
    except Exception:
        logger.debug("Query failed, skipping")

    if not sys_grants:
        return _parse_show_grants(conn, grantee, grantee_type)

    # Supplement with scope-level grants from SHOW GRANTS
    show_grants = _parse_show_grants(conn, grantee, grantee_type)
    _sys_covered_types = {"TABLE", "DATABASE", "CATALOG"}

    def _norm_name(n: str) -> str:
        return n.split("(")[0] if "(" in n else n

    existing = {(g.object_type, _norm_name(g.object_name or ""), g.privilege_type) for g in sys_grants}
    for g in show_grants:
        if g.object_type in _sys_covered_types and g.object_name:
            continue
        key = (g.object_type, _norm_name(g.object_name or ""), g.privilege_type)
        if key not in existing:
            sys_grants.append(g)
            existing.add(key)
    return sys_grants
