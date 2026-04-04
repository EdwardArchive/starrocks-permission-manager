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
