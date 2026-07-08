/**
 * queryCpu — instantaneous CPU derivation for running queries.
 *
 * StarRocks reports each running query's *cumulative* CPU time (cpu_time_ms).
 * Dividing the poll-to-poll delta by the wall-clock delta yields the average
 * cores kept busy over that interval — an "instantaneous" CPU figure that
 * complements the since-start `cpu_avg_cores`.
 *
 * `deriveInstCores` is pure: given the previous per-query samples, the new
 * response, and the current wall clock, it returns the next sample map (to
 * store for the following poll) and the derived cores per query. The caller
 * owns only the ref plumbing (persist `nextSamples`, publish `instCores`).
 */
import type { ClusterQueriesResponse } from "../types";

/** One cumulative-CPU sample: cpuMs (cumulative CPU) captured at wall time atMs. */
export interface CpuSample {
  cpuMs: number;
  atMs: number;
}

export type CpuSampleMap = Map<string, CpuSample>;

export interface DeriveInstCoresResult {
  /** Samples to persist for the next poll — rebuilt from the current response
   *  so queries that have finished are pruned automatically. */
  nextSamples: CpuSampleMap;
  /** query_id → instantaneous cores over the last interval. */
  instCores: Map<string, number>;
}

export function deriveInstCores(
  prevSample: CpuSampleMap,
  res: ClusterQueriesResponse,
  nowMs: number,
): DeriveInstCoresResult {
  const nextSamples: CpuSampleMap = new Map();
  const instCores = new Map<string, number>();
  for (const q of res.queries) {
    if (q.cpu_time_ms != null) {
      const prev = prevSample.get(q.query_id);
      nextSamples.set(q.query_id, { cpuMs: q.cpu_time_ms, atMs: nowMs });
      if (prev && nowMs > prev.atMs) {
        const cores = (q.cpu_time_ms - prev.cpuMs) / (nowMs - prev.atMs);
        if (cores >= 0) instCores.set(q.query_id, cores);
      }
    }
  }
  return { nextSamples, instCores };
}
