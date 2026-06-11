import type { RunningQueryInfo } from "../types";

export type QuerySortKey =
  | "exec_time_ms"
  | "cpu_time_ms"
  | "cpu_avg_cores"
  | "memory_bytes"
  | "scan_rows"
  | "scan_bytes"
  | "spill_bytes";

/** Sort running queries by a numeric column; nulls always sink to the bottom. */
export function sortQueries(
  queries: RunningQueryInfo[],
  key: QuerySortKey,
  dir: "asc" | "desc",
): RunningQueryInfo[] {
  const sign = dir === "asc" ? 1 : -1;
  return [...queries].sort((a, b) => {
    const av = a[key];
    const bv = b[key];
    if (av == null && bv == null) return 0;
    if (av == null) return 1;
    if (bv == null) return -1;
    return (av - bv) * sign;
  });
}
