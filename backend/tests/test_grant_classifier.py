"""Unit tests for grant_classifier: ObjectQuery, classify_grant, and helpers."""

from __future__ import annotations

import pytest

from app.models.schemas import PrivilegeGrant
from app.services.common.grant_classifier import (
    ObjectQuery,
    Relevance,
    _convert_implicit_usage,
    _deduplicate,
    classify_grant,
)


# ─── Helper to build PrivilegeGrant quickly ──────────────────────────


def _grant(
    privilege_type: str = "SELECT",
    object_type: str = "TABLE",
    object_catalog: str | None = "cat1",
    object_database: str | None = "db1",
    object_name: str | None = "tbl1",
    grantee: str = "user1",
    grantee_type: str = "USER",
    source: str = "direct",
) -> PrivilegeGrant:
    return PrivilegeGrant(
        grantee=grantee,
        grantee_type=grantee_type,
        object_catalog=object_catalog,
        object_database=object_database,
        object_name=object_name,
        object_type=object_type,
        privilege_type=privilege_type,
        is_grantable=False,
        source=source,
    )


# =====================================================================
# 1. ObjectQuery properties
# =====================================================================


class TestObjectQueryProperties:
    def test_is_system_true(self):
        q = ObjectQuery(catalog=None, database=None, name=None, object_type="SYSTEM")
        assert q.is_system is True

    def test_is_system_false_for_table(self):
        q = ObjectQuery(catalog="c", database="d", name="t", object_type="TABLE")
        assert q.is_system is False

    def test_is_system_case_insensitive(self):
        q = ObjectQuery(catalog=None, database=None, name=None, object_type="system")
        assert q.is_system is True

    def test_is_scope_query_database_no_name(self):
        q = ObjectQuery(catalog="c", database="d", name=None, object_type="DATABASE")
        assert q.is_scope_query is True

    def test_is_scope_query_catalog_no_name(self):
        q = ObjectQuery(catalog="c", database=None, name=None, object_type="CATALOG")
        assert q.is_scope_query is True

    def test_is_scope_query_false_when_name_provided(self):
        q = ObjectQuery(catalog="c", database="d", name="mydb", object_type="DATABASE")
        assert q.is_scope_query is False

    def test_is_scope_query_false_for_table(self):
        q = ObjectQuery(catalog="c", database="d", name=None, object_type="TABLE")
        assert q.is_scope_query is False

    def test_type_upper_with_none(self):
        q = ObjectQuery(catalog=None, database=None, name=None, object_type=None)
        assert q.type_upper == ""

    def test_child_types_database(self):
        q = ObjectQuery(catalog="c", database="d", name=None, object_type="DATABASE")
        assert q.child_types == frozenset({"TABLE", "VIEW", "MATERIALIZED VIEW", "FUNCTION"})

    def test_child_types_catalog(self):
        q = ObjectQuery(catalog="c", database=None, name=None, object_type="CATALOG")
        assert q.child_types == frozenset(
            {"TABLE", "VIEW", "MATERIALIZED VIEW", "FUNCTION", "DATABASE"}
        )

    def test_child_types_empty_for_table(self):
        q = ObjectQuery(catalog="c", database="d", name="t", object_type="TABLE")
        assert q.child_types == frozenset()


# =====================================================================
# 2. classify_grant — EXACT matches
# =====================================================================


class TestClassifyGrantExact:
    def test_table_grant_matches_table_query(self):
        g = _grant(privilege_type="SELECT", object_type="TABLE",
                    object_catalog="c", object_database="d", object_name="t")
        q = ObjectQuery(catalog="c", database="d", name="t", object_type="TABLE")
        assert classify_grant(g, q) == Relevance.EXACT

    def test_database_grant_matches_database_query(self):
        g = _grant(privilege_type="USAGE", object_type="DATABASE",
                    object_catalog="c", object_database="d", object_name="mydb")
        q = ObjectQuery(catalog="c", database="d", name="mydb", object_type="DATABASE")
        assert classify_grant(g, q) == Relevance.EXACT

    def test_system_grant_matches_system_query(self):
        g = _grant(privilege_type="NODE", object_type="SYSTEM",
                    object_catalog=None, object_database=None, object_name=None)
        q = ObjectQuery(catalog=None, database=None, name=None, object_type="SYSTEM")
        assert classify_grant(g, q) == Relevance.EXACT

    def test_view_grant_matches_view_query(self):
        g = _grant(privilege_type="SELECT", object_type="VIEW",
                    object_catalog="c", object_database="d", object_name="v1")
        q = ObjectQuery(catalog="c", database="d", name="v1", object_type="VIEW")
        assert classify_grant(g, q) == Relevance.EXACT

    def test_non_object_type_exact_with_name(self):
        """USER-type grant with matching name is EXACT."""
        g = _grant(privilege_type="IMPERSONATE", object_type="USER",
                    object_catalog=None, object_database=None, object_name="alice")
        q = ObjectQuery(catalog=None, database=None, name="alice", object_type="USER")
        assert classify_grant(g, q) == Relevance.EXACT


# =====================================================================
# 3. classify_grant — PARENT_SCOPE
# =====================================================================


class TestClassifyGrantParentScope:
    def test_database_grant_for_table_query(self):
        """A DATABASE-level grant is PARENT_SCOPE when querying a table in that database."""
        g = _grant(privilege_type="SELECT", object_type="DATABASE",
                    object_catalog="c", object_database="d", object_name=None)
        q = ObjectQuery(catalog="c", database="d", name="tbl", object_type="TABLE")
        assert classify_grant(g, q) == Relevance.PARENT_SCOPE

    def test_catalog_grant_for_table_query(self):
        g = _grant(privilege_type="SELECT", object_type="CATALOG",
                    object_catalog="c", object_database=None, object_name=None)
        q = ObjectQuery(catalog="c", database="d", name="tbl", object_type="TABLE")
        assert classify_grant(g, q) == Relevance.PARENT_SCOPE

    def test_wildcard_table_grant_parent_scope(self):
        """Grant on TABLE type with no coordinates is PARENT_SCOPE."""
        g = _grant(privilege_type="SELECT", object_type="TABLE",
                    object_catalog=None, object_database=None, object_name=None)
        q = ObjectQuery(catalog="c", database="d", name="tbl", object_type="TABLE")
        assert classify_grant(g, q) == Relevance.PARENT_SCOPE

    def test_create_table_on_database_is_parent_scope_for_table(self):
        """CREATE TABLE privilege on DATABASE is PARENT_SCOPE for TABLE query."""
        g = _grant(privilege_type="CREATE TABLE", object_type="DATABASE",
                    object_catalog="c", object_database="d", object_name=None)
        q = ObjectQuery(catalog="c", database="d", name="tbl", object_type="TABLE")
        assert classify_grant(g, q) == Relevance.PARENT_SCOPE

    def test_non_object_type_wildcard_is_parent_scope(self):
        """USER-type grant without name when querying a specific user is PARENT_SCOPE."""
        g = _grant(privilege_type="IMPERSONATE", object_type="USER",
                    object_catalog=None, object_database=None, object_name=None)
        q = ObjectQuery(catalog=None, database=None, name="alice", object_type="USER")
        assert classify_grant(g, q) == Relevance.PARENT_SCOPE

    def test_system_create_external_catalog_is_parent_scope(self):
        """SYSTEM-level CREATE EXTERNAL CATALOG is PARENT_SCOPE for CATALOG query."""
        g = _grant(privilege_type="CREATE EXTERNAL CATALOG", object_type="SYSTEM",
                    object_catalog=None, object_database=None, object_name=None)
        q = ObjectQuery(catalog="c", database=None, name=None, object_type="CATALOG")
        assert classify_grant(g, q) == Relevance.PARENT_SCOPE

    def test_system_create_warehouse_is_parent_scope(self):
        g = _grant(privilege_type="CREATE WAREHOUSE", object_type="SYSTEM",
                    object_catalog=None, object_database=None, object_name=None)
        q = ObjectQuery(catalog=None, database=None, name=None, object_type="WAREHOUSE")
        assert classify_grant(g, q) == Relevance.PARENT_SCOPE


# =====================================================================
# 4. classify_grant — IMPLICIT_USAGE
# =====================================================================


class TestClassifyGrantImplicitUsage:
    def test_table_grant_implicit_usage_on_database_scope_query(self):
        """TABLE grant triggers IMPLICIT_USAGE when querying DATABASE scope (no name)."""
        g = _grant(privilege_type="SELECT", object_type="TABLE",
                    object_catalog="c", object_database="d", object_name="tbl")
        q = ObjectQuery(catalog="c", database="d", name=None, object_type="DATABASE")
        assert classify_grant(g, q) == Relevance.IMPLICIT_USAGE

    def test_view_grant_implicit_usage_on_database_scope_query(self):
        g = _grant(privilege_type="SELECT", object_type="VIEW",
                    object_catalog="c", object_database="d", object_name="v1")
        q = ObjectQuery(catalog="c", database="d", name=None, object_type="DATABASE")
        assert classify_grant(g, q) == Relevance.IMPLICIT_USAGE

    def test_function_grant_implicit_usage_on_database_scope_query(self):
        g = _grant(privilege_type="USAGE", object_type="FUNCTION",
                    object_catalog="c", object_database="d", object_name="fn1")
        q = ObjectQuery(catalog="c", database="d", name=None, object_type="DATABASE")
        assert classify_grant(g, q) == Relevance.IMPLICIT_USAGE

    def test_database_grant_implicit_usage_on_catalog_scope_query(self):
        """DATABASE grant triggers IMPLICIT_USAGE when querying CATALOG scope."""
        g = _grant(privilege_type="USAGE", object_type="DATABASE",
                    object_catalog="c", object_database="d", object_name="mydb")
        q = ObjectQuery(catalog="c", database=None, name=None, object_type="CATALOG")
        assert classify_grant(g, q) == Relevance.IMPLICIT_USAGE

    def test_no_implicit_usage_when_catalog_mismatches(self):
        g = _grant(privilege_type="SELECT", object_type="TABLE",
                    object_catalog="other_cat", object_database="d", object_name="tbl")
        q = ObjectQuery(catalog="c", database="d", name=None, object_type="DATABASE")
        # scope_matches fails on catalog mismatch, so not IMPLICIT_USAGE
        assert classify_grant(g, q) == Relevance.IRRELEVANT


# =====================================================================
# 5. classify_grant — IRRELEVANT
# =====================================================================


class TestClassifyGrantIrrelevant:
    def test_unrelated_catalog(self):
        g = _grant(privilege_type="SELECT", object_type="TABLE",
                    object_catalog="other", object_database="d", object_name="t")
        q = ObjectQuery(catalog="c", database="d", name="t", object_type="TABLE")
        assert classify_grant(g, q) == Relevance.IRRELEVANT

    def test_unrelated_database(self):
        g = _grant(privilege_type="SELECT", object_type="TABLE",
                    object_catalog="c", object_database="other", object_name="t")
        q = ObjectQuery(catalog="c", database="d", name="t", object_type="TABLE")
        assert classify_grant(g, q) == Relevance.IRRELEVANT

    def test_unrelated_name(self):
        g = _grant(privilege_type="SELECT", object_type="TABLE",
                    object_catalog="c", object_database="d", object_name="other")
        q = ObjectQuery(catalog="c", database="d", name="t", object_type="TABLE")
        assert classify_grant(g, q) == Relevance.IRRELEVANT

    def test_system_only_priv_irrelevant_for_table(self):
        """A SYSTEM-only privilege like NODE is IRRELEVANT for table queries."""
        g = _grant(privilege_type="NODE", object_type="SYSTEM",
                    object_catalog=None, object_database=None, object_name=None)
        q = ObjectQuery(catalog="c", database="d", name="t", object_type="TABLE")
        assert classify_grant(g, q) == Relevance.IRRELEVANT

    def test_non_system_grant_for_system_query(self):
        """A TABLE grant is IRRELEVANT for SYSTEM query."""
        g = _grant(privilege_type="SELECT", object_type="TABLE",
                    object_catalog="c", object_database="d", object_name="t")
        q = ObjectQuery(catalog=None, database=None, name=None, object_type="SYSTEM")
        assert classify_grant(g, q) == Relevance.IRRELEVANT

    def test_db_only_priv_irrelevant_for_wrong_type(self):
        """CREATE VIEW on DATABASE is IRRELEVANT when querying a TABLE."""
        g = _grant(privilege_type="CREATE VIEW", object_type="DATABASE",
                    object_catalog="c", object_database="d", object_name=None)
        q = ObjectQuery(catalog="c", database="d", name="tbl", object_type="TABLE")
        assert classify_grant(g, q) == Relevance.IRRELEVANT

    def test_non_object_type_mismatch(self):
        """A RESOURCE GROUP grant is IRRELEVANT for USER query."""
        g = _grant(privilege_type="USAGE", object_type="RESOURCE GROUP",
                    object_catalog=None, object_database=None, object_name="rg1")
        q = ObjectQuery(catalog=None, database=None, name="alice", object_type="USER")
        assert classify_grant(g, q) == Relevance.IRRELEVANT

    def test_table_wildcard_irrelevant_for_view_query(self):
        """A wildcard TABLE grant is IRRELEVANT when querying VIEW type."""
        g = _grant(privilege_type="SELECT", object_type="TABLE",
                    object_catalog=None, object_database=None, object_name=None)
        q = ObjectQuery(catalog="c", database="d", name="v1", object_type="VIEW")
        assert classify_grant(g, q) == Relevance.IRRELEVANT

    def test_view_wildcard_irrelevant_for_table_query(self):
        g = _grant(privilege_type="SELECT", object_type="VIEW",
                    object_catalog=None, object_database=None, object_name=None)
        q = ObjectQuery(catalog="c", database="d", name="t", object_type="TABLE")
        assert classify_grant(g, q) == Relevance.IRRELEVANT

    def test_system_grant_type_irrelevant_for_non_system_query(self):
        """SYSTEM otype with a system-only priv is IRRELEVANT for TABLE query."""
        g = _grant(privilege_type="OPERATE", object_type="SYSTEM",
                    object_catalog=None, object_database=None, object_name=None)
        q = ObjectQuery(catalog="c", database="d", name="t", object_type="TABLE")
        assert classify_grant(g, q) == Relevance.IRRELEVANT

    def test_named_grant_type_mismatch_via_wildcard_map(self):
        """A named VIEW grant is IRRELEVANT for TABLE query (type mismatch)."""
        g = _grant(privilege_type="SELECT", object_type="VIEW",
                    object_catalog="c", object_database="d", object_name="v1")
        q = ObjectQuery(catalog="c", database="d", name="v1", object_type="TABLE")
        assert classify_grant(g, q) == Relevance.IRRELEVANT


# =====================================================================
# 6. classify_grant — SYSTEM scope
# =====================================================================


class TestClassifyGrantSystem:
    def test_system_exact(self):
        g = _grant(privilege_type="GRANT", object_type="SYSTEM",
                    object_catalog=None, object_database=None, object_name=None)
        q = ObjectQuery(catalog=None, database=None, name=None, object_type="SYSTEM")
        assert classify_grant(g, q) == Relevance.EXACT

    def test_all_system_only_privs_irrelevant_for_table(self):
        """Every system-only privilege is IRRELEVANT for non-SYSTEM queries."""
        q = ObjectQuery(catalog="c", database="d", name="t", object_type="TABLE")
        for priv in ["NODE", "BLACKLIST", "FILE", "OPERATE", "PLUGIN",
                      "CREATE RESOURCE GROUP", "GRANT", "SECURITY"]:
            g = _grant(privilege_type=priv, object_type="SYSTEM",
                        object_catalog=None, object_database=None, object_name=None)
            assert classify_grant(g, q) == Relevance.IRRELEVANT, f"Failed for {priv}"

    def test_system_create_maps_to_target_type(self):
        """CREATE RESOURCE GROUP on SYSTEM is PARENT_SCOPE for RESOURCE GROUP query."""
        g = _grant(privilege_type="CREATE RESOURCE GROUP", object_type="SYSTEM",
                    object_catalog=None, object_database=None, object_name=None)
        q = ObjectQuery(catalog=None, database=None, name=None, object_type="RESOURCE GROUP")
        assert classify_grant(g, q) == Relevance.PARENT_SCOPE

    def test_system_create_resource_maps_correctly(self):
        g = _grant(privilege_type="CREATE RESOURCE", object_type="SYSTEM",
                    object_catalog=None, object_database=None, object_name=None)
        q = ObjectQuery(catalog=None, database=None, name=None, object_type="RESOURCE")
        assert classify_grant(g, q) == Relevance.PARENT_SCOPE

    def test_system_create_global_function_maps_correctly(self):
        g = _grant(privilege_type="CREATE GLOBAL FUNCTION", object_type="SYSTEM",
                    object_catalog=None, object_database=None, object_name=None)
        q = ObjectQuery(catalog=None, database=None, name=None, object_type="GLOBAL FUNCTION")
        assert classify_grant(g, q) == Relevance.PARENT_SCOPE

    def test_system_create_storage_volume_maps_correctly(self):
        g = _grant(privilege_type="CREATE STORAGE VOLUME", object_type="SYSTEM",
                    object_catalog=None, object_database=None, object_name=None)
        q = ObjectQuery(catalog=None, database=None, name=None, object_type="STORAGE VOLUME")
        assert classify_grant(g, q) == Relevance.PARENT_SCOPE


# =====================================================================
# 7. classify_grant — wildcard grants
# =====================================================================


class TestClassifyGrantWildcards:
    def test_wildcard_table_for_table_query(self):
        g = _grant(privilege_type="SELECT", object_type="TABLE",
                    object_catalog=None, object_database=None, object_name=None)
        q = ObjectQuery(catalog="c", database="d", name="t", object_type="TABLE")
        assert classify_grant(g, q) == Relevance.PARENT_SCOPE

    def test_wildcard_database_for_table_query(self):
        """Wildcard DATABASE grant covers TABLE query via _WILDCARD_TYPE_MAP."""
        g = _grant(privilege_type="SELECT", object_type="DATABASE",
                    object_catalog=None, object_database=None, object_name=None)
        q = ObjectQuery(catalog="c", database="d", name="t", object_type="TABLE")
        assert classify_grant(g, q) == Relevance.PARENT_SCOPE

    def test_wildcard_catalog_for_table_query(self):
        g = _grant(privilege_type="SELECT", object_type="CATALOG",
                    object_catalog=None, object_database=None, object_name=None)
        q = ObjectQuery(catalog="c", database="d", name="t", object_type="TABLE")
        assert classify_grant(g, q) == Relevance.PARENT_SCOPE

    def test_wildcard_view_irrelevant_for_table(self):
        g = _grant(privilege_type="SELECT", object_type="VIEW",
                    object_catalog=None, object_database=None, object_name=None)
        q = ObjectQuery(catalog="c", database="d", name="t", object_type="TABLE")
        assert classify_grant(g, q) == Relevance.IRRELEVANT

    def test_wildcard_mv_for_mv_query(self):
        g = _grant(privilege_type="SELECT", object_type="MATERIALIZED VIEW",
                    object_catalog=None, object_database=None, object_name=None)
        q = ObjectQuery(catalog="c", database="d", name="mv1", object_type="MATERIALIZED VIEW")
        assert classify_grant(g, q) == Relevance.PARENT_SCOPE

    def test_wildcard_no_type_for_any_query(self):
        """A grant with no coordinates and no otype falls through to scope matching."""
        g = _grant(privilege_type="ALL", object_type="",
                    object_catalog=None, object_database=None, object_name=None)
        q = ObjectQuery(catalog="c", database="d", name="t", object_type="TABLE")
        # otype is empty string, not in _NON_OBJECT_TYPES, not SYSTEM
        # gc/gd/gn are all None, otype is falsy → skips wildcard block (requires otype)
        # Falls through to _scope_matches (all None coords match) → PARENT_SCOPE with no gn
        assert classify_grant(g, q) == Relevance.PARENT_SCOPE

    def test_wildcard_grant_no_name_in_grant_for_scope_query(self):
        """Wildcard TABLE grant (no catalog, no db, no name) → PARENT_SCOPE for TABLE with name."""
        g = _grant(privilege_type="DROP", object_type="TABLE",
                    object_catalog=None, object_database=None, object_name=None)
        q = ObjectQuery(catalog="c", database="d", name="t", object_type="TABLE")
        assert classify_grant(g, q) == Relevance.PARENT_SCOPE


# =====================================================================
# 8. _convert_implicit_usage
# =====================================================================


class TestConvertImplicitUsage:
    def test_converts_child_grants_to_usage(self):
        q = ObjectQuery(catalog="c", database="d", name=None, object_type="DATABASE")
        grants = [
            _grant(privilege_type="SELECT", object_type="TABLE",
                   object_catalog="c", object_database="d", object_name="t1",
                   grantee="user1", source="direct"),
            _grant(privilege_type="INSERT", object_type="TABLE",
                   object_catalog="c", object_database="d", object_name="t2",
                   grantee="user2", source="role1"),
        ]
        result = _convert_implicit_usage(grants, q)
        assert len(result) == 2
        assert result[0].privilege_type == "USAGE"
        assert result[0].object_type == "DATABASE"
        assert result[0].grantee == "user1"
        assert result[0].source == "direct (implicit)"
        assert result[1].grantee == "user2"
        assert result[1].source == "role1 (implicit)"

    def test_deduplicates_by_grantee(self):
        """Same grantee with multiple child grants → only one USAGE."""
        q = ObjectQuery(catalog="c", database="d", name=None, object_type="DATABASE")
        grants = [
            _grant(privilege_type="SELECT", object_type="TABLE",
                   object_catalog="c", object_database="d", object_name="t1",
                   grantee="user1"),
            _grant(privilege_type="INSERT", object_type="TABLE",
                   object_catalog="c", object_database="d", object_name="t2",
                   grantee="user1"),
        ]
        result = _convert_implicit_usage(grants, q)
        assert len(result) == 1
        assert result[0].privilege_type == "USAGE"

    def test_preserves_non_child_grants(self):
        q = ObjectQuery(catalog="c", database="d", name=None, object_type="DATABASE")
        db_grant = _grant(privilege_type="USAGE", object_type="DATABASE",
                          object_catalog="c", object_database="d", object_name=None,
                          grantee="user1")
        grants = [db_grant]
        result = _convert_implicit_usage(grants, q)
        assert len(result) == 1
        assert result[0].privilege_type == "USAGE"
        assert result[0].source == "direct"  # not modified

    def test_noop_when_not_scope_query(self):
        """Returns input unchanged when query is not a scope query."""
        q = ObjectQuery(catalog="c", database="d", name="tbl", object_type="TABLE")
        grants = [_grant()]
        result = _convert_implicit_usage(grants, q)
        assert result is grants  # same object, no transformation

    def test_catalog_scope_converts_database_grants(self):
        q = ObjectQuery(catalog="c", database=None, name=None, object_type="CATALOG")
        grants = [
            _grant(privilege_type="USAGE", object_type="DATABASE",
                   object_catalog="c", object_database="d", object_name="mydb",
                   grantee="user1", source="direct"),
        ]
        result = _convert_implicit_usage(grants, q)
        assert len(result) == 1
        assert result[0].privilege_type == "USAGE"
        assert result[0].object_type == "CATALOG"
        assert result[0].source == "direct (implicit)"

    def test_empty_list(self):
        q = ObjectQuery(catalog="c", database="d", name=None, object_type="DATABASE")
        result = _convert_implicit_usage([], q)
        assert result == []


# =====================================================================
# 9. _deduplicate
# =====================================================================


class TestDeduplicate:
    def test_removes_exact_duplicates(self):
        g1 = _grant(privilege_type="SELECT", grantee="u1")
        g2 = _grant(privilege_type="SELECT", grantee="u1")
        result = _deduplicate([g1, g2])
        assert len(result) == 1

    def test_keeps_different_privileges(self):
        g1 = _grant(privilege_type="SELECT", grantee="u1")
        g2 = _grant(privilege_type="INSERT", grantee="u1")
        result = _deduplicate([g1, g2])
        assert len(result) == 2

    def test_keeps_different_grantees(self):
        g1 = _grant(privilege_type="SELECT", grantee="u1")
        g2 = _grant(privilege_type="SELECT", grantee="u2")
        result = _deduplicate([g1, g2])
        assert len(result) == 2

    def test_keeps_different_grantee_types(self):
        g1 = _grant(privilege_type="SELECT", grantee="admin", grantee_type="USER")
        g2 = _grant(privilege_type="SELECT", grantee="admin", grantee_type="ROLE")
        result = _deduplicate([g1, g2])
        assert len(result) == 2

    def test_none_values_treated_as_empty_string(self):
        """Grants with None vs empty-string in optional fields are deduplicated together."""
        g1 = _grant(object_catalog=None, object_database=None, object_name=None)
        g2 = _grant(object_catalog=None, object_database=None, object_name=None)
        result = _deduplicate([g1, g2])
        assert len(result) == 1

    def test_preserves_order_first_wins(self):
        g1 = _grant(privilege_type="SELECT", grantee="u1", source="role_a")
        g2 = _grant(privilege_type="SELECT", grantee="u1", source="role_b")
        result = _deduplicate([g1, g2])
        assert len(result) == 1
        assert result[0].source == "role_a"  # first one kept

    def test_empty_list(self):
        assert _deduplicate([]) == []

    def test_different_object_types_kept(self):
        g1 = _grant(object_type="TABLE")
        g2 = _grant(object_type="VIEW")
        result = _deduplicate([g1, g2])
        assert len(result) == 2


# =====================================================================
# 10. Edge cases
# =====================================================================


class TestEdgeCases:
    def test_none_object_type_in_grant(self):
        """Grant with None object_type does not crash."""
        g = _grant(privilege_type="SELECT", object_type="",
                    object_catalog="c", object_database="d", object_name="t")
        q = ObjectQuery(catalog="c", database="d", name="t", object_type="TABLE")
        result = classify_grant(g, q)
        # Empty otype → not SYSTEM, not in _NON_OBJECT_TYPES, falls through to scope match
        assert result in (Relevance.EXACT, Relevance.PARENT_SCOPE, Relevance.IRRELEVANT)

    def test_empty_string_privilege(self):
        g = _grant(privilege_type="", object_type="TABLE",
                    object_catalog="c", object_database="d", object_name="t")
        q = ObjectQuery(catalog="c", database="d", name="t", object_type="TABLE")
        # Should not crash; empty priv is not in any special set
        assert classify_grant(g, q) == Relevance.EXACT

    def test_function_name_normalization_in_non_object_type(self):
        """Function signature in name is normalized: fn(VARCHAR) matches fn."""
        g = _grant(privilege_type="USAGE", object_type="GLOBAL FUNCTION",
                    object_catalog=None, object_database=None, object_name="myfn(VARCHAR)")
        q = ObjectQuery(catalog=None, database=None, name="myfn", object_type="GLOBAL FUNCTION")
        assert classify_grant(g, q) == Relevance.EXACT

    def test_function_name_normalization_mismatch(self):
        g = _grant(privilege_type="USAGE", object_type="GLOBAL FUNCTION",
                    object_catalog=None, object_database=None, object_name="otherfn(INT)")
        q = ObjectQuery(catalog=None, database=None, name="myfn", object_type="GLOBAL FUNCTION")
        assert classify_grant(g, q) == Relevance.IRRELEVANT

    def test_case_insensitive_object_type(self):
        """Grant with lowercase object_type is handled correctly."""
        g = _grant(privilege_type="SELECT", object_type="table",
                    object_catalog="c", object_database="d", object_name="t")
        q = ObjectQuery(catalog="c", database="d", name="t", object_type="TABLE")
        assert classify_grant(g, q) == Relevance.EXACT

    def test_objectquery_frozen(self):
        """ObjectQuery is immutable (frozen dataclass)."""
        q = ObjectQuery(catalog="c", database="d", name="t", object_type="TABLE")
        with pytest.raises(AttributeError):
            q.catalog = "other"  # type: ignore[misc]

    def test_mixed_scope_and_non_child_grant(self):
        """DATABASE scope query ignores CATALOG-type grants (not a child type)."""
        g = _grant(privilege_type="USAGE", object_type="CATALOG",
                    object_catalog="c", object_database=None, object_name=None)
        q = ObjectQuery(catalog="c", database="d", name=None, object_type="DATABASE")
        # CATALOG is not in DATABASE's child_types, so not IMPLICIT_USAGE
        # Falls through to wildcard check or scope match
        result = classify_grant(g, q)
        assert result != Relevance.IMPLICIT_USAGE

    def test_create_view_parent_scope_for_view_query(self):
        """CREATE VIEW on DATABASE is PARENT_SCOPE for VIEW query."""
        g = _grant(privilege_type="CREATE VIEW", object_type="DATABASE",
                    object_catalog="c", object_database="d", object_name=None)
        q = ObjectQuery(catalog="c", database="d", name="v1", object_type="VIEW")
        assert classify_grant(g, q) == Relevance.PARENT_SCOPE

    def test_create_materialized_view_parent_scope(self):
        g = _grant(privilege_type="CREATE MATERIALIZED VIEW", object_type="DATABASE",
                    object_catalog="c", object_database="d", object_name=None)
        q = ObjectQuery(catalog="c", database="d", name="mv1",
                        object_type="MATERIALIZED VIEW")
        assert classify_grant(g, q) == Relevance.PARENT_SCOPE

    def test_create_function_parent_scope(self):
        g = _grant(privilege_type="CREATE FUNCTION", object_type="DATABASE",
                    object_catalog="c", object_database="d", object_name=None)
        q = ObjectQuery(catalog="c", database="d", name="fn1", object_type="FUNCTION")
        assert classify_grant(g, q) == Relevance.PARENT_SCOPE

    def test_create_masking_policy_irrelevant_for_table(self):
        """CREATE MASKING POLICY (DB-only priv, not in _CREATE_TYPE_MAP) is IRRELEVANT for TABLE."""
        g = _grant(privilege_type="CREATE MASKING POLICY", object_type="DATABASE",
                    object_catalog="c", object_database="d", object_name=None)
        q = ObjectQuery(catalog="c", database="d", name="t", object_type="TABLE")
        assert classify_grant(g, q) == Relevance.IRRELEVANT

    def test_grant_with_only_catalog_matching(self):
        """Grant specifying only catalog matches query in that catalog."""
        g = _grant(privilege_type="USAGE", object_type="CATALOG",
                    object_catalog="c", object_database=None, object_name=None)
        q = ObjectQuery(catalog="c", database="d", name="t", object_type="TABLE")
        assert classify_grant(g, q) == Relevance.PARENT_SCOPE
