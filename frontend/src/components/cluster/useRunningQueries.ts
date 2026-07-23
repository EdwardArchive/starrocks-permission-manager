/**
 * useRunningQueries — owns the "Running" subtab's data domain.
 *
 * Fetches SHOW PROC '/global_current_queries' (via the cluster API), tracks
 * loading / error / denied state, derives the instantaneous per-query CPU from
 * the poll-to-poll delta, and drives the poll loop. The immediate fetch fires
 * on activation and on interval change; periodic ticks are skipped while the
 * page is hidden (usePolling) or after a 403 (deniedRef). Requests are aborted
 * on leave / interval change. The delta math lives in the pure
 * `deriveInstCores`; this hook keeps only the sample-ref plumbing.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { getClusterQueries } from "../../api/cluster";
import { usePolling } from "../../hooks/usePolling";
import { ApiError } from "../../api/client";
import { deriveInstCores, type CpuSampleMap } from "../../utils/queryCpu";
import type { ClusterQueriesResponse } from "../../types";

interface FetchError {
  status: number | null;
  message: string;
}

export interface UseRunningQueriesResult {
  running: ClusterQueriesResponse | null;
  error: FetchError | null;
  loading: boolean;
  instCores: Map<string, number>;
  lastUpdated: number | null;
  /** Fetch now; pass true to force a server-side cache bypass (refresh). */
  refresh: (refresh?: boolean) => void;
}

export function useRunningQueries({
  active,
  intervalMs,
}: {
  active: boolean;
  intervalMs: number;
}): UseRunningQueriesResult {
  const [running, setRunning] = useState<ClusterQueriesResponse | null>(null);
  const [error, setError] = useState<FetchError | null>(null);
  const [loading, setLoading] = useState(true);
  const [instCores, setInstCores] = useState<Map<string, number>>(new Map());
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const deniedRef = useRef(false);
  // instantaneous CPU: query_id → { cpuMs, atMs }, sampled each poll
  const cpuSamples = useRef<CpuSampleMap>(new Map());

  const refresh = useCallback((refresh = false) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    getClusterQueries(controller.signal, refresh)
      .then((res) => {
        deniedRef.current = false;
        // derive instantaneous CPU from the delta vs the previous sample
        const nowMs = Date.now();
        const { nextSamples, instCores: nextInst } = deriveInstCores(cpuSamples.current, res, nowMs);
        cpuSamples.current = nextSamples;
        setInstCores(nextInst);
        setRunning(res);
        setError(null);
        setLoading(false);
        setLastUpdated(nowMs);
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        const status = err instanceof ApiError ? err.status : null;
        if (status === 403) deniedRef.current = true;
        setError({ status, message: err instanceof Error ? err.message : "Unknown error" });
        setLoading(false);
      });
  }, []);

  // Fetch now on activation / interval change; then poll on the selected
  // interval while active (ticks skipped while hidden or after a 403).
  useEffect(() => {
    if (!active) return;
    refresh();
    return () => abortRef.current?.abort();
  }, [active, intervalMs, refresh]);
  usePolling(() => { if (!deniedRef.current) refresh(); }, intervalMs, { enabled: active });

  return { running, error, loading, instCores, lastUpdated, refresh };
}
