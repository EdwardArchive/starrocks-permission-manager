"""Case-tolerant access for SHOW/driver result rows."""

from __future__ import annotations

from typing import Any


def col(row: dict, name: str) -> Any:
    """Case-tolerant column access for SHOW/driver rows.

    Returns ``row[name]`` or, if falsy/absent, ``row[name.lower()]``. Preserves the
    exact ``or`` falls-through semantics of the idiom it replaces: a falsy value stored
    under the TitleCase key (e.g. ``""``) falls through to the lowercase key.
    """
    return row.get(name) or row.get(name.lower())
