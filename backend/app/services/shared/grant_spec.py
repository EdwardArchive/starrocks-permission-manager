"""Object type → grantable privileges allowlist for the GRANT/REVOKE feature.

Derived from the official StarRocks GRANT documentation (NOT PRD §2.3, which
has errors — FUNCTION privileges are USAGE | DROP, not EXECUTE). Validated
against a live StarRocks 4.0.8 cluster (see docs/GRANT_REVOKE_DESIGN.md §1).

First-cut object types only: SYSTEM, USER (IMPERSONATE), RESOURCE GROUP,
STORAGE VOLUME and GLOBAL FUNCTION are deferred (different statement shapes).
"""

from __future__ import annotations

# object_type → allowed privilege keywords (enum values, never interpolated raw)
GRANTABLE_PRIVILEGES: dict[str, frozenset[str]] = {
    "CATALOG": frozenset({"USAGE", "CREATE DATABASE", "DROP", "ALL"}),
    "DATABASE": frozenset(
        {
            "CREATE TABLE",
            "CREATE VIEW",
            "CREATE FUNCTION",
            "CREATE MATERIALIZED VIEW",
            "ALTER",
            "DROP",
            "ALL",
        }
    ),
    "TABLE": frozenset({"SELECT", "INSERT", "UPDATE", "DELETE", "ALTER", "DROP", "EXPORT", "ALL"}),
    "VIEW": frozenset({"SELECT", "ALTER", "DROP", "ALL"}),
    "MATERIALIZED VIEW": frozenset({"SELECT", "ALTER", "REFRESH", "DROP", "ALL"}),
    "FUNCTION": frozenset({"USAGE", "DROP", "ALL"}),
}

# Which object reference fields each object_type requires.
# (catalog, database, name) — True = required, False = must be absent
OBJECT_SHAPE: dict[str, tuple[bool, bool, bool]] = {
    "CATALOG": (True, False, False),
    "DATABASE": (True, True, False),
    "TABLE": (True, True, True),
    "VIEW": (True, True, True),
    "MATERIALIZED VIEW": (True, True, True),
    "FUNCTION": (True, True, True),  # name carries the full signature, e.g. my_udf(int,int)
}


def validate_privileges(object_type: str, privileges: list[str]) -> list[str]:
    """Validate privilege keywords against the allowlist. Returns normalized list.

    Raises ValueError on unknown object_type, empty list, or disallowed privilege.
    """
    allowed = GRANTABLE_PRIVILEGES.get(object_type)
    if allowed is None:
        raise ValueError(f"Unsupported object type: {object_type!r}")
    if not privileges:
        raise ValueError("At least one privilege is required")
    normalized = []
    for priv in privileges:
        p = " ".join(priv.upper().split())
        if p not in allowed:
            raise ValueError(f"Privilege {priv!r} is not grantable on {object_type}")
        if p not in normalized:
            normalized.append(p)
    return normalized


def validate_object_shape(object_type: str, catalog: str | None, database: str | None, name: str | None) -> None:
    """Ensure the object reference carries exactly the fields its type requires."""
    shape = OBJECT_SHAPE.get(object_type)
    if shape is None:
        raise ValueError(f"Unsupported object type: {object_type!r}")
    for field_name, required, value in zip(
        ("catalog", "database", "name"), shape, (catalog, database, name), strict=True
    ):
        if required and not value:
            raise ValueError(f"{object_type} grants require {field_name}")
        if not required and value:
            raise ValueError(f"{object_type} grants do not take {field_name}")
