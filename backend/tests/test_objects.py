def test_list_catalogs(client, auth_header):
    resp = client.get("/api/objects/catalogs", headers=auth_header)
    assert resp.status_code == 200
    data = resp.json()
    assert isinstance(data, list)
    assert len(data) == 2
    names = {c["name"] for c in data}
    assert "default_catalog" in names
    assert "iceberg_catalog" in names
    # Check type field
    for c in data:
        assert "catalog_type" in c


def test_list_databases(client, auth_header):
    resp = client.get(
        "/api/objects/databases",
        params={"catalog": "default_catalog"},
        headers=auth_header,
    )
    assert resp.status_code == 200
    data = resp.json()
    assert isinstance(data, list)
    # information_schema should be filtered out
    names = {d["name"] for d in data}
    assert "information_schema" not in names
    assert "analytics_db" in names
    for d in data:
        assert d["catalog"] == "default_catalog"


def test_list_databases_missing_catalog(client, auth_header):
    resp = client.get("/api/objects/databases", headers=auth_header)
    assert resp.status_code == 422  # missing required param


def test_list_tables(client, auth_header):
    resp = client.get(
        "/api/objects/tables",
        params={"catalog": "default_catalog", "database": "analytics_db"},
        headers=auth_header,
    )
    assert resp.status_code == 200
    data = resp.json()
    assert isinstance(data, list)
    types = {o["object_type"] for o in data}
    # Should have tables, views, and functions from mock data
    assert "TABLE" in types
    assert "VIEW" in types
    assert "FUNCTION" in types
    for o in data:
        assert o["catalog"] == "default_catalog"
        assert o["database"] == "analytics_db"


def test_table_detail(client, auth_header):
    resp = client.get(
        "/api/objects/table-detail",
        params={
            "catalog": "default_catalog",
            "database": "analytics_db",
            "table": "user_events",
        },
        headers=auth_header,
    )
    assert resp.status_code == 200
    data = resp.json()

    # Common fields (information_schema)
    assert data["table_name"] == "user_events"
    assert data["table_type"] == "BASE TABLE"
    assert data["engine"] == "StarRocks"
    assert data["row_count"] == 12847293
    assert isinstance(data["columns"], list)
    assert len(data["columns"]) == 2
    assert data["columns"][0]["name"] == "event_id"

    # Internal-only fields (DDL parsed)
    assert data["key_type"] == "DUPLICATE KEY"
    assert data["distribution_type"] == "Hash"
    assert data["bucket_keys"] == ["event_id"]
    assert data["bucket_count"] == 16
    assert data["partition_method"] == "RANGE"
    assert data["partition_key"] == "event_date"
    assert data["partition_count"] == 365
    assert data["replication_num"] == 3
    assert data["storage_medium"] == "SSD"
    assert data["compression"] == "LZ4"

    # DDL
    assert data["ddl"] is not None
    assert "CREATE TABLE" in data["ddl"]


def test_table_detail_missing_params(client, auth_header):
    resp = client.get(
        "/api/objects/table-detail",
        params={"catalog": "default_catalog"},
        headers=auth_header,
    )
    assert resp.status_code == 422
