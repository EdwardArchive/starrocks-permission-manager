def test_user_privileges(client, auth_header):
    resp = client.get("/api/privileges/user/test_admin", headers=auth_header)
    assert resp.status_code == 200
    data = resp.json()
    assert isinstance(data, list)
    assert len(data) >= 1
    grant = data[0]
    assert grant["grantee"] == "test_admin"
    assert grant["grantee_type"] == "USER"
    assert grant["privilege_type"] == "SELECT"
    assert grant["object_name"] == "user_events"
    assert grant["source"] == "direct"


def test_user_effective_privileges(client, auth_header):
    resp = client.get("/api/privileges/user/test_admin/effective", headers=auth_header)
    assert resp.status_code == 200
    data = resp.json()
    assert isinstance(data, list)
    # Should have at least direct grants
    assert len(data) >= 1
    sources = {g["source"] for g in data}
    assert "direct" in sources


def test_role_privileges(client, auth_header):
    resp = client.get("/api/privileges/role/analyst_role", headers=auth_header)
    assert resp.status_code == 200
    data = resp.json()
    assert isinstance(data, list)
    assert len(data) >= 1
    grant = data[0]
    assert grant["grantee"] == "analyst_role"
    assert grant["grantee_type"] == "ROLE"
    assert grant["privilege_type"] == "SELECT"


def test_object_privileges(client, auth_header):
    resp = client.get(
        "/api/privileges/object",
        params={
            "catalog": "default_catalog",
            "database": "analytics_db",
            "name": "user_events",
        },
        headers=auth_header,
    )
    assert resp.status_code == 200
    data = resp.json()
    assert isinstance(data, list)
    # Should have grants from both users and roles
    grantee_types = {g["grantee_type"] for g in data}
    assert "USER" in grantee_types
    assert "ROLE" in grantee_types


def test_object_privileges_no_filter(client, auth_header):
    """No filter params → returns all grants."""
    resp = client.get("/api/privileges/object", headers=auth_header)
    assert resp.status_code == 200
    data = resp.json()
    assert isinstance(data, list)
