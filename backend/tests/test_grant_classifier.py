"""Unit tests for app.services.common.grant_classifier."""

from __future__ import annotations

from app.models.schemas import PrivilegeGrant
from app.services.common.grant_classifier import (
    ObjectQuery,
    Relevance,
    _deduplicate,
    _scope_matches,
    classify_grant,
)


# ── Helper ──


def _grant(**kw) -> PrivilegeGrant:
    defaults = dict(
        grantee="u",
        grantee_type="USER",
        object_catalog=None,
        object_database=None,
        object_name=None,
        object_type="TABLE",
        privilege_type="SELECT",
        is_grantable=False,
        source="direct",
    )
    return PrivilegeGrant(**{**defaults, **kw})


# ── classify_grant tests ──


def test_system_query_system_grant_is_exact():
    """SYSTEM query + SYSTEM grant -> EXACT."""
    g = _grant(object_type="SYSTEM", privilege_type="OPERATE")
    q = ObjectQuery(catalog=None, database=None, name=None, object_type="SYSTEM")
    assert classify_grant(g, q) == Relevance.EXACT


def test_system_query_table_grant_is_irrelevant():
    """SYSTEM query + TABLE grant -> IRRELEVANT."""
    g = _grant(object_type="TABLE", privilege_type="SELECT")
    q = ObjectQuery(catalog=None, database=None, name=None, object_type="SYSTEM")
    assert classify_grant(g, q) == Relevance.IRRELEVANT


def test_non_object_type_exact_name_match():
    """Non-object type (STORAGE VOLUME) exact name match -> EXACT."""
    g = _grant(object_type="STORAGE VOLUME", object_name="my_vol", privilege_type="USAGE")
    q = ObjectQuery(catalog=None, database=None, name="my_vol", object_type="STORAGE VOLUME")
    assert classify_grant(g, q) == Relevance.EXACT


def test_non_object_type_wildcard_no_name_is_parent_scope():
    """Non-object type wildcard (no name on grant) -> PARENT_SCOPE."""
    g = _grant(object_type="STORAGE VOLUME", object_name=None, privilege_type="USAGE")
    q = ObjectQuery(catalog=None, database=None, name="my_vol", object_type="STORAGE VOLUME")
    assert classify_grant(g, q) == Relevance.PARENT_SCOPE


def test_scope_query_child_table_grant_is_implicit_usage():
    """Scope query (DATABASE without name) + child TABLE grant in same db -> IMPLICIT_USAGE."""
    g = _grant(
        object_type="TABLE",
        object_database="analytics_db",
        object_name="tbl1",
        privilege_type="SELECT",
    )
    q = ObjectQuery(catalog=None, database="analytics_db", name=None, object_type="DATABASE")
    assert classify_grant(g, q) == Relevance.IMPLICIT_USAGE


def test_named_table_query_db_create_table_is_parent_scope():
    """Named TABLE query + DATABASE CREATE TABLE grant -> PARENT_SCOPE."""
    g = _grant(
        object_type="DATABASE",
        object_database="analytics_db",
        privilege_type="CREATE TABLE",
    )
    q = ObjectQuery(catalog=None, database="analytics_db", name="tbl1", object_type="TABLE")
    assert classify_grant(g, q) == Relevance.PARENT_SCOPE


def test_named_table_query_db_create_view_is_irrelevant():
    """Named TABLE query + DATABASE CREATE VIEW grant -> IRRELEVANT."""
    g = _grant(
        object_type="DATABASE",
        object_database="analytics_db",
        privilege_type="CREATE VIEW",
    )
    q = ObjectQuery(catalog=None, database="analytics_db", name="tbl1", object_type="TABLE")
    assert classify_grant(g, q) == Relevance.IRRELEVANT


def test_wildcard_grant_mismatched_type_is_irrelevant():
    """Wildcard grant (no coords) with mismatched type -> IRRELEVANT."""
    g = _grant(object_type="VIEW", object_catalog=None, object_database=None, object_name=None)
    q = ObjectQuery(catalog=None, database=None, name="tbl1", object_type="TABLE")
    # VIEW wildcard does not cover TABLE
    assert classify_grant(g, q) == Relevance.IRRELEVANT


def test_system_create_resource_group_with_rg_query_is_parent_scope():
    """SYSTEM CREATE RESOURCE GROUP priv + RESOURCE GROUP query -> PARENT_SCOPE."""
    g = _grant(object_type="SYSTEM", privilege_type="CREATE RESOURCE GROUP")
    q = ObjectQuery(catalog=None, database=None, name=None, object_type="RESOURCE GROUP")
    assert classify_grant(g, q) == Relevance.PARENT_SCOPE


# ── _scope_matches tests ──


def test_scope_matches_catalog_mismatch():
    """_scope_matches: catalog mismatch -> False."""
    q = ObjectQuery(catalog="cat_a", database=None, name=None, object_type="TABLE")
    assert _scope_matches("cat_b", None, None, q) is False


def test_scope_matches_all_match():
    """_scope_matches: all coordinates match -> True."""
    q = ObjectQuery(catalog="cat_a", database="db1", name="tbl1", object_type="TABLE")
    assert _scope_matches("cat_a", "db1", "tbl1", q) is True


# ── _deduplicate tests ──


def test_deduplicate_removes_duplicate_grants():
    """_deduplicate: removes duplicate grants, keeps first occurrence."""
    g1 = _grant(privilege_type="SELECT", source="direct")
    g2 = _grant(privilege_type="SELECT", source="role_a")  # same key, different source
    g3 = _grant(privilege_type="INSERT", source="direct")  # different priv
    result = _deduplicate([g1, g2, g3])
    assert len(result) == 2
    assert result[0].privilege_type == "SELECT"
    assert result[0].source == "direct"  # first occurrence kept
    assert result[1].privilege_type == "INSERT"
