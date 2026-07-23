/**
 * useQueryHistory — owns the "Recent" subtab's data domain.
 *
 * Fetches completed queries from the AuditLoader history table, tracks
 * loading / error state, and drives the poll loop. The immediate fetch fires
 * on activation and on errorsOnly / interval change (and synchronously enters
 * the loading state so the spinner shows on tab open); periodic ticks are
 * skipped while the page is hidden (usePolling). Requests are aborted on
 * leave / filter / interval change.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { getClusterQueryHistory } from "../../api/cluster";
import { usePolling } from "../../hooks/usePolling";
import { ApiError } from "../../api/client";
import type { ClusterHistoryResponse } from "../../types";

const HISTORY_LIMIT = 100;

interface FetchError {
  status: number | null;
  message: string;
}

export interface UseQueryHistoryResult {
  history: ClusterHistoryResponse | null;
  error: FetchError | null;
  loading: boolean;
  lastUpdated: number | null;
  /** Fetch now with the current errorsOnly filter. */
  refresh: () => void;
}

export function useQueryHistory({
  active,
  intervalMs,
  errorsOnly,
}: {
  active: boolean;
  intervalMs: number;
  errorsOnly: boolean;
}): UseQueryHistoryResult {
  const [history, setHistory] = useState<ClusterHistoryResponse | null>(null);
  const [error, setError] = useState<FetchError | null>(null);
  const [loading, setLoading] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const fetchHistory = useCallback((errOnly: boolean) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(true);
    getClusterQueryHistory({ limit: HISTORY_LIMIT, errorsOnly: errOnly }, controller.signal)
      .then((res) => { setHistory(res); setError(null); setLoading(false); setLastUpdated(Date.now()); })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        const status = err instanceof ApiError ? err.status : null;
        setError({ status, message: err instanceof Error ? err.message : "Unknown error" });
        setLoading(false);
      });
  }, []);

  // Fetch now on activation / filter or interval change (+ polling).
  useEffect(() => {
    if (!active) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetchHistory's sync setLoading(true) is intentional: enter loading on tab open
    fetchHistory(errorsOnly);
    return () => abortRef.current?.abort();
  }, [active, errorsOnly, intervalMs, fetchHistory]);
  usePolling(() => fetchHistory(errorsOnly), intervalMs, { enabled: active });

  const refresh = useCallback(() => fetchHistory(errorsOnly), [fetchHistory, errorsOnly]);

  return { history, error, loading, lastUpdated, refresh };
}
