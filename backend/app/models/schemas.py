from __future__ import annotations

from pydantic import BaseModel


# ── Auth ──
class LoginRequest(BaseModel):
    host: str
    port: int = 9030
    username: str
    password: str


class LoginResponse(BaseModel):
    token: str
    username: str
    roles: list[str]
    default_role: str | None = None


class UserInfo(BaseModel):
    username: str
    roles: list[str]
    default_role: str | None = None
    is_user_admin: bool = False


# ── Objects ──
class CatalogItem(BaseModel):
    name: str
    catalog_type: str  # InternalCatalog / HiveCatalog / IcebergCatalog ...


class DatabaseItem(BaseModel):
    name: str
    catalog: str


class ObjectItem(BaseModel):
    name: str
    object_type: str  # TABLE / VIEW / MATERIALIZED VIEW / FUNCTION
    catalog: str
    database: str


# ── Privileges ──
class PrivilegeGrant(BaseModel):
    grantee: str
    grantee_type: str  # USER / ROLE
    object_catalog: str | None = None
    object_database: str | None = None
    object_name: str | None = None
    object_type: str
    privilege_type: str
    is_grantable: bool = False
    source: str = "direct"  # "direct" or role name


# ── Roles ──
class RoleItem(BaseModel):
    name: str
    is_builtin: bool = False


class RoleEdge(BaseModel):
    parent_role: str
    child_role: str


# ── DAG ──
class DAGNode(BaseModel):
    id: str
    label: str
    type: str  # system/catalog/database/table/view/mv/function/user/role
    color: str | None = None
    node_role: str | None = None  # "group" for virtual grouping nodes
    metadata: dict | None = None


class DAGEdge(BaseModel):
    id: str
    source: str
    target: str
    edge_type: str  # hierarchy/assignment/inheritance/select/insert/delete/alter/usage


class DAGGraph(BaseModel):
    nodes: list[DAGNode]
    edges: list[DAGEdge]


# ── Table Details (INFORMATION_SCHEMA based) ──
class ColumnInfo(BaseModel):
    name: str
    column_type: str
    ordinal_position: int
    is_nullable: str
    column_default: str | None = None
    column_key: str | None = None
    comment: str | None = None


class TableDetail(BaseModel):
    table_name: str
    table_type: str
    engine: str | None = None
    row_count: int | None = None
    data_size: int | None = None
    create_time: str | None = None
    update_time: str | None = None
    comment: str | None = None
    columns: list[ColumnInfo] = []
    ddl: str | None = None
    # Internal-only fields (None for external catalogs)
    key_type: str | None = None
    distribution_type: str | None = None
    bucket_keys: list[str] | None = None
    bucket_count: int | None = None
    partition_method: str | None = None
    partition_key: str | None = None
    partition_count: int | None = None
    replication_num: int | None = None
    storage_medium: str | None = None
    compression: str | None = None
