"""
SQL safety utilities for queries that cannot use parameterized binding.

StarRocks SHOW commands (SHOW GRANTS FOR, SHOW FUNCTIONS FROM, etc.)
do not support parameterized queries. These helpers sanitize user input
before interpolation to prevent SQL injection.
"""

from __future__ import annotations

import re

from app.services.starrocks_client import execute_query

# A single quote is the only character that can break out of a single-quoted
# SQL string literal, so it is NOT allowed in a bare name. It is permitted ONLY
# in the exact 'user'@'host' shape, where both parts are themselves quote-free —
# that keeps the literal balanced and prevents breakout (e.g. "kate'@'%").
_BARE_NAME_RE = re.compile(r"\A[a-zA-Z0-9_@%. -]+\Z")
_QUOTED_USER_RE = re.compile(r"\A'[^'`]+'@'[^'`]+'\Z")


def safe_name(value: str) -> str:
    """Validate a user/role name for interpolation into SHOW GRANTS FOR.

    Accepts either a bare identifier (wrapped in '...' by the caller) or an
    already-quoted 'user'@'host' grantee. Both forms are guaranteed free of an
    unbalanced single quote, so they cannot break out of the SQL string literal.

    Raises ValueError otherwise.
    """
    if value and (_BARE_NAME_RE.match(value) or _QUOTED_USER_RE.match(value)):
        return value
    raise ValueError(f"Invalid identifier: {value!r}")


def safe_identifier(value: str) -> str:
    """Escape a value for use inside backtick-quoted SQL identifiers.

    Escapes any backtick characters within the value to prevent
    breaking out of `identifier` quoting.
    """
    return value.replace("`", "``")


def set_catalog(conn, name: str) -> None:
    """Switch the session's active catalog to ``name`` on ``conn``.

    ``name`` is backtick-escaped via :func:`safe_identifier` so a name
    containing a backtick cannot break out of the identifier quoting.
    """
    execute_query(conn, f"SET CATALOG `{safe_identifier(name)}`")


def restore_default_catalog(conn) -> None:
    """Restore the session's active catalog to ``default_catalog`` on ``conn``."""
    execute_query(conn, "SET CATALOG `default_catalog`")
