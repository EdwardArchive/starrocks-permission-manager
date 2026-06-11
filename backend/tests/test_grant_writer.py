"""Unit tests for the GRANT/REVOKE SQL builder and its validation layer."""

from __future__ import annotations

import pytest

from app.models.schemas import GranteeRef, GrantObjectRef, GrantRequest
from app.services.admin.grant_writer import build_statements, parse_user_identity
from app.services.shared.grant_spec import validate_privileges


def _priv_req(**overrides) -> GrantRequest:
    base = dict(
        action="GRANT",
        type="PRIVILEGE",
        grantee=GranteeRef(name="alice", type="USER"),
        object=GrantObjectRef(object_type="TABLE", catalog="default_catalog", database="sales", name="orders"),
        privileges=["SELECT", "INSERT"],
        with_grant_option=False,
    )
    base.update(overrides)
    return GrantRequest(**base)


def _role_req(**overrides) -> GrantRequest:
    base = dict(
        action="GRANT",
        type="ROLE",
        grantee=GranteeRef(name="alice", type="USER"),
        role="analyst_role",
    )
    base.update(overrides)
    return GrantRequest(**base)


# ── statement shapes ──


def test_table_grant_emits_set_catalog_pair():
    statements, _ = build_statements(_priv_req())
    assert statements == [
        "SET CATALOG `default_catalog`",
        "GRANT SELECT, INSERT ON TABLE `sales`.`orders` TO USER 'alice'@'%'",
    ]


def test_catalog_grant_has_no_set_catalog():
    statements, _ = build_statements(
        _priv_req(
            object=GrantObjectRef(object_type="CATALOG", catalog="iceberg_prod"),
            privileges=["USAGE"],
        )
    )
    assert statements == ["GRANT USAGE ON CATALOG `iceberg_prod` TO USER 'alice'@'%'"]


def test_database_grant():
    statements, _ = build_statements(
        _priv_req(
            object=GrantObjectRef(object_type="DATABASE", catalog="default_catalog", database="sales"),
            privileges=["CREATE TABLE"],
        )
    )
    assert statements[1] == "GRANT CREATE TABLE ON DATABASE `sales` TO USER 'alice'@'%'"


def test_function_grant_carries_signature_and_warns():
    statements, warnings = build_statements(
        _priv_req(
            object=GrantObjectRef(
                object_type="FUNCTION", catalog="default_catalog", database="sales", name="my_udf(INT,INT)"
            ),
            privileges=["USAGE"],
        )
    )
    assert statements[1] == "GRANT USAGE ON FUNCTION sales.my_udf(INT,INT) TO USER 'alice'@'%'"
    assert warnings


def test_with_grant_option_suffix():
    statements, _ = build_statements(_priv_req(with_grant_option=True))
    assert statements[1].endswith("WITH GRANT OPTION")


def test_revoke_uses_from():
    statements, _ = build_statements(_priv_req(action="REVOKE"))
    assert statements[1] == "REVOKE SELECT, INSERT ON TABLE `sales`.`orders` FROM USER 'alice'@'%'"


def test_role_grant_to_user_and_role():
    assert build_statements(_role_req())[0] == ["GRANT `analyst_role` TO USER 'alice'@'%'"]
    statements, _ = build_statements(_role_req(grantee=GranteeRef(name="etl_role", type="ROLE")))
    assert statements == ["GRANT `analyst_role` TO ROLE `etl_role`"]


def test_role_revoke():
    statements, _ = build_statements(_role_req(action="REVOKE"))
    assert statements == ["REVOKE `analyst_role` FROM USER 'alice'@'%'"]


def test_quoted_identity_grantee_is_normalized():
    statements, _ = build_statements(_priv_req(grantee=GranteeRef(name="'bob'@'10.0.0.%'", type="USER")))
    assert statements[1].endswith("TO USER 'bob'@'10.0.0.%'")


# ── validation rejections ──


def test_revoke_with_grant_option_rejected():
    with pytest.raises(ValueError, match="WITH GRANT OPTION"):
        build_statements(_priv_req(action="REVOKE", with_grant_option=True))


def test_role_with_grant_option_rejected():
    with pytest.raises(ValueError, match="WITH GRANT OPTION"):
        build_statements(_role_req(with_grant_option=True))


def test_empty_privileges_rejected():
    with pytest.raises(ValueError, match="privilege"):
        build_statements(_priv_req(privileges=[]))


def test_privilege_not_in_allowlist_rejected():
    with pytest.raises(ValueError, match="not grantable"):
        build_statements(
            _priv_req(
                object=GrantObjectRef(object_type="CATALOG", catalog="default_catalog"),
                privileges=["SELECT"],
            )
        )


def test_unknown_object_type_rejected():
    with pytest.raises(ValueError, match="Unsupported object type"):
        build_statements(_priv_req(object=GrantObjectRef(object_type="SYSTEM")))


def test_object_shape_violations_rejected():
    with pytest.raises(ValueError, match="require"):
        build_statements(_priv_req(object=GrantObjectRef(object_type="TABLE", catalog="c", database="d")))
    with pytest.raises(ValueError, match="do not take"):
        build_statements(
            _priv_req(
                object=GrantObjectRef(object_type="CATALOG", catalog="c", database="d"),
                privileges=["USAGE"],
            )
        )


def test_node_is_not_grantable_anywhere():
    for object_type in ("CATALOG", "DATABASE", "TABLE"):
        with pytest.raises(ValueError):
            validate_privileges(object_type, ["NODE"])


# ── injection attempts ──


@pytest.mark.parametrize(
    "evil_name",
    [
        "alice'@'%' WITH GRANT OPTION",
        "bob; DROP TABLE x",
        "carol' TO USER 'attacker",
        "dave`@`%",
        "eve\n@%",
    ],
)
def test_grantee_keyword_smuggling_rejected(evil_name):
    with pytest.raises(ValueError):
        build_statements(_priv_req(grantee=GranteeRef(name=evil_name, type="USER")))


@pytest.mark.parametrize(
    "evil_role",
    ["admin` TO USER 'evil", "role WITH GRANT OPTION", "r;DROP ROLE x", "r'--"],
)
def test_role_name_smuggling_rejected(evil_role):
    with pytest.raises(ValueError):
        build_statements(_role_req(role=evil_role))


@pytest.mark.parametrize(
    "evil_sig",
    [
        "fn(int) WITH GRANT OPTION",
        "fn(int) TO USER(x)",
        "fn(int); DROP TABLE x",
        "fn('a')",
        "fn",
    ],
)
def test_function_signature_smuggling_rejected(evil_sig):
    with pytest.raises(ValueError):
        build_statements(
            _priv_req(
                object=GrantObjectRef(
                    object_type="FUNCTION", catalog="default_catalog", database="sales", name=evil_sig
                ),
                privileges=["USAGE"],
            )
        )


def test_function_db_must_be_plain_identifier():
    with pytest.raises(ValueError, match="database"):
        build_statements(
            _priv_req(
                object=GrantObjectRef(
                    object_type="FUNCTION", catalog="default_catalog", database="sa les", name="fn(INT)"
                ),
                privileges=["USAGE"],
            )
        )


def test_backticks_in_identifiers_are_escaped():
    statements, _ = build_statements(
        _priv_req(object=GrantObjectRef(object_type="TABLE", catalog="default_catalog", database="sa`les", name="orders"))
    )
    assert "`sa``les`" in statements[1]


# ── identity parsing ──


def test_parse_user_identity_forms():
    assert parse_user_identity("alice") == ("alice", "%")
    assert parse_user_identity("alice@10.0.0.1") == ("alice", "10.0.0.1")
    assert parse_user_identity("'alice'@'%'") == ("alice", "%")


def test_sized_and_nested_function_types_accepted():
    statements, _ = build_statements(
        _priv_req(
            object=GrantObjectRef(
                object_type="FUNCTION",
                catalog="default_catalog",
                database="sales",
                name="f(VARCHAR(10), ARRAY<INT>, DECIMAL(10,2))",
            ),
            privileges=["USAGE"],
        )
    )
    assert "f(VARCHAR(10), ARRAY<INT>, DECIMAL(10,2))" in statements[1]
