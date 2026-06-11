import type { RunningQueryInfo, HistoryQueryInfo } from "../types";

export type QuerySortKey =
  | "exec_time_ms"
  | "cpu_time_ms"
  | "cpu_avg_cores"
  | "memory_bytes"
  | "scan_rows"
  | "scan_bytes"
  | "spill_bytes";

export type HistorySortKey =
  | "timestamp"
  | "query_time_ms"
  | "scan_rows"
  | "scan_bytes"
  | "mem_cost_bytes";

/** Sort by a numeric column; nulls always sink to the bottom. */
function byNumeric<T>(items: T[], key: keyof T, dir: "asc" | "desc"): T[] {
  const sign = dir === "asc" ? 1 : -1;
  return [...items].sort((a, b) => {
    const av = a[key] as number | null;
    const bv = b[key] as number | null;
    if (av == null && bv == null) return 0;
    if (av == null) return 1;
    if (bv == null) return -1;
    return (av - bv) * sign;
  });
}

export function sortQueries(
  queries: RunningQueryInfo[],
  key: QuerySortKey,
  dir: "asc" | "desc",
): RunningQueryInfo[] {
  return byNumeric(queries, key, dir);
}

export function sortHistory(
  queries: HistoryQueryInfo[],
  key: HistorySortKey,
  dir: "asc" | "desc",
): HistoryQueryInfo[] {
  if (key === "timestamp") {
    const sign = dir === "asc" ? 1 : -1;
    return [...queries].sort((a, b) => {
      const at = a.timestamp ?? "";
      const bt = b.timestamp ?? "";
      return at < bt ? -sign : at > bt ? sign : 0;
    });
  }
  return byNumeric(queries, key, dir);
}
