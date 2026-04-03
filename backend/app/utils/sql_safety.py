"""
SQL safety utilities for queries that cannot use parameterized binding.

StarRocks SHOW commands (SHOW GRANTS FOR, SHOW FUNCTIONS FROM, etc.)
do not support parameterized queries. These helpers sanitize user input
before interpolation to prevent SQL injection.
"""

from __future__ import annotations

import re

# Allowed characters for StarRocks identifiers: alphanumeric, underscore, @, %, .
# Covers usernames like 'root'@'%' and role names like 'db_admin'
_SAFE_NAME_RE = re.compile(r"\A[a-zA-Z0-9_@%.' -]+\Z")


def safe_name(value: str) -> str:
    """Validate a user/role name for use in SHOW GRANTS FOR 'name'.

    Raises ValueError if the name contains unsafe characters.
    """
    if not value or not _SAFE_NAME_RE.match(value):
        raise ValueError(f"Invalid identifier: {value!r}")
    return value


def safe_identifier(value: str) -> str:
    """Escape a value for use inside backtick-quoted SQL identifiers.

    Escapes any backtick characters within the value to prevent
    breaking out of `identifier` quoting.
    """
    return value.replace("`", "``")
