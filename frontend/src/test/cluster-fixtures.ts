/** Shared test factories for cluster monitoring components. */
import type { ClusterStatusResponse, RunningQueryInfo } from "../types";

export function makeFENode(
  overrides: Partial<ClusterStatusResponse["frontends"][0]> = {},
): ClusterStatusResponse["frontends"][0] {
  return {
    name: "fe-01",
    ip: "10.0.0.1",
    edit_log_port: 9010,
    http_port: 8030,
    query_port: 9030,
    rpc_port: 9020,
    role: "LEADER",
    alive: true,
    join: true,
    last_heartbeat: null,
    replayed_journal_id: 12345,
    start_time: "2026-04-19 10:00:00",
    version: "3.3.0",
    err_msg: null,
    jvm_heap_used_pct: 45.2,
    gc_young_count: 10,
    gc_young_time_ms: 500,
    gc_old_count: 1,
    gc_old_time_ms: 200,
    query_p99_ms: 15.3,
    metrics_error: null,
    ...overrides,
  };
}

export function makeBENode(
  overrides: Partial<ClusterStatusResponse["backends"][0]> = {},
): ClusterStatusResponse["backends"][0] {
  return {
    name: "be-01",
    ip: "10.0.0.2",
    node_type: "backend",
    heartbeat_port: 9050,
    be_port: 9060,
    http_port: 8040,
    brpc_port: 8060,
    alive: true,
    last_heartbeat: null,
    last_start_time: "2026-04-19 10:00:00",
    tablet_count: 1000,
    data_used_capacity: "100 GB",
    total_capacity: "500 GB",
    used_pct: 20.5,
    cpu_cores: 8,
    cpu_used_pct: null,
    mem_used_pct: 60.3,
    mem_limit: "16 GB",
    num_running_queries: 3,
    warehouse: null,
    version: "3.3.0",
    err_msg: null,
    ...overrides,
  };
}

export function makeClusterData(
  overrides: Partial<ClusterStatusResponse> = {},
): ClusterStatusResponse {
  return {
    frontends: [makeFENode()],
    backends: [makeBENode()],
    metrics: {
      fe_total: 1,
      fe_alive: 1,
      be_total: 1,
      be_alive: 1,
      cn_total: 0,
      cn_alive: 0,
      total_tablets: 1000,
      total_data_used: "100 GB",
      avg_disk_used_pct: 20.5,
      avg_cpu_used_pct: null,
      avg_mem_used_pct: 60.3,
      avg_fe_heap_used_pct: 45.2,
    },
    has_errors: false,
    mode: "full",
    metrics_warning: null,
    server_now: null,
    ...overrides,
  };
}

export function makeQuery(overrides: Partial<RunningQueryInfo> = {}): RunningQueryInfo {
  return {
    query_id: "q-001",
    connection_id: 50335321,
    user: "root",
    database: "sales",
    start_time: "2026-06-12 01:24:32",
    fe_ip: "fe-01",
    warehouse: "default_warehouse",
    resource_group: "default_wg",
    exec_state: "RUNNING",
    exec_progress: null,
    scan_rows: 1787602878,
    scan_bytes: 14301167000,
    scan_bytes_display: "13.319 GB",
    memory_bytes: 481457000,
    memory_display: "459.154 MB",
    spill_bytes: 0,
    spill_display: "0.000 B",
    cpu_time_ms: 478,
    cpu_time_display: "0.478 s",
    exec_time_ms: 2126,
    exec_time_display: "2.126 s",
    cpu_avg_cores: 0.22,
    sql: "SELECT count(*) FROM sales.orders",
    ...overrides,
  };
}
