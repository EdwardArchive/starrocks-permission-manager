"""Tests for GET /api/user/my-permissions endpoint.

Covers: user_permissions.py router — direct grants, role BFS, catalogs,
databases, objects, functions, MVs, system objects, effective privileges.
"""
from __future__ import annotations

import pytest


def _seed_system_objects(query_map: dict) -> None:
    """Populate every system-object section with one realistic row each."""
    query_map["SHOW RESOURCE GROUPS ALL"] = [
        {"name": "rg_etl", "cpu_weight": "8", "mem_limit": "50%", "concurrency_limit": "10",
         "classifiers": "(id=1, weight=1.0, user=alice)"},
    ]
    query_map["SHOW STORAGE VOLUMES"] = [{"Storage Volume": "sv_main"}]
    query_map["DESC STORAGE VOLUME"] = [
        {"Type": "S3", "Location": "s3://bucket", "IsDefault": "true", "Enabled": "true"},
    ]
    query_map["SHOW RESOURCES"] = [
        {"Name": "jdbc_pg", "ResourceType": "jdbc", "Key": "jdbc_uri", "Value": "jdbc:postgresql://h/db"},
    ]
    query_map["SHOW WAREHOUSES"] = [
        {"Name": "default_warehouse", "State": "RUNNING", "NodeCount": "3",
         "RunningSql": "5", "QueuedSql": "0"},
    ]
    query_map["SHOW FULL GLOBAL FUNCTIONS"] = [
        {"Signature": "gfn_mask(VARCHAR)", "Return Type": "VARCHAR", "Function Type": "Scalar"},
    ]
    query_map["SELECT * FROM information_schema.pipes"] = [
        {"PIPE_NAME": "pipe_load", "DATABASE_NAME": "analytics_db",
         "STATE": "RUNNING", "TABLE_NAME": "events", "LOAD_STATUS": "OK"},
    ]
    query_map["SELECT TASK_NAME, STATE FROM information_schema.task_runs"] = [
        {"TASK_NAME": "etl_daily", "STATE": "SUCCESS"},
    ]
    query_map["SELECT * FROM information_schema.tasks"] = [
        {"TASK_NAME": "etl_daily", "DATABASE": "analytics_db",
         "SCHEDULE": "EVERY 1 HOUR", "CREATOR": "admin", "DEFINITION": "INSERT ..."},
    ]


def _seed_object_loop(query_map: dict) -> None:
    """Populate the per-catalog object/function queries the endpoint issues."""
    query_map["SELECT TABLE_SCHEMA, TABLE_NAME, TABLE_TYPE, TABLE_ROWS, DATA_LENGTH"] = [
        {"TABLE_SCHEMA": "analytics_db", "TABLE_NAME": "user_events",
         "TABLE_TYPE": "BASE TABLE", "TABLE_ROWS": 100, "DATA_LENGTH": 5000},
    ]
    query_map["SELECT TABLE_SCHEMA, TABLE_NAME FROM information_schema.materialized_views"] = [
        {"TABLE_SCHEMA": "analytics_db", "TABLE_NAME": "hourly_agg_mv"},
    ]
    query_map["SHOW FULL FUNCTIONS FROM"] = [
        {"Signature": "parse_ua(VARCHAR)", "Return Type": "VARCHAR",
         "Function Type": "Scalar", "Properties": ""},
    ]


def test_my_permissions_basic(client, auth_header):
    """Default query_map returns the expected top-level keys."""
    resp = client.get("/api/user/my-permissions", headers=auth_header)
    assert resp.status_code == 200
    data = resp.json()
    assert data["username"] == "test_admin"
    for key in ("direct_roles", "role_tree", "effective_privileges",
                "accessible_catalogs", "accessible_databases",
                "accessible_objects", "system_objects"):
        assert key in data, f"Missing key: {key}"


def test_my_permissions_with_roles(client, auth_header, query_map):
    """SHOW GRANTS returning role assignment populates direct_roles and role_tree."""
    query_map["SHOW GRANTS FOR"] = [
        # Role assignment row (no ON clause)
        {"Grants": "GRANT 'analyst_role' TO 'test_admin'@'%'"},
        # Privilege grant row
        {
            "Grants": "GRANT SELECT ON TABLE default_catalog.analytics_db.user_events TO 'test_admin'@'%'",
            "Catalog": "default_catalog",
        },
    ]
    # Role's own grants
    query_map["SHOW GRANTS FOR ROLE 'analyst_role'"] = [
        {
            "Grants": "GRANT INSERT ON TABLE default_catalog.analytics_db.page_views TO ROLE 'analyst_role'",
            "Catalog": "default_catalog",
        },
    ]
    resp = client.get("/api/user/my-permissions", headers=auth_header)
    assert resp.status_code == 200
    data = resp.json()
    assert "analyst_role" in data["direct_roles"]
    assert "analyst_role" in data["role_tree"]


def test_my_permissions_effective_privileges(client, auth_header, query_map):
    """Effective privileges include both direct and role-inherited grants."""
    query_map["SHOW GRANTS FOR 'test_admin'"] = [
        {"Grants": "GRANT 'analyst_role' TO 'test_admin'@'%'"},
        {
            "Grants": "GRANT SELECT ON TABLE default_catalog.analytics_db.user_events TO 'test_admin'@'%'",
            "Catalog": "default_catalog",
        },
    ]
    query_map["SHOW GRANTS FOR ROLE 'analyst_role'"] = [
        {
            "Grants": "GRANT INSERT ON TABLE default_catalog.analytics_db.page_views TO ROLE 'analyst_role'",
            "Catalog": "default_catalog",
        },
    ]
    resp = client.get("/api/user/my-permissions", headers=auth_header)
    assert resp.status_code == 200
    data = resp.json()
    priv_types = {p["privilege_type"] for p in data["effective_privileges"]}
    assert "SELECT" in priv_types
    assert "INSERT" in priv_types
    # Direct grant source should be "direct"
    direct = [p for p in data["effective_privileges"] if p["source"] == "direct"]
    assert any(p["privilege_type"] == "SELECT" for p in direct)


def test_my_permissions_system_objects(client, auth_header, query_map):
    """System objects (resource groups, warehouses, etc.) appear in response."""
    query_map["SHOW RESOURCE GROUPS ALL"] = [
        {"name": "rg_etl", "cpu_weight": "8", "mem_limit": "50%", "concurrency_limit": "10",
         "exclusive_cpu_cores": "0", "big_query_cpu_second_limit": "100",
         "big_query_scan_rows_limit": "100000", "big_query_mem_limit": "0",
         "spill_mem_limit_threshold": "0.8",
         "classifiers": "(id=300040, weight=3.0, user=alice, query_type in (SELECT))"},
        {"name": "rg_etl", "cpu_weight": "8", "mem_limit": "50%", "concurrency_limit": "10",
         "exclusive_cpu_cores": "0", "big_query_cpu_second_limit": "100",
         "big_query_scan_rows_limit": "100000", "big_query_mem_limit": "0",
         "spill_mem_limit_threshold": "0.8",
         "classifiers": "(id=300041, weight=1.0, db=analytics_db)"},
    ]
    query_map["SHOW STORAGE VOLUMES"] = [
        {"Storage Volume": "sv_main"},
    ]
    query_map["DESC STORAGE VOLUME"] = [
        {"Type": "S3", "Location": "s3://bucket", "IsDefault": "true", "Enabled": "true"},
    ]
    query_map["SHOW WAREHOUSES"] = [
        {"Name": "default_warehouse", "State": "RUNNING", "NodeCount": "3",
         "RunningSql": "5", "QueuedSql": "0"},
    ]
    query_map["SHOW FULL GLOBAL FUNCTIONS"] = [
        {"Signature": "gfn_mask(VARCHAR)", "Return Type": "VARCHAR", "Function Type": "Scalar"},
    ]
    query_map["SELECT * FROM information_schema.pipes"] = [
        {"PIPE_NAME": "pipe_load", "DATABASE_NAME": "analytics_db",
         "STATE": "RUNNING", "TABLE_NAME": "events", "LOAD_STATUS": "OK"},
    ]
    query_map["SELECT * FROM information_schema.tasks"] = [
        {"TASK_NAME": "etl_daily", "DATABASE": "analytics_db",
         "SCHEDULE": "EVERY 1 HOUR", "STATE": "", "CREATOR": "admin", "DEFINITION": "INSERT INTO ..."},
    ]
    query_map["SELECT TASK_NAME, STATE FROM information_schema.task_runs"] = [
        {"TASK_NAME": "etl_daily", "STATE": "SUCCESS"},
    ]
    query_map["SHOW RESOURCES"] = [
        {"Name": "jdbc_pg", "ResourceType": "jdbc", "Key": "jdbc_uri", "Value": "jdbc:postgresql://host/db"},
    ]
    resp = client.get("/api/user/my-permissions", headers=auth_header)
    assert resp.status_code == 200
    sys_objs = resp.json()["system_objects"]
    types_found = {o["type"] for o in sys_objs}
    assert "RESOURCE_GROUP" in types_found
    assert "STORAGE_VOLUME" in types_found
    assert "WAREHOUSE" in types_found
    assert "GLOBAL_FUNCTION" in types_found
    assert "PIPE" in types_found
    assert "TASK" in types_found
    assert "RESOURCE" in types_found
    # Verify details propagated (including classifiers aggregation)
    rg = next(o for o in sys_objs if o["type"] == "RESOURCE_GROUP")
    assert rg["name"] == "rg_etl"
    assert rg["cpu_weight"] == "8"
    assert rg["mem_limit"] == "50%"
    assert rg["big_query_cpu_second_limit"] == "100"
    import json as _json
    classifiers = _json.loads(rg["classifiers"])
    assert len(classifiers) == 2
    assert "alice" in classifiers[0]
    assert "analytics_db" in classifiers[1]


def test_my_permissions_functions(client, auth_header, query_map):
    """Functions returned by SHOW FULL FUNCTIONS appear in accessible_objects."""
    query_map["SHOW FULL FUNCTIONS FROM"] = [
        {"Signature": "parse_ua(VARCHAR)", "Return Type": "VARCHAR",
         "Function Type": "Scalar", "Properties": ""},
    ]
    resp = client.get("/api/user/my-permissions", headers=auth_header)
    assert resp.status_code == 200
    objs = resp.json()["accessible_objects"]
    fns = [o for o in objs if o["type"] == "FUNCTION"]
    assert len(fns) >= 1
    assert fns[0]["name"] == "parse_ua"
    assert fns[0]["signature"] == "parse_ua(VARCHAR)"


def test_my_permissions_mv_detection(client, auth_header, query_map):
    """Objects found in materialized_views are typed as MATERIALIZED VIEW."""
    query_map["SELECT TABLE_SCHEMA, TABLE_NAME, TABLE_TYPE, TABLE_ROWS, DATA_LENGTH"] = [
        {"TABLE_SCHEMA": "analytics_db", "TABLE_NAME": "hourly_agg_mv",
         "TABLE_TYPE": "BASE TABLE", "TABLE_ROWS": 100, "DATA_LENGTH": 5000},
        {"TABLE_SCHEMA": "analytics_db", "TABLE_NAME": "user_events",
         "TABLE_TYPE": "BASE TABLE", "TABLE_ROWS": 1000, "DATA_LENGTH": 50000},
    ]
    query_map["SELECT TABLE_SCHEMA, TABLE_NAME FROM information_schema.materialized_views"] = [
        {"TABLE_SCHEMA": "analytics_db", "TABLE_NAME": "hourly_agg_mv"},
    ]
    resp = client.get("/api/user/my-permissions", headers=auth_header)
    assert resp.status_code == 200
    objs = resp.json()["accessible_objects"]
    mvs = [o for o in objs if o["type"] == "MATERIALIZED VIEW"]
    assert any(mv["name"] == "hourly_agg_mv" for mv in mvs)
    # The regular table should not be a MV
    tables = [o for o in objs if o["name"] == "user_events"]
    assert all(t["type"] != "MATERIALIZED VIEW" for t in tables)


def test_my_permissions_catalogs_and_databases(client, auth_header):
    """Catalogs have type, databases have catalog field."""
    resp = client.get("/api/user/my-permissions", headers=auth_header)
    assert resp.status_code == 200
    data = resp.json()
    catalogs = data["accessible_catalogs"]
    assert len(catalogs) >= 1
    for cat in catalogs:
        assert "name" in cat
        assert "type" in cat
    databases = data["accessible_databases"]
    for db in databases:
        assert "name" in db
        assert "catalog" in db


def test_my_permissions_view_detection(client, auth_header, query_map):
    """Objects with VIEW in TABLE_TYPE are typed as VIEW."""
    query_map["SELECT TABLE_SCHEMA, TABLE_NAME, TABLE_TYPE, TABLE_ROWS, DATA_LENGTH"] = [
        {"TABLE_SCHEMA": "analytics_db", "TABLE_NAME": "daily_summary",
         "TABLE_TYPE": "VIEW", "TABLE_ROWS": None, "DATA_LENGTH": None},
    ]
    query_map["SELECT TABLE_SCHEMA, TABLE_NAME FROM information_schema.materialized_views"] = []
    resp = client.get("/api/user/my-permissions", headers=auth_header)
    assert resp.status_code == 200
    objs = resp.json()["accessible_objects"]
    views = [o for o in objs if o["type"] == "VIEW"]
    assert any(v["name"] == "daily_summary" for v in views)


def test_resource_groups_non_admin_uses_show_without_all(client, non_admin_auth_header, query_map):
    """Non-admin users should use SHOW RESOURCE GROUPS (without ALL)."""
    query_map["SHOW RESOURCE GROUPS ALL"] = [
        {"name": "should_not_appear", "cpu_weight": "1", "mem_limit": "10%",
         "concurrency_limit": "5", "classifiers": ""},
    ]
    query_map["SHOW RESOURCE GROUPS"] = [
        {"name": "rg_my_group", "cpu_weight": "4", "mem_limit": "20%",
         "concurrency_limit": "8",
         "classifiers": "(id=100, weight=1.0, user=test_admin)"},
    ]
    resp = client.get("/api/user/my-permissions", headers=non_admin_auth_header)
    assert resp.status_code == 200
    sys_objs = resp.json()["system_objects"]
    rg_names = [o["name"] for o in sys_objs if o["type"] == "RESOURCE_GROUP"]
    assert "rg_my_group" in rg_names
    assert "should_not_appear" not in rg_names


def test_resource_groups_empty_classifiers(client, auth_header, query_map):
    """Resource group with no classifiers produces empty JSON array."""
    import json as _json
    query_map["SHOW RESOURCE GROUPS ALL"] = [
        {"name": "default_wg", "cpu_weight": "32", "mem_limit": "100%",
         "concurrency_limit": "0", "classifiers": ""},
    ]
    resp = client.get("/api/user/my-permissions", headers=auth_header)
    assert resp.status_code == 200
    sys_objs = resp.json()["system_objects"]
    rg = next((o for o in sys_objs if o["type"] == "RESOURCE_GROUP" and o["name"] == "default_wg"), None)
    assert rg is not None
    assert _json.loads(rg["classifiers"]) == []


def test_resource_groups_skips_empty_name(client, auth_header, query_map):
    """Rows with empty name are skipped."""
    query_map["SHOW RESOURCE GROUPS ALL"] = [
        {"name": "", "cpu_weight": "1", "mem_limit": "10%", "concurrency_limit": "0", "classifiers": ""},
        {"name": "rg_valid", "cpu_weight": "4", "mem_limit": "20%", "concurrency_limit": "5", "classifiers": ""},
    ]
    resp = client.get("/api/user/my-permissions", headers=auth_header)
    assert resp.status_code == 200
    sys_objs = resp.json()["system_objects"]
    rg_names = [o["name"] for o in sys_objs if o["type"] == "RESOURCE_GROUP"]
    assert "rg_valid" in rg_names
    assert "" not in rg_names


# ── Role BFS: cycles, shared children, effective-privilege recursion ──


def test_role_cycle_and_shared_child_traversal(client, auth_header, query_map):
    """Two direct roles sharing a child, plus a back-edge (role_a ↔ role_b).

    Exercises the BFS 'already visited' guard, child-role collection, and the
    recursive effective-privilege walk with its own cycle guard — without
    infinite-looping or dropping any role's grants.
    """
    query_map["SHOW GRANTS FOR 'test_admin'"] = [
        {"Grants": "GRANT 'role_a', 'role_c' TO 'test_admin'@'%'"},
    ]
    query_map["SHOW GRANTS FOR ROLE 'role_a'"] = [
        {"Grants": "GRANT 'role_b' TO ROLE 'role_a'"},
        {"Grants": "GRANT SELECT ON TABLE default_catalog.analytics_db.t1 TO ROLE 'role_a'",
         "Catalog": "default_catalog"},
    ]
    query_map["SHOW GRANTS FOR ROLE 'role_c'"] = [
        {"Grants": "GRANT 'role_b' TO ROLE 'role_c'"},
        {"Grants": "GRANT UPDATE ON TABLE default_catalog.analytics_db.t3 TO ROLE 'role_c'",
         "Catalog": "default_catalog"},
    ]
    query_map["SHOW GRANTS FOR ROLE 'role_b'"] = [
        {"Grants": "GRANT 'role_a' TO ROLE 'role_b'"},  # back-edge → cycle
        {"Grants": "GRANT INSERT ON TABLE default_catalog.analytics_db.t2 TO ROLE 'role_b'",
         "Catalog": "default_catalog"},
    ]
    resp = client.get("/api/user/my-permissions", headers=auth_header)
    assert resp.status_code == 200
    data = resp.json()
    assert data["direct_roles"] == ["role_a", "role_c"]
    for role in ("role_a", "role_b", "role_c"):
        assert role in data["role_tree"]
    assert data["role_tree"]["role_a"]["parent_roles"] == ["role_b"]
    priv_types = {p["privilege_type"] for p in data["effective_privileges"]}
    assert {"SELECT", "UPDATE", "INSERT"} <= priv_types


# ── System-object sections: best-effort skip when the query fails ──


@pytest.mark.parametrize(
    "fail_prefix,absent_type",
    [
        ("SHOW RESOURCE GROUPS", "RESOURCE_GROUP"),
        ("SHOW STORAGE VOLUMES", "STORAGE_VOLUME"),
        ("SHOW RESOURCES", "RESOURCE"),
        ("SHOW FULL GLOBAL FUNCTIONS", "GLOBAL_FUNCTION"),
        ("SELECT * FROM information_schema.pipes", "PIPE"),
        ("SELECT * FROM information_schema.tasks", "TASK"),
    ],
)
def test_system_section_failure_is_best_effort(
    client, mock_db, auth_header, query_map, fail_prefix, absent_type
):
    """A failing system-object query drops only its own section; endpoint still 200."""
    _seed_system_objects(query_map)
    mock_db.fail_prefixes = {fail_prefix: RuntimeError("boom")}
    resp = client.get("/api/user/my-permissions", headers=auth_header)
    assert resp.status_code == 200
    types = {o["type"] for o in resp.json()["system_objects"]}
    assert absent_type not in types
    # A sibling section is unaffected (proves it was a targeted skip, not a wipe).
    assert "RESOURCE_GROUP" in types or absent_type == "RESOURCE_GROUP"


def test_task_runs_failure_keeps_tasks_without_state(client, mock_db, auth_header, query_map):
    """If the task_runs state lookup fails, tasks still appear with empty state."""
    _seed_system_objects(query_map)
    mock_db.fail_prefixes = {"SELECT TASK_NAME, STATE FROM information_schema.task_runs": RuntimeError("x")}
    resp = client.get("/api/user/my-permissions", headers=auth_header)
    assert resp.status_code == 200
    tasks = [o for o in resp.json()["system_objects"] if o["type"] == "TASK"]
    assert tasks and tasks[0]["state"] == ""


def test_warehouse_falls_back_to_show_proc(client, mock_db, auth_header, query_map):
    """SHOW WAREHOUSES failure falls back to SHOW PROC '/warehouses'."""
    query_map["SHOW PROC '/warehouses'"] = [
        {"Name": "wh_proc", "State": "RUNNING", "NodeCount": "2", "RunningSql": "1", "QueuedSql": "0"},
    ]
    mock_db.fail_prefixes = {"SHOW WAREHOUSES": RuntimeError("no perm")}
    resp = client.get("/api/user/my-permissions", headers=auth_header)
    assert resp.status_code == 200
    whs = [o for o in resp.json()["system_objects"] if o["type"] == "WAREHOUSE"]
    assert any(w["name"] == "wh_proc" for w in whs)


def test_warehouse_both_sources_fail_is_best_effort(client, mock_db, auth_header, query_map):
    """When both warehouse sources fail, the section is skipped and endpoint 200s."""
    mock_db.fail_prefixes = {
        "SHOW WAREHOUSES": RuntimeError("no perm"),
        "SHOW PROC '/warehouses'": RuntimeError("no perm"),
    }
    resp = client.get("/api/user/my-permissions", headers=auth_header)
    assert resp.status_code == 200
    types = {o["type"] for o in resp.json()["system_objects"]}
    assert "WAREHOUSE" not in types


def test_storage_volume_desc_failure_falls_back(client, mock_db, auth_header, query_map):
    """DESC STORAGE VOLUME failure still records the volume (without detail)."""
    query_map["SHOW STORAGE VOLUMES"] = [{"Storage Volume": "sv_main"}]
    mock_db.fail_prefixes = {"DESC STORAGE VOLUME": RuntimeError("denied")}
    resp = client.get("/api/user/my-permissions", headers=auth_header)
    assert resp.status_code == 200
    svs = [o for o in resp.json()["system_objects"] if o["type"] == "STORAGE_VOLUME"]
    assert any(sv["name"] == "sv_main" for sv in svs)


def test_resources_skips_empty_name(client, auth_header, query_map):
    """Resource rows with an empty Name are skipped."""
    query_map["SHOW RESOURCES"] = [
        {"Name": "", "ResourceType": "jdbc", "Key": "jdbc_uri", "Value": "x"},
        {"Name": "jdbc_pg", "ResourceType": "jdbc", "Key": "jdbc_uri", "Value": "jdbc:postgresql://h/db"},
    ]
    resp = client.get("/api/user/my-permissions", headers=auth_header)
    assert resp.status_code == 200
    res_names = [o["name"] for o in resp.json()["system_objects"] if o["type"] == "RESOURCE"]
    assert "jdbc_pg" in res_names
    assert "" not in res_names


def test_function_properties_propagated(client, auth_header, query_map):
    """A per-database function with non-empty Properties surfaces the properties field."""
    query_map["SHOW FULL FUNCTIONS FROM"] = [
        {"Signature": "parse_ua(VARCHAR)", "Return Type": "VARCHAR",
         "Function Type": "Scalar", "Properties": '{"symbol":"ParseUa"}'},
    ]
    resp = client.get("/api/user/my-permissions", headers=auth_header)
    assert resp.status_code == 200
    fns = [o for o in resp.json()["accessible_objects"] if o["type"] == "FUNCTION"]
    assert fns and fns[0]["properties"] == '{"symbol":"ParseUa"}'
    assert fns[0]["return_type"] == "VARCHAR"
    assert fns[0]["function_type"] == "Scalar"


# ── Catalog loop: best-effort skips ──


def test_show_catalogs_failure_is_best_effort(client, mock_db, auth_header, query_map):
    """A failing SHOW CATALOGS yields no catalogs but still returns 200."""
    mock_db.fail_prefixes = {"SHOW CATALOGS": RuntimeError("denied")}
    resp = client.get("/api/user/my-permissions", headers=auth_header)
    assert resp.status_code == 200
    assert resp.json()["accessible_catalogs"] == []


def test_catalog_set_catalog_failure_skips_catalog(client, mock_db, auth_header, query_map):
    """A catalog whose SET CATALOG fails is skipped; others still enumerate."""
    mock_db.fail_prefixes = {"SET CATALOG `iceberg_catalog`": RuntimeError("denied")}
    resp = client.get("/api/user/my-permissions", headers=auth_header)
    assert resp.status_code == 200
    dbs = resp.json()["accessible_databases"]
    assert dbs  # default_catalog still enumerated
    assert all(d["catalog"] != "iceberg_catalog" for d in dbs)


def test_schemata_failure_is_best_effort(client, mock_db, auth_header, query_map):
    """A failing schemata query yields no databases but still returns 200."""
    mock_db.fail_prefixes = {
        "SELECT SCHEMA_NAME FROM information_schema.schemata": RuntimeError("denied")
    }
    resp = client.get("/api/user/my-permissions", headers=auth_header)
    assert resp.status_code == 200
    assert resp.json()["accessible_databases"] == []


def test_tables_failure_is_best_effort(client, mock_db, auth_header, query_map):
    """A failing tables query drops table objects but still returns 200."""
    _seed_object_loop(query_map)
    mock_db.fail_prefixes = {
        "SELECT TABLE_SCHEMA, TABLE_NAME, TABLE_TYPE, TABLE_ROWS, DATA_LENGTH": RuntimeError("denied")
    }
    resp = client.get("/api/user/my-permissions", headers=auth_header)
    assert resp.status_code == 200
    types = {o["type"] for o in resp.json()["accessible_objects"]}
    assert "BASE TABLE" not in types


def test_materialized_views_query_failure_is_best_effort(client, mock_db, auth_header, query_map):
    """A failing materialized_views probe leaves tables intact (none typed as MV)."""
    _seed_object_loop(query_map)
    mock_db.fail_prefixes = {
        "SELECT TABLE_SCHEMA, TABLE_NAME FROM information_schema.materialized_views": RuntimeError("x")
    }
    resp = client.get("/api/user/my-permissions", headers=auth_header)
    assert resp.status_code == 200
    objs = resp.json()["accessible_objects"]
    assert any(o["name"] == "user_events" for o in objs)
    assert all(o["type"] != "MATERIALIZED VIEW" for o in objs)


def test_functions_query_failure_is_best_effort(client, mock_db, auth_header, query_map):
    """A failing SHOW FULL FUNCTIONS per database is skipped; endpoint still 200."""
    mock_db.fail_prefixes = {"SHOW FULL FUNCTIONS FROM": RuntimeError("denied")}
    resp = client.get("/api/user/my-permissions", headers=auth_header)
    assert resp.status_code == 200
    types = {o["type"] for o in resp.json()["accessible_objects"]}
    assert "FUNCTION" not in types


def test_restore_set_catalog_failure_is_best_effort(client, mock_db, auth_header, query_map):
    """Failing the default_catalog SET CATALOG (incl. the restore) is non-fatal."""
    mock_db.fail_prefixes = {"SET CATALOG `default_catalog`": RuntimeError("denied")}
    resp = client.get("/api/user/my-permissions", headers=auth_header)
    assert resp.status_code == 200
    # default_catalog is skipped in the loop; iceberg_catalog still enumerates.
    assert all(d["catalog"] != "default_catalog" for d in resp.json()["accessible_databases"])


# ── Full query footprint (strict mode) ──


def test_query_footprint_strict(client, strict_queries, query_map, auth_header):
    """Pin the endpoint's entire query footprint.

    In strict mode every SQL the endpoint issues must have an explicit query_map
    prefix. The endpoint swallows per-section errors, so instead of relying on the
    (swallowed) AssertionError we assert the connection recorded no unmatched SQL.
    Adding a new unmapped query to the endpoint records a miss here and fails.
    """
    _seed_system_objects(query_map)
    _seed_object_loop(query_map)
    resp = client.get("/api/user/my-permissions", headers=auth_header)
    assert resp.status_code == 200
    assert strict_queries.unmatched == [], (
        f"endpoint issued SQL with no query_map entry: {strict_queries.unmatched}"
    )
