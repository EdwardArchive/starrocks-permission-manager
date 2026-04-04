"""
Layer 2: Grant resolution and filtering.

Takes a CollectedGrants and answers specific endpoint queries:
- for_user(): direct grants for a user
- for_user_effective(): all grants including role inheritance
- for_role(): role grants including parent inheritance
- for_object(): object-scoped grants with BFS inheritance + classification

Single source of truth — replaces the scattered resolution logic in
privileges.py (get_user_privileges, get_user_effective_privileges,
get_role_privileges, get_object_privileges, _object_privs_via_grants).
"""

from __future__ import annotations

import logging

from app.models.schemas import PrivilegeGrant
from app.services.admin.bfs_resolver import (
    _bfs_child_roles,
    _bfs_user_privs,
    _finalize,
    _find_ancestors_with_grants,
)
from app.services.common.grant_classifier import (
    ObjectQuery,
    Relevance,
    _make_inherited_grant,
    classify_grant,
)
from app.services.grant_collector import CollectedGrants
from app.utils.role_helpers import get_parent_roles

logger = logging.getLogger("privileges")


class GrantResolver:
    """Filters and resolves grants from CollectedGrants for specific queries."""

    def __init__(self, collected: CollectedGrants, conn=None):
        self._c = collected
        self._conn = conn

    # ── /user/{name} ──

    def for_user(self, username: str) -> list[PrivilegeGrant]:
        """Direct grants for a specific user."""
        return [g for g in self._c.grants if g.grantee == username and g.grantee_type == "USER"]

    # ── /user/{name}/effective ──

    def for_user_effective(self, username: str) -> list[PrivilegeGrant]:
        """All grants including inherited through role chain."""
        results: list[PrivilegeGrant] = []

        # Direct user grants
        for g in self._c.grants:
            if g.grantee == username and g.grantee_type == "USER":
                g.source = "direct"
                results.append(g)

        # Role chain grants with source attribution
        role_chain = self._c.user_role_chain
        for role, origin in role_chain.items():
            for g in self._c.grants:
                if g.grantee == role and g.grantee_type == "ROLE":
                    g.source = origin if origin != role else role
                    results.append(g)

        return results

    # ── /role/{name} ──

    def for_role(self, rolename: str) -> list[PrivilegeGrant]:
        """Grants for a role including inherited from parent roles."""
        results: list[PrivilegeGrant] = []

        # Direct role grants
        for g in self._c.grants:
            if g.grantee == rolename and g.grantee_type == "ROLE":
                g.source = "direct"
                results.append(g)

        # BFS upward through parent roles
        visited = {rolename}
        parents = get_parent_roles(self._conn, rolename) if self._conn else []
        queue: list[tuple[str, str]] = [(p, p) for p in parents]
        while queue and len(visited) < 100:
            parent, origin = queue.pop(0)
            if parent in visited:
                continue
            visited.add(parent)
            for g in self._c.grants:
                if g.grantee == parent and g.grantee_type == "ROLE":
                    g.source = origin
                    results.append(g)
            if self._conn:
                queue.extend((gp, origin) for gp in get_parent_roles(self._conn, parent))

        return results

    # ── /object ──

    def for_object(self, q: ObjectQuery) -> list[PrivilegeGrant]:
        """Object-scoped grants with classification + BFS inheritance.
        Works for both admin and non-admin (collector handles the data split)."""
        # Step 1: Classify all collected grants against this query
        classified: list[tuple[PrivilegeGrant, Relevance]] = []
        for g in self._c.grants:
            rel = classify_grant(g, q)
            if rel != Relevance.IRRELEVANT:
                classified.append((g, rel))

        # Step 2: BFS downward — find inheriting child roles
        role_privs: dict[str, set[str]] = {}
        priv_orig_type: dict[str, str] = {}
        for g, _ in classified:
            if g.grantee_type == "ROLE":
                role_privs.setdefault(g.grantee, set()).add(g.privilege_type)
                priv_orig_type.setdefault(g.privilege_type, g.object_type or "")

        if role_privs and self._c.role_child_map:
            inherited = _bfs_child_roles(role_privs, self._c.role_child_map)
            existing_roles = {g.grantee for g, _ in classified if g.grantee_type == "ROLE"}
            for child, (privs, origin) in inherited.items():
                if child in existing_roles:
                    continue
                existing_roles.add(child)
                role_privs[child] = privs
                for priv in privs:
                    ig = _make_inherited_grant(
                        child,
                        "ROLE",
                        priv,
                        q,
                        source=origin,
                        original_object_type=priv_orig_type.get(priv),
                    )
                    classified.append((ig, classify_grant(ig, q)))

        # Step 3: BFS — find users with inherited access
        if role_privs and self._c.all_users:
            existing_users = {g.grantee for g, _ in classified if g.grantee_type == "USER"}
            for user in self._c.all_users - existing_users:
                if not self._conn:
                    continue
                user_privs = _bfs_user_privs(self._conn, user, role_privs)
                for priv, src in user_privs.items():
                    ig = _make_inherited_grant(
                        user,
                        "USER",
                        priv,
                        q,
                        source=src,
                        original_object_type=priv_orig_type.get(priv),
                    )
                    classified.append((ig, classify_grant(ig, q)))

        # Step 4: Non-admin specific — intermediate role inheritance + user accumulation
        if not self._c.all_users and self._c.user_role_chain:
            classified = self._resolve_non_admin_inheritance(classified, q)

        # Step 5: Finalize (USAGE conversion + dedup)
        return _finalize(classified, q)

    def _resolve_non_admin_inheritance(
        self,
        classified: list[tuple[PrivilegeGrant, Relevance]],
        q: ObjectQuery,
    ) -> list[tuple[PrivilegeGrant, Relevance]]:
        """For non-admin: add intermediate roles + user as inherited grantee."""
        role_grants_map: dict[str, list[PrivilegeGrant]] = {}
        for g, _ in classified:
            if g.grantee_type == "ROLE":
                role_grants_map.setdefault(g.grantee, []).append(g)

        role_chain = self._c.user_role_chain
        visited = set(role_chain.keys())

        # Add intermediate roles that inherit from grant-holding roles
        for role in visited:
            if role in role_grants_map:
                continue
            if not self._conn:
                continue
            for ancestor in _find_ancestors_with_grants(self._conn, role, role_grants_map):
                for g in role_grants_map[ancestor]:
                    ig = _make_inherited_grant(
                        role,
                        "ROLE",
                        g.privilege_type,
                        q,
                        source=ancestor,
                        original_object_type=g.object_type,
                    )
                    classified.append((ig, classify_grant(ig, q)))

        # Add current user as inherited grantee
        all_privs: dict[str, tuple[str, str]] = {}
        for role, grants in role_grants_map.items():
            for g in grants:
                all_privs.setdefault(g.privilege_type, (role_chain.get(role, role), g.object_type or ""))

        # Find the username from user grants in collected data
        user_grantees = {g.grantee for g in self._c.grants if g.grantee_type == "USER"}
        username = next(iter(user_grantees), None)
        if username:
            for priv, (src, orig_type) in all_privs.items():
                ig = _make_inherited_grant(
                    username,
                    "USER",
                    priv,
                    q,
                    source=src,
                    original_object_type=orig_type,
                )
                classified.append((ig, classify_grant(ig, q)))

        return classified
