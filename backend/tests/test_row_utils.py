"""Unit tests for col() — case-tolerant row access with falsy-falls-through."""

from __future__ import annotations

import pytest
from app.services.shared.row_utils import col


@pytest.mark.parametrize(
    ("row", "name", "expected"),
    [
        # TitleCase hit
        ({"Name": "alice"}, "Name", "alice"),
        # TitleCase wins over lowercase when truthy (short-circuits before fallback)
        ({"Name": "alice", "name": "bob"}, "Name", "alice"),
        # lowercase fallback when TitleCase absent
        ({"name": "bob"}, "Name", "bob"),
        # multi-word key: name.lower() drives the fallback lookup
        ({"table_name": "events"}, "TABLE_NAME", "events"),
        # falsy-falls-through: empty string under TitleCase → lowercase value returned
        ({"Name": "", "name": "bob"}, "Name", "bob"),
        # None under TitleCase → lowercase value returned
        ({"Name": None, "name": "bob"}, "Name", "bob"),
        # both missing → None
        ({}, "Name", None),
        # both falsy (empty strings) → second falsy value ("") — pins exact `or` result
        ({"Name": "", "name": ""}, "Name", ""),
        # both falsy (0 then None) → None (the second operand)
        ({"Name": 0, "name": None}, "Name", None),
        # both falsy (None then 0) → 0 (the second operand)
        ({"Name": None, "name": 0}, "Name", 0),
    ],
)
def test_col(row: dict, name: str, expected: object) -> None:
    assert col(row, name) == expected


def test_col_none_when_both_absent() -> None:
    # `== None` in the table can't distinguish None from a missing key; pin `is None`.
    assert col({}, "Name") is None
