def test_search(client, auth_header):
    resp = client.get("/api/admin/search", params={"q": "user"}, headers=auth_header)
    assert resp.status_code == 200
    data = resp.json()
    assert isinstance(data, list)
    for item in data:
        assert "name" in item
        assert "type" in item
        assert "path" in item
        assert item["type"] in ("table", "view", "database", "role", "user")


def test_search_min_length(client, auth_header):
    resp = client.get("/api/admin/search", params={"q": ""}, headers=auth_header)
    assert resp.status_code == 422  # min_length=1 validation


def test_search_limit(client, auth_header):
    resp = client.get("/api/admin/search", params={"q": "test", "limit": 5}, headers=auth_header)
    assert resp.status_code == 200
    data = resp.json()
    assert len(data) <= 5


def test_search_roles(client, auth_header):
    resp = client.get("/api/admin/search", params={"q": "admin"}, headers=auth_header)
    assert resp.status_code == 200
    data = resp.json()
    role_results = [r for r in data if r["type"] == "role"]
    # db_admin, user_admin should match
    role_names = {r["name"] for r in role_results}
    assert "db_admin" in role_names or "user_admin" in role_names


def test_search_tables(client, auth_header):
    resp = client.get("/api/admin/search", params={"q": "events"}, headers=auth_header)
    assert resp.status_code == 200
    data = resp.json()
    table_results = [r for r in data if r["type"] == "table"]
    names = {r["name"] for r in table_results}
    assert "user_events" in names


# ── GET /api/admin/search/users-roles ──


def test_users_roles_dedup_and_types(client, auth_header, query_map):
    # alice_kim appears in BOTH sys.role_edges and sys.grants_to_users → deduped to one.
    query_map["SELECT DISTINCT TO_USER FROM sys.role_edges"] = [
        {"TO_USER": "alice_kim"},
        {"TO_USER": "alice_lee"},
    ]
    query_map["SELECT DISTINCT GRANTEE FROM sys.grants_to_users"] = [
        {"GRANTEE": "alice_kim"},
        {"GRANTEE": "alice_park"},
    ]
    query_map["SHOW ROLES"] = [
        {"Name": "alice_role"},
        {"Name": "unrelated_role"},
    ]
    resp = client.get("/api/admin/search/users-roles", params={"q": "alice"}, headers=auth_header)
    assert resp.status_code == 200
    data = resp.json()

    # alice_kim (in both sources) appears exactly once, tagged user.
    alice_users = [r for r in data if r["name"] == "alice_kim"]
    assert len(alice_users) == 1
    assert alice_users[0]["type"] == "user"
    assert alice_users[0]["path"] == "user:alice_kim"

    names_types = {(r["name"], r["type"]) for r in data}
    assert ("alice_lee", "user") in names_types
    assert ("alice_park", "user") in names_types

    # Matching role included; non-matching role excluded (Python keyword filter).
    assert ("alice_role", "role") in names_types
    assert "unrelated_role" not in {r["name"] for r in data}
    role_entry = next(r for r in data if r["name"] == "alice_role")
    assert role_entry["path"] == "role:alice_role"


def test_users_roles_role_filter_case_insensitive(client, auth_header, query_map):
    query_map["SELECT DISTINCT TO_USER FROM sys.role_edges"] = []
    query_map["SELECT DISTINCT GRANTEE FROM sys.grants_to_users"] = []
    query_map["SHOW ROLES"] = [{"Name": "db_admin"}, {"Name": "public"}]
    resp = client.get("/api/admin/search/users-roles", params={"q": "ADMIN"}, headers=auth_header)
    assert resp.status_code == 200
    names = {r["name"] for r in resp.json()}
    assert "db_admin" in names  # q.lower() in name.lower()
    assert "public" not in names


def test_users_roles_empty_result(client, auth_header, query_map):
    query_map["SELECT DISTINCT TO_USER FROM sys.role_edges"] = []
    query_map["SELECT DISTINCT GRANTEE FROM sys.grants_to_users"] = []
    resp = client.get(
        "/api/admin/search/users-roles",
        params={"q": "zzz_no_such_entity"},
        headers=auth_header,
    )
    assert resp.status_code == 200
    assert resp.json() == []


def test_users_roles_respects_limit(client, auth_header, query_map):
    query_map["SELECT DISTINCT TO_USER FROM sys.role_edges"] = [
        {"TO_USER": "svc_a"},
        {"TO_USER": "svc_b"},
        {"TO_USER": "svc_c"},
    ]
    query_map["SELECT DISTINCT GRANTEE FROM sys.grants_to_users"] = []
    query_map["SHOW ROLES"] = []
    resp = client.get(
        "/api/admin/search/users-roles",
        params={"q": "svc", "limit": 2},
        headers=auth_header,
    )
    assert resp.status_code == 200
    assert len(resp.json()) == 2
