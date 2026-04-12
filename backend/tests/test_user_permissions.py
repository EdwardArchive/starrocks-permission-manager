"""Tests for GET /api/user/my-permissions endpoint.

Covers: user_permissions.py router — direct grants, role BFS, catalogs,
databases, objects, functions, MVs, system objects, effective privileges.
"""
from __future__ import annotations


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
