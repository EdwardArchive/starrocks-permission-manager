from __future__ import annotations

from typing import Literal

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
    can_manage_grants: bool = False


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


# ── Cluster Status ──
class FENodeInfo(BaseModel):
    name: str
    ip: str
    edit_log_port: int | None = None
    http_port: int | None = None
    query_port: int | None = None
    rpc_port: int | None = None
    role: str
    alive: bool
    join: bool
    last_heartbeat: str | None = None
    replayed_journal_id: int | None = None
    start_time: str | None = None
    version: str | None = None
    err_msg: str | None = None
    # Populated from FE /metrics endpoint (unauthenticated Prometheus scrape)
    jvm_heap_used_pct: float | None = None
    gc_young_count: int | None = None
    gc_young_time_ms: int | None = None
    gc_old_count: int | None = None
    gc_old_time_ms: int | None = None
    query_p99_ms: float | None = None
    metrics_error: str | None = None  # null on success; short reason string on failure


class BENodeInfo(BaseModel):
    name: str
    ip: str
    node_type: Literal["backend", "compute"] = "backend"  # "backend" (SHOW BACKENDS) or "compute" (SHOW COMPUTE NODES)
    heartbeat_port: int | None = None
    be_port: int | None = None
    http_port: int | None = None
    brpc_port: int | None = None
    alive: bool
    last_heartbeat: str | None = None
    last_start_time: str | None = None
    tablet_count: int | None = None
    data_used_capacity: str | None = None
    total_capacity: str | None = None
    used_pct: float | None = None
    cpu_cores: int | None = None
    cpu_used_pct: float | None = None  # Only populated for compute nodes (SHOW COMPUTE NODES)
    mem_used_pct: float | None = None
    mem_limit: str | None = None  # Human-readable total memory (e.g. "75.687GB"); CN only
    num_running_queries: int | None = None
    warehouse: str | None = None  # Only populated for compute nodes
    version: str | None = None
    err_msg: str | None = None


class ClusterMetrics(BaseModel):
    fe_total: int
    fe_alive: int
    be_total: int
    be_alive: int
    cn_total: int = 0
    cn_alive: int = 0
    total_tablets: int | None = None
    total_data_used: str | None = None
    avg_disk_used_pct: float | None = None
    avg_cpu_used_pct: float | None = None
    avg_mem_used_pct: float | None = None
    avg_fe_heap_used_pct: float | None = None  # from FE /metrics


class ClusterStatusResponse(BaseModel):
    frontends: list[FENodeInfo]
    backends: list[BENodeInfo]
    metrics: ClusterMetrics
    has_errors: bool
    mode: Literal["full", "limited"] = "full"  # "full" = SHOW succeeded; "limited" = access-denied fallback
    metrics_warning: str | None = None  # set iff all FE /metrics fetches failed
    # Cluster wall clock ("YYYY-MM-DD HH:MM:SS", cluster timezone). Reference for
    # relative-time labels — node timestamps are naive strings in the same zone.
    server_now: str | None = None


class RunningQueryInfo(BaseModel):
    """One row of SHOW PROC '/current_queries', joined with SHOW FULL PROCESSLIST.

    ``*_display`` fields keep StarRocks' human-readable strings ("13.319 GB");
    the numeric counterparts are parsed sort keys.
    """

    query_id: str
    connection_id: int | None = None
    user: str
    database: str | None = None
    start_time: str | None = None
    fe_ip: str | None = None
    warehouse: str | None = None
    resource_group: str | None = None
    exec_state: str | None = None  # e.g. RUNNING
    exec_progress: str | None = None
    scan_rows: int | None = None
    scan_bytes: float | None = None
    scan_bytes_display: str | None = None
    memory_bytes: float | None = None
    memory_display: str | None = None
    spill_bytes: float | None = None
    spill_display: str | None = None
    cpu_time_ms: float | None = None
    cpu_time_display: str | None = None
    exec_time_ms: float | None = None
    exec_time_display: str | None = None
    # Average parallelism since the query started: cumulative CPU time / wall
    # time = cores kept busy. The UI divides by total cluster cores for a %.
    cpu_avg_cores: float | None = None
    sql: str | None = None  # from processlist Info; None if the connection vanished


class ClusterQueriesResponse(BaseModel):
    queries: list[RunningQueryInfo]
    server_now: str | None = None
    # True when the caller may KILL queries (admin + user_admin in role chain).
    # The frontend hides the KILL action when false.
    can_kill: bool = False


class HistoryQueryInfo(BaseModel):
    """One completed query from the AuditLoader table (starrocks_audit_tbl__)."""

    query_id: str | None = None
    timestamp: str | None = None  # completion time (cluster timezone)
    user: str | None = None
    database: str | None = None
    warehouse: str | None = None
    query_type: str | None = None
    state: str | None = None  # EOF/OK = success, ERR = failure
    is_error: bool = False
    error_code: str | None = None
    query_time_ms: int | None = None
    scan_rows: int | None = None
    scan_bytes: int | None = None
    mem_cost_bytes: int | None = None
    cpu_cost_ns: int | None = None
    sql: str | None = None


class ClusterHistoryResponse(BaseModel):
    available: bool  # False when the AuditLoader table is absent/unreadable
    queries: list[HistoryQueryInfo] = []
    server_now: str | None = None
    reason: str | None = None  # why unavailable (for an in-UI hint)


class KillQueryRequest(BaseModel):
    query_id: str


class KillQueryResponse(BaseModel):
    status: Literal["ok"]
    query_id: str
    audit: Literal["ok", "failed"]


# ── Grant management (write operations) ──
class GranteeRef(BaseModel):
    name: str
    type: Literal["USER", "ROLE"]


class GrantObjectRef(BaseModel):
    object_type: str  # validated against grant_spec.GRANTABLE_PRIVILEGES
    catalog: str | None = None
    database: str | None = None
    name: str | None = None  # for FUNCTION, carries the full signature: my_udf(int,int)


class GrantRequest(BaseModel):
    action: Literal["GRANT", "REVOKE"]
    type: Literal["PRIVILEGE", "ROLE"]
    grantee: GranteeRef
    object: GrantObjectRef | None = None  # required when type == PRIVILEGE
    privileges: list[str] = []  # required when type == PRIVILEGE
    role: str | None = None  # required when type == ROLE
    with_grant_option: bool = False  # GRANT + PRIVILEGE only


class GrantPreviewResponse(BaseModel):
    sql: list[str]  # statement sequence (SET CATALOG pair for catalog-scoped objects)
    warnings: list[str] = []


class GrantExecuteResponse(BaseModel):
    sql: list[str]
    status: Literal["ok"]
    audit: Literal["ok", "failed"]


class AuditEntry(BaseModel):
    log_time: str
    actor: str
    action: str
    grant_type: str
    sql_text: str
    result: str
    error_msg: str | None = None
