"""SQL builder for GRANT/REVOKE statements (preview and execute share this).

Security model: the client sends only structured parameters. Privilege and
object-type keywords are allowlist-validated enums (grant_spec). Identifiers
are backtick-quoted via safe_identifier. User identities are parsed into
(user, host) parts and validated against strict patterns — deliberately NOT
sql_safety.safe_name, whose read-path allowlist (quotes/spaces) would let a
crafted grantee smuggle keywords like WITH GRANT OPTION into a write statement.

Validated against StarRocks 4.0.8: backticked identifiers are accepted in all
emitted positions; 3-part names are NOT (hence the SET CATALOG statement pair);
FUNCTION signatures must match the definition exactly.
"""

from __future__ import annotations

import re

from app.models.schemas import GranteeRef, GrantRequest
from app.services.shared.grant_spec import validate_object_shape, validate_privileges
from app.utils.sql_safety import safe_identifier

_USER_PART_RE = re.compile(r"\A[A-Za-z0-9_.-]+\Z")
_HOST_PART_RE = re.compile(r"\A[A-Za-z0-9_.%-]+\Z")
_ROLE_RE = re.compile(r"\A[A-Za-z0-9_.-]+\Z")
_QUOTED_IDENTITY_RE = re.compile(r"\A'([^']+)'@'([^']+)'\Z")
# Plain identifier (used where backtick quoting is not verified, e.g. FUNCTION db)
_PLAIN_IDENT_RE = re.compile(r"\A[A-Za-z0-9_]+\Z")
# Function signature: name(type, type, ...). Nested parens may contain only
# digits (sized types like VARCHAR(10)); angle brackets for ARRAY<INT> etc.
_SIG_TYPE = r"[A-Za-z0-9_]+(?:<[A-Za-z0-9_,<> ]*>)?(?:\(\s*\d+(?:\s*,\s*\d+)?\s*\))?"
_FUNC_SIG_RE = re.compile(rf"\A[A-Za-z0-9_]+\(\s*(?:{_SIG_TYPE}(?:\s*,\s*{_SIG_TYPE})*)?\s*\)\Z")

# object_type → SQL keyword in the ON clause
_OBJECT_KEYWORD = {
    "CATALOG": "CATALOG",
    "DATABASE": "DATABASE",
    "TABLE": "TABLE",
    "VIEW": "VIEW",
    "MATERIALIZED VIEW": "MATERIALIZED VIEW",
    "FUNCTION": "FUNCTION",
}


def parse_user_identity(raw: str) -> tuple[str, str]:
    """Parse a user identity into (user, host), accepting 'alice', 'alice@%',
    and the quoted 'alice'@'%' form. Raises ValueError on unsafe parts."""
    s = raw.strip()
    m = _QUOTED_IDENTITY_RE.match(s)
    if m:
        user, host = m.group(1), m.group(2)
    elif "@" in s:
        user, host = s.split("@", 1)
    else:
        user, host = s, "%"
    if not user or not _USER_PART_RE.match(user):
        raise ValueError(f"Invalid user name: {user!r}")
    if not host or not _HOST_PART_RE.match(host):
        raise ValueError(f"Invalid host part: {host!r}")
    return user, host


def _validate_role(name: str) -> str:
    if not name or not _ROLE_RE.match(name):
        raise ValueError(f"Invalid role name: {name!r}")
    return name


def format_grantee(grantee: GranteeRef) -> str:
    if grantee.type == "USER":
        user, host = parse_user_identity(grantee.name)
        return f"USER '{user}'@'{host}'"
    return f"ROLE `{_validate_role(grantee.name)}`"


def _format_object(object_type: str, database: str | None, name: str | None, catalog: str | None) -> str:
    keyword = _OBJECT_KEYWORD[object_type]
    if object_type == "CATALOG":
        return f"CATALOG `{safe_identifier(catalog or '')}`"
    if object_type == "DATABASE":
        return f"DATABASE `{safe_identifier(database or '')}`"
    if object_type == "FUNCTION":
        # Signature is emitted verbatim (validated structurally); db is unquoted
        # here (backticked db.fn(sig) is unverified on StarRocks), so it must be
        # a plain identifier.
        if not database or not _PLAIN_IDENT_RE.match(database):
            raise ValueError(f"Invalid database name for function grant: {database!r}")
        if not name or not _FUNC_SIG_RE.match(name):
            raise ValueError(f"Invalid function signature: {name!r}")
        return f"FUNCTION {database}.{name}"
    return f"{keyword} `{safe_identifier(database or '')}`.`{safe_identifier(name or '')}`"


def build_statements(req: GrantRequest) -> tuple[list[str], list[str]]:
    """Build the SQL statement sequence for a grant request.

    Returns (statements, warnings). Raises ValueError on validation failure.
    """
    grantee_sql = format_grantee(req.grantee)
    warnings: list[str] = []

    if req.type == "ROLE":
        if not req.role:
            raise ValueError("Role assignment requires a role")
        if req.object is not None or req.privileges:
            raise ValueError("Role assignment does not take object/privileges")
        if req.with_grant_option:
            raise ValueError("WITH GRANT OPTION does not apply to role assignment")
        role_sql = f"`{_validate_role(req.role)}`"
        if req.action == "GRANT":
            return [f"GRANT {role_sql} TO {grantee_sql}"], warnings
        return [f"REVOKE {role_sql} FROM {grantee_sql}"], warnings

    # type == PRIVILEGE
    if req.object is None:
        raise ValueError("Privilege grants require an object")
    if req.action == "REVOKE" and req.with_grant_option:
        raise ValueError("WITH GRANT OPTION does not apply to REVOKE")
    obj = req.object
    validate_object_shape(obj.object_type, obj.catalog, obj.database, obj.name)
    privileges = validate_privileges(obj.object_type, req.privileges)

    statements: list[str] = []
    # The GRANT parser rejects 3-part names; db-scoped objects resolve against
    # the connection's current catalog, so pin it explicitly.
    if obj.object_type != "CATALOG":
        statements.append(f"SET CATALOG `{safe_identifier(obj.catalog or '')}`")

    target = _format_object(obj.object_type, obj.database, obj.name, obj.catalog)
    priv_list = ", ".join(privileges)
    if req.action == "GRANT":
        suffix = " WITH GRANT OPTION" if req.with_grant_option else ""
        statements.append(f"GRANT {priv_list} ON {target} TO {grantee_sql}{suffix}")
    else:
        statements.append(f"REVOKE {priv_list} ON {target} FROM {grantee_sql}")

    if obj.object_type == "FUNCTION":
        warnings.append("Function grants require the signature to exactly match the definition (e.g. (INT,INT)).")
    return statements, warnings
