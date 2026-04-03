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
