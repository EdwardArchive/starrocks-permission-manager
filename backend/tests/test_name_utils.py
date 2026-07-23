"""Unit tests for normalize_fn_name."""

from __future__ import annotations

from app.services.shared.name_utils import normalize_fn_name


class TestNormalizeFnName:
    def test_strips_single_arg_signature(self):
        assert normalize_fn_name("parse_ua(VARCHAR)") == "parse_ua"

    def test_strips_multi_arg_signature(self):
        assert normalize_fn_name("my_fn(VARCHAR, INT)") == "my_fn"

    def test_bare_name_unchanged(self):
        assert normalize_fn_name("my_fn") == "my_fn"

    def test_empty_parens(self):
        assert normalize_fn_name("my_fn()") == "my_fn"

    def test_empty_string(self):
        assert normalize_fn_name("") == ""

    def test_case_preserved(self):
        assert normalize_fn_name("MyFn(INT)") == "MyFn"

    def test_whitespace_before_paren_preserved(self):
        # split("(") does not strip — pins current behavior.
        assert normalize_fn_name("my_fn (INT)") == "my_fn "

    def test_only_first_paren_splits(self):
        assert normalize_fn_name("a(b)(c)") == "a"

    def test_leading_paren_yields_empty(self):
        assert normalize_fn_name("(weird)") == ""
