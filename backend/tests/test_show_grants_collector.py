"""Unit tests for app.services.common.show_grants_collector."""

from __future__ import annotations

from unittest.mock import patch

from app.models.schemas import PrivilegeGrant
from app.services.common.show_grants_collector import _probe_public_defaults, collect_non_admin
from tests.conftest import FakeConnection


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


# ── collect_non_admin tests ──


@patch("app.services.common.show_grants_collector.fetch_role_child_map")
@patch("app.services.common.show_grants_collector.build_role_chain")
@patch("app.services.common.show_grants_collector._parse_show_grants")
def test_collect_non_admin_happy_path(mock_parse, mock_chain, mock_child_map):
    """Happy path: collect_non_admin returns grants from user + roles."""
    user_grant = _grant(grantee="testuser", privilege_type="SELECT")
    role_grant = _grant(grantee="role_a", grantee_type="ROLE", privilege_type="INSERT")

    mock_parse.side_effect = [
        [user_grant],  # user grants
        [role_grant],  # role_a grants
    ]
    mock_chain.return_value = {"role_a": "role_a"}
    mock_child_map.return_value = {}

    conn = FakeConnection({})
    result = collect_non_admin(conn, "testuser")

    assert len(result.grants) == 2
    assert result.user_role_chain == {"role_a": "role_a"}
    assert result.all_users == set()
    assert result.role_child_map == {}


@patch("app.services.common.show_grants_collector._probe_public_defaults")
@patch("app.services.common.show_grants_collector.fetch_role_child_map")
@patch("app.services.common.show_grants_collector.build_role_chain")
@patch("app.services.common.show_grants_collector._parse_show_grants")
def test_collect_non_admin_public_empty_triggers_probe(mock_parse, mock_chain, mock_child_map, mock_probe):
    """Public empty triggers probe: public role returning empty grants -> _probe_public_defaults called."""
    user_grant = _grant(grantee="testuser", privilege_type="SELECT")
    probe_grant = _grant(
        grantee="public",
        grantee_type="ROLE",
        object_type="STORAGE VOLUME",
        object_name="sv1",
        privilege_type="USAGE",
    )

    mock_parse.side_effect = [
        [user_grant],  # user grants
        [],  # public role grants (empty -> triggers probe)
    ]
    mock_chain.return_value = {"public": "public"}
    mock_child_map.return_value = {}
    mock_probe.return_value = [probe_grant]

    conn = FakeConnection({})
    result = collect_non_admin(conn, "testuser")

    mock_probe.assert_called_once_with(conn)
    assert any(g.object_type == "STORAGE VOLUME" for g in result.grants)


# ── _probe_public_defaults tests ──


@patch("app.services.common.show_grants_collector.execute_query")
def test_probe_public_defaults_storage_volume(mock_exec):
    """SHOW STORAGE VOLUMES + DESC -> USAGE grant."""
    mock_exec.side_effect = [
        [{"Name": "sv1"}],  # SHOW STORAGE VOLUMES
        [{}],  # DESC STORAGE VOLUME sv1 (succeeds)
        [],  # SHOW WAREHOUSES
    ]
    conn = FakeConnection({})
    result = _probe_public_defaults(conn)
    sv_grants = [g for g in result if g.object_type == "STORAGE VOLUME"]
    assert len(sv_grants) == 1
    assert sv_grants[0].object_name == "sv1"
    assert sv_grants[0].privilege_type == "USAGE"


@patch("app.services.common.show_grants_collector.execute_query")
def test_probe_public_defaults_warehouses(mock_exec):
    """SHOW WAREHOUSES -> USAGE grant."""
    mock_exec.side_effect = [
        [],  # SHOW STORAGE VOLUMES (empty)
        [{"Name": "wh1"}],  # SHOW WAREHOUSES
    ]
    conn = FakeConnection({})
    result = _probe_public_defaults(conn)
    wh_grants = [g for g in result if g.object_type == "WAREHOUSE"]
    assert len(wh_grants) == 1
    assert wh_grants[0].object_name == "wh1"
    assert wh_grants[0].privilege_type == "USAGE"


@patch("app.services.common.show_grants_collector.execute_query")
def test_probe_public_defaults_desc_fails(mock_exec):
    """DESC raises exception -> no STORAGE VOLUME grant but continues to warehouses."""
    mock_exec.side_effect = [
        [{"Name": "sv1"}],  # SHOW STORAGE VOLUMES
        Exception("DESC failed"),  # DESC STORAGE VOLUME raises
        [{"Name": "wh1"}],  # SHOW WAREHOUSES
    ]
    conn = FakeConnection({})
    result = _probe_public_defaults(conn)
    # No storage volume grant (DESC failed)
    sv_grants = [g for g in result if g.object_type == "STORAGE VOLUME"]
    assert len(sv_grants) == 0
    # Warehouse still works
    wh_grants = [g for g in result if g.object_type == "WAREHOUSE"]
    assert len(wh_grants) == 1


@patch("app.services.common.show_grants_collector.execute_query")
def test_probe_public_defaults_both_commands_fail(mock_exec):
    """Both SHOW commands raise -> returns empty."""
    mock_exec.side_effect = [
        Exception("SHOW STORAGE VOLUMES failed"),
        Exception("SHOW WAREHOUSES failed"),
    ]
    conn = FakeConnection({})
    result = _probe_public_defaults(conn)
    assert result == []
