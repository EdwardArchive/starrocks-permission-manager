"""Pure functions and dataclasses for classifying privilege grants."""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum
from functools import cached_property

from app.models.schemas import PrivilegeGrant

# ══════════════════════════════════════════════════════════════════════
# Module-level constants
# ══════════════════════════════════════════════════════════════════════

_BUILTIN_ROLES = frozenset({"root", "db_admin", "user_admin", "cluster_admin", "security_admin", "public"})

_NON_OBJECT_TYPES = frozenset(
    {
        "SYSTEM",
        "USER",
        "ALL",
        "RESOURCE GROUP",
        "RESOURCE",
        "STORAGE VOLUME",
        "FAILOVER GROUP",
        "GLOBAL FUNCTION",
        "POLICY",
        "WAREHOUSE",
        "PIPE",
        "TASK",
    }
)

_SYSTEM_ONLY_PRIVS = frozenset(
    {
        "REPOSITORY",
        "NODE",
        "BLACKLIST",
        "FILE",
        "OPERATE",
        "PLUGIN",
        "CREATE RESOURCE GROUP",
        "CREATE RESOURCE",
        "CREATE EXTERNAL CATALOG",
        "CREATE GLOBAL FUNCTION",
        "CREATE STORAGE VOLUME",
        "SECURITY",
        "GRANT",
        "CREATE WAREHOUSE",
    }
)

_DB_ONLY_PRIVS = frozenset(
    {
        "CREATE TABLE",
        "CREATE VIEW",
        "CREATE FUNCTION",
        "CREATE MATERIALIZED VIEW",
        "CREATE PIPE",
        "CREATE MASKING POLICY",
        "CREATE ROW ACCESS POLICY",
    }
)

_WILDCARD_TYPE_MAP: dict[str, frozenset[str]] = {
    "TABLE": frozenset({"TABLE"}),
    "VIEW": frozenset({"VIEW"}),
    "MATERIALIZED VIEW": frozenset({"MATERIALIZED VIEW", "MV"}),
    "FUNCTION": frozenset({"FUNCTION"}),
    "DATABASE": frozenset({"TABLE", "VIEW", "MATERIALIZED VIEW", "MV", "FUNCTION", "DATABASE"}),
    "CATALOG": frozenset({"TABLE", "VIEW", "MATERIALIZED VIEW", "MV", "FUNCTION", "DATABASE", "CATALOG"}),
}


# ══════════════════════════════════════════════════════════════════════
# Query context + Grant classification
# ══════════════════════════════════════════════════════════════════════


@dataclass(frozen=True)
class ObjectQuery:
    """Encapsulates the query parameters for object privilege lookups."""

    catalog: str | None
    database: str | None
    name: str | None
    object_type: str | None

    @cached_property
    def type_upper(self) -> str:
        return (self.object_type or "").upper()

    @cached_property
    def is_system(self) -> bool:
        return self.type_upper == "SYSTEM"

    @cached_property
    def is_scope_query(self) -> bool:
        return self.type_upper in ("DATABASE", "CATALOG") and not self.name

    @cached_property
    def child_types(self) -> frozenset[str]:
        if self.type_upper == "DATABASE":
            return frozenset({"TABLE", "VIEW", "MATERIALIZED VIEW", "FUNCTION"})
        if self.type_upper == "CATALOG":
            return frozenset({"TABLE", "VIEW", "MATERIALIZED VIEW", "FUNCTION", "DATABASE"})
        return frozenset()


class Relevance(Enum):
    EXACT = "exact"
    PARENT_SCOPE = "parent"
    IMPLICIT_USAGE = "usage"
    IRRELEVANT = "irrelevant"


def classify_grant(g: PrivilegeGrant, q: ObjectQuery) -> Relevance:
    """Single-pass classification of how a grant relates to the query."""
    otype = (g.object_type or "").upper()
    gc, gd, gn = g.object_catalog, g.object_database, g.object_name

    # ── SYSTEM handling ──
    if q.is_system:
        return Relevance.EXACT if otype == "SYSTEM" else Relevance.IRRELEVANT
    priv_upper = g.privilege_type.upper()
    # Allow CREATE X privileges to pass through to their target type queries
    _SYSTEM_CREATE_MAP = {
        "CREATE RESOURCE GROUP": "RESOURCE GROUP",
        "CREATE RESOURCE": "RESOURCE",
        "CREATE EXTERNAL CATALOG": "CATALOG",
        "CREATE STORAGE VOLUME": "STORAGE VOLUME",
        "CREATE WAREHOUSE": "WAREHOUSE",
        "CREATE GLOBAL FUNCTION": "GLOBAL FUNCTION",
    }
    system_create_target = _SYSTEM_CREATE_MAP.get(priv_upper)
    if system_create_target and q.type_upper == system_create_target:
        return Relevance.PARENT_SCOPE
    if otype == "SYSTEM" or priv_upper in _SYSTEM_ONLY_PRIVS:
        return Relevance.IRRELEVANT

    # ── Non-object types (USER, RESOURCE GROUP, STORAGE VOLUME, etc.) ──
    if otype in _NON_OBJECT_TYPES:
        if q.type_upper != otype:
            return Relevance.IRRELEVANT
        # Type matches — check name if both grant and query specify one
        if gn and q.name and gn != q.name:
            return Relevance.IRRELEVANT
        # Wildcard grant (no name) → PARENT_SCOPE, exact name match → EXACT
        return Relevance.EXACT if gn or not q.name else Relevance.PARENT_SCOPE

    # ── Scope query (DATABASE/CATALOG without name): child grants → USAGE ──
    if q.is_scope_query and otype in q.child_types and _scope_matches(gc, gd, gn, q):
        return Relevance.IMPLICIT_USAGE

    # ── Named object: filter DB-only DDL unless CREATE matches the queried object type ──
    if q.name:
        priv_upper = g.privilege_type.upper()
        if otype == "DATABASE" and priv_upper in _DB_ONLY_PRIVS:
            # Allow CREATE X if queried object type matches X
            _CREATE_TYPE_MAP = {
                "CREATE TABLE": "TABLE",
                "CREATE VIEW": "VIEW",
                "CREATE MATERIALIZED VIEW": "MATERIALIZED VIEW",
                "CREATE FUNCTION": "FUNCTION",
                "CREATE PIPE": "PIPE",
            }
            create_target = _CREATE_TYPE_MAP.get(priv_upper)
            if not create_target or create_target != q.type_upper:
                return Relevance.IRRELEVANT
            # CREATE matched — skip further wildcard type checks
            return Relevance.PARENT_SCOPE
        if q.type_upper and not gn:
            allowed = _WILDCARD_TYPE_MAP.get(otype, frozenset())
            if allowed and q.type_upper not in allowed:
                return Relevance.IRRELEVANT

    # ── Wildcard grants (no coordinates but has type) ──
    if not gc and not gd and not gn and otype:
        if q.type_upper:
            allowed = _WILDCARD_TYPE_MAP.get(otype, frozenset())
            if allowed and q.type_upper not in allowed:
                return Relevance.IRRELEVANT
        return Relevance.PARENT_SCOPE

    # ── Scope matching ──
    if _scope_matches(gc, gd, gn, q):
        # For named objects: verify grant type is compatible with queried type
        if gn and q.type_upper and otype:
            allowed = _WILDCARD_TYPE_MAP.get(otype, frozenset())
            # If otype has a wildcard map and queried type is NOT in it, reject
            if allowed and q.type_upper not in allowed:
                return Relevance.IRRELEVANT
        return Relevance.EXACT if gn else Relevance.PARENT_SCOPE

    return Relevance.IRRELEVANT


def _scope_matches(gc: str | None, gd: str | None, gn: str | None, q: ObjectQuery) -> bool:
    if gc and q.catalog and gc != q.catalog:
        return False
    if gd and q.database and gd != q.database:
        return False
    if gn and q.name and gn != q.name:
        return False
    return True


def _make_inherited_grant(
    grantee: str,
    grantee_type: str,
    privilege_type: str,
    q: ObjectQuery,
    source: str,
    original_object_type: str | None = None,
) -> PrivilegeGrant:
    """Create a PrivilegeGrant for an inherited role/user.
    Uses the original grant's object_type so classify_grant can correctly classify it."""
    return PrivilegeGrant(
        grantee=grantee,
        grantee_type=grantee_type,
        object_catalog=q.catalog,
        object_database=q.database,
        object_name=q.name,
        object_type=original_object_type or q.type_upper or "TABLE",
        privilege_type=privilege_type,
        is_grantable=False,
        source=source,
    )


# ══════════════════════════════════════════════════════════════════════
# Shared post-processing
# ══════════════════════════════════════════════════════════════════════


def _convert_implicit_usage(results: list[PrivilegeGrant], q: ObjectQuery) -> list[PrivilegeGrant]:
    """For DATABASE/CATALOG queries: convert child-scope grants to implicit USAGE."""
    if not q.is_scope_query:
        return results
    converted: set[str] = set()
    out: list[PrivilegeGrant] = []
    for r in results:
        if (r.object_type or "").upper() in q.child_types:
            if r.grantee not in converted:
                converted.add(r.grantee)
                out.append(
                    PrivilegeGrant(
                        grantee=r.grantee,
                        grantee_type=r.grantee_type,
                        object_catalog=q.catalog,
                        object_database=q.database,
                        object_name=None,
                        object_type=q.type_upper,
                        privilege_type="USAGE",
                        is_grantable=False,
                        source=r.source + " (implicit)",
                    )
                )
        else:
            out.append(r)
    return out


def _deduplicate(results: list[PrivilegeGrant]) -> list[PrivilegeGrant]:
    seen: set[tuple] = set()
    unique: list[PrivilegeGrant] = []
    for r in results:
        key = (
            r.grantee,
            r.grantee_type,
            r.object_type,
            r.object_catalog or "",
            r.object_database or "",
            r.object_name or "",
            r.privilege_type,
        )
        if key not in seen:
            seen.add(key)
            unique.append(r)
    return unique
