"""Functions for parsing SHOW GRANTS output and sys table rows into PrivilegeGrant objects."""

from __future__ import annotations

import logging
import re
from collections.abc import Iterator

from app.models.schemas import PrivilegeGrant
from app.services.shared.row_utils import col
from app.services.starrocks_client import execute_query
from app.utils.sql_safety import safe_name

logger = logging.getLogger("privileges")

# ── Compiled regex patterns for GRANT statement parsing ──
_RE_GRANT_ON = re.compile(r"GRANT\s+(.+?)\s+ON\s+(.+?)\s+TO\s+", re.I)
_RE_ALL_IN_DB = re.compile(r"ALL\s+(\w+(?:\s+\w+)*?)S?\s+IN\s+(?:ALL\s+DATABASES|DATABASE\s+(\S+))", re.I)
_RE_TYPE_PATH = re.compile(r"(\w+(?:\s+\w+)*?)\s+(`[^`]+`(?:\.`[^`]+`)*|[\w.*]+(?:\.[\w.*]+)*)", re.I)


def iter_grant_statements(rows: list[dict]) -> Iterator[tuple[dict, str]]:
    """Shared raw row-walk over a SHOW GRANTS result set.

    Yields ``(row, statement)`` for every cell whose string value is a GRANT
    statement. Consumed by :func:`_parse_show_grants` (which fills catalog context
    from the row) and :func:`app.utils.role_helpers.parse_role_assignments` (which
    filters role-assignment lines) — each keeps its own downstream logic.
    """
    for row in rows:
        for val in row.values():
            s = str(val)
            if s.upper().startswith("GRANT"):
                yield row, s


def _parse_show_grants(conn, grantee: str, grantee_type: str) -> list[PrivilegeGrant]:
    results = []
    try:
        if grantee_type == "USER":
            if "@" in grantee:
                rows = execute_query(conn, f"SHOW GRANTS FOR {safe_name(grantee)}")
            else:
                rows = execute_query(conn, f"SHOW GRANTS FOR '{safe_name(grantee)}'")
        else:
            rows = execute_query(conn, f"SHOW GRANTS FOR ROLE '{safe_name(grantee)}'")
        for row, s in iter_grant_statements(rows):
            # SHOW GRANTS has a Catalog column indicating the catalog context
            row_catalog = col(row, "Catalog") or None
            parsed = _parse_grant_statement(s, grantee, grantee_type)
            # Fill in catalog from row context if not set by parsing
            if row_catalog:
                _NON_CATALOG_TYPES = {
                    "SYSTEM",
                    "GLOBAL FUNCTION",
                    "STORAGE VOLUME",
                    "RESOURCE GROUP",
                    "RESOURCE",
                    "WAREHOUSE",
                    "USER",
                    "",
                }
                for g in parsed:
                    if not g.object_catalog and g.object_type not in _NON_CATALOG_TYPES:
                        g.object_catalog = row_catalog
            results.extend(parsed)
    except Exception as e:
        logger.warning(f"SHOW GRANTS failed for {grantee_type} {grantee}: {e}")
    return results


def _parse_on_clause(on_part: str) -> tuple[str, str, str | None]:
    """Interpret the ``ON <...>`` portion of a GRANT statement.

    Returns ``(obj_type, obj_path, scoped_database)`` — handling the
    ``ALL … IN DATABASE`` / ``ALL …`` forms, multi-word object types, and the
    generic ``<type> <path>`` shape.
    """
    obj_type = "SYSTEM"
    obj_path = ""
    scoped_database = None

    all_in_db_match = _RE_ALL_IN_DB.match(on_part)
    if all_in_db_match:
        obj_type = all_in_db_match.group(1).upper()
        db_name = all_in_db_match.group(2)
        if db_name:
            scoped_database = db_name.replace("`", "")
    else:
        all_simple = re.match(r"ALL\s+(\w+(?:\s+\w+)*)", on_part, re.I)
        if all_simple:
            obj_type = all_simple.group(1).upper().rstrip("S")
        else:
            # Handle multi-word types first (STORAGE VOLUME, GLOBAL FUNCTION, RESOURCE GROUP)
            _MULTI_WORD_TYPES = [
                "STORAGE VOLUME",
                "GLOBAL FUNCTION",
                "RESOURCE GROUP",
                "MATERIALIZED VIEW",
                "FAILOVER GROUP",
            ]
            multi_match = None
            for mwt in _MULTI_WORD_TYPES:
                if on_part.upper().startswith(mwt):
                    obj_type = mwt
                    obj_path = on_part[len(mwt) :].strip().replace("`", "")
                    multi_match = True
                    break
            if not multi_match:
                on_match = _RE_TYPE_PATH.match(on_part)
                if on_match:
                    obj_type = on_match.group(1).upper()
                    obj_path = on_match.group(2).strip().replace("`", "")
                else:
                    obj_type = on_part.upper()
    return obj_type, obj_path, scoped_database


def _normalize_object_type(obj_type: str) -> str:
    """Map a raw object-type token to its canonical name (POLICY for masking/row-access)."""
    _TYPE_MAP = [
        ("MATERIALIZED VIEW", "MATERIALIZED VIEW"),
        ("GLOBAL FUNCTION", "GLOBAL FUNCTION"),
        ("STORAGE VOLUME", "STORAGE VOLUME"),
        ("RESOURCE GROUP", "RESOURCE GROUP"),
        ("FAILOVER GROUP", "FAILOVER GROUP"),
        ("TABLE", "TABLE"),
        ("DATABASE", "DATABASE"),
        ("VIEW", "VIEW"),
        ("FUNCTION", "FUNCTION"),
        ("CATALOG", "CATALOG"),
        ("RESOURCE", "RESOURCE"),
        ("WAREHOUSE", "WAREHOUSE"),
        ("USER", "USER"),
        ("FAILOVER", "FAILOVER GROUP"),
    ]
    for keyword, normalized in _TYPE_MAP:
        if keyword in obj_type:
            obj_type = normalized
            break
    if "MASKING" in obj_type or "ROW ACCESS" in obj_type:
        obj_type = "POLICY"
    return obj_type


def _split_object_path(obj_type: str, obj_path: str) -> tuple[str | None, str | None, str | None]:
    """Split a dotted object path into ``(catalog, database, name)`` by part count.

    2-part paths resolve differently for object-level types (``database.name``) vs
    scope-level types (``catalog.database``); ``*`` segments become ``None``.
    """
    parts = obj_path.split(".") if obj_path else []
    catalog: str | None
    database: str | None
    name: str | None
    if len(parts) == 3:
        catalog, database, name = parts[0], parts[1], parts[2]
        if catalog == "*":
            catalog = None
        if database == "*":
            database = None
        if name == "*":
            name = None
    elif len(parts) == 2:
        # 2-part path: for TABLE/VIEW/MV/FUNCTION → database.name; for others → catalog.database
        _OBJECT_LEVEL_TYPES = {"TABLE", "VIEW", "MATERIALIZED VIEW", "FUNCTION"}
        if obj_type in _OBJECT_LEVEL_TYPES:
            catalog, database, name = None, parts[0], parts[1]
        else:
            catalog, database, name = parts[0], parts[1] if parts[1] != "*" else None, None
    elif len(parts) == 1 and parts[0] != "*":
        catalog, database, name = parts[0], None, None
    else:
        catalog = database = name = None
    return catalog, database, name


def _apply_scope_overrides(
    obj_type: str,
    obj_path: str,
    catalog: str | None,
    database: str | None,
    name: str | None,
    scoped_database: str | None,
) -> tuple[str | None, str | None, str | None]:
    """Adjust ``(catalog, database, name)`` for scoped-DB, ``ON DATABASE X`` and
    system-object special cases."""
    if scoped_database:
        database = scoped_database
        catalog = None
    # "ON DATABASE X" → X is database, not catalog
    elif obj_type == "DATABASE" and catalog and not database:
        database = catalog
        catalog = None
    # System objects: path is the object name, not catalog
    elif (
        obj_type
        in (
            "STORAGE VOLUME",
            "GLOBAL FUNCTION",
            "RESOURCE GROUP",
            "WAREHOUSE",
            "RESOURCE",
            "PIPE",
            "USER",
        )
        and catalog
        and not database
    ):
        name = obj_path  # preserve full path (e.g. "gfn_mask_email(VARCHAR(65533))")
        catalog = None
    return catalog, database, name


def _parse_grant_statement(stmt: str, grantee: str, grantee_type: str) -> list[PrivilegeGrant]:
    """Best-effort parse of various GRANT statement formats."""
    grants: list[PrivilegeGrant] = []
    m = _RE_GRANT_ON.match(stmt)
    if not m:
        return grants

    priv_str = m.group(1).strip()
    on_part = m.group(2).strip()
    privs = [p.strip() for p in priv_str.split(",")]

    obj_type, obj_path, scoped_database = _parse_on_clause(on_part)
    obj_type = _normalize_object_type(obj_type)
    catalog, database, name = _split_object_path(obj_type, obj_path)
    catalog, database, name = _apply_scope_overrides(obj_type, obj_path, catalog, database, name, scoped_database)

    for priv in privs:
        priv = priv.strip()
        if priv:
            grants.append(
                PrivilegeGrant(
                    grantee=grantee,
                    grantee_type=grantee_type,
                    object_catalog=catalog,
                    object_database=database,
                    object_name=name,
                    object_type=obj_type,
                    privilege_type=priv,
                )
            )
    return grants


def _row_to_grants(r: dict, grantee_type: str) -> list[PrivilegeGrant]:
    def _get(keys):
        for k in keys:
            if k in r and r[k] is not None:
                return str(r[k])
        return None

    priv_str = _get(["PRIVILEGE_TYPE", "privilege_type"]) or ""
    privs = [p.strip() for p in priv_str.split(",") if p.strip()] or [priv_str]
    base = dict(
        grantee=_get(["GRANTEE", "grantee"]) or "",
        grantee_type=grantee_type,
        object_catalog=_get(["OBJECT_CATALOG", "object_catalog"]),
        object_database=_get(["OBJECT_DATABASE", "object_database"]),
        object_name=_get(["OBJECT_NAME", "object_name"]),
        object_type=_get(["OBJECT_TYPE", "object_type"]) or "",
        is_grantable=str(_get(["IS_GRANTABLE", "is_grantable"])).upper() == "YES",
    )
    return [PrivilegeGrant(**base, privilege_type=p) for p in privs]
