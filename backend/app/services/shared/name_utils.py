"""Shared name normalization utilities."""

from __future__ import annotations


def normalize_fn_name(name: str) -> str:
    """Strip function signature parentheses: 'fn(VARCHAR)' → 'fn'."""
    return name.split("(")[0] if "(" in name else name
