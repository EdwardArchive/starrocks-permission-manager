// ── Auth ──
export interface LoginRequest {
  host: string;
  port: number;
  username: string;
  password: string;
}
export interface LoginResponse {
  token: string;
  username: string;
  roles: string[];
  default_role: string | null;
}
export interface UserInfo {
  username: string;
  roles: string[];
  default_role: string | null;
  is_user_admin: boolean;
}

// ── Objects ──
export interface CatalogItem {
  name: string;
  catalog_type: string;
}
export interface DatabaseItem {
  name: string;
  catalog: string;
}
export interface ObjectItem {
  name: string;
  object_type: string;
  catalog: string;
  database: string;
}

// ── Privileges ──
export interface PrivilegeGrant {
  grantee: string;
  grantee_type: string;
  object_catalog: string | null;
  object_database: string | null;
  object_name: string | null;
  object_type: string;
  privilege_type: string;
  is_grantable: boolean;
  source: string;
}

// ── Roles ──
export interface RoleItem {
  name: string;
  is_builtin: boolean;
}

// ── DAG ──
export interface DAGNode {
  id: string;
  label: string;
  type: string;
  color?: string | null;
  node_role?: string | null;
  metadata?: Record<string, unknown> | null;
}
export interface DAGEdge {
  id: string;
  source: string;
  target: string;
  edge_type: string;
}
export interface DAGGraph {
  nodes: DAGNode[];
  edges: DAGEdge[];
}

// ── Table Detail ──
export interface ColumnInfo {
  name: string;
  column_type: string;
  ordinal_position: number;
  is_nullable: string;
  column_default: string | null;
  column_key: string | null;
  comment: string | null;
}
export interface TableDetail {
  table_name: string;
  table_type: string;
  engine: string | null;
  row_count: number | null;
  data_size: number | null;
  create_time: string | null;
  update_time: string | null;
  comment: string | null;
  columns: ColumnInfo[];
  ddl: string | null;
  key_type: string | null;
  distribution_type: string | null;
  bucket_keys: string[] | null;
  bucket_count: number | null;
  partition_method: string | null;
  partition_key: string | null;
  partition_count: number | null;
  replication_num: number | null;
  storage_medium: string | null;
  compression: string | null;
}

// ── Cluster Status ──
export interface FENodeInfo {
  name: string;
  ip: string;
  edit_log_port: number | null;
  http_port: number | null;
  query_port: number | null;
  rpc_port: number | null;
  role: string;
  alive: boolean;
  join: boolean;
  last_heartbeat: string | null;
  replayed_journal_id: number | null;
  start_time: string | null;
  version: string | null;
  err_msg: string | null;
  // Populated from FE /metrics endpoint
  jvm_heap_used_pct: number | null;
  gc_young_count: number | null;
  gc_young_time_ms: number | null;
  gc_old_count: number | null;
  gc_old_time_ms: number | null;
  query_p99_ms: number | null;
  metrics_error: string | null;
}

export interface BENodeInfo {
  name: string;
  ip: string;
  node_type: "backend" | "compute";
  heartbeat_port: number | null;
  be_port: number | null;
  http_port: number | null;
  brpc_port: number | null;
  alive: boolean;
  last_heartbeat: string | null;
  last_start_time: string | null;
  tablet_count: number | null;
  data_used_capacity: string | null;
  total_capacity: string | null;
  used_pct: number | null;
  cpu_cores: number | null;
  cpu_used_pct: number | null;
  mem_used_pct: number | null;
  mem_limit: string | null;
  num_running_queries: number | null;
  warehouse: string | null;
  version: string | null;
  err_msg: string | null;
}

export interface ClusterMetrics {
  fe_total: number;
  fe_alive: number;
  be_total: number;
  be_alive: number;
  cn_total: number;
  cn_alive: number;
  total_tablets: number | null;
  total_data_used: string | null;
  avg_disk_used_pct: number | null;
  avg_cpu_used_pct: number | null;
  avg_mem_used_pct: number | null;
  avg_fe_heap_used_pct: number | null;
}

export interface ClusterStatusResponse {
  frontends: FENodeInfo[];
  backends: BENodeInfo[];
  metrics: ClusterMetrics;
  has_errors: boolean;
  mode: "full" | "limited";
  metrics_warning: string | null;
}
