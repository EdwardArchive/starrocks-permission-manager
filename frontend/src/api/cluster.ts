/**
 * API client for /api/cluster/* endpoints.
 * Not under /api/user or /api/admin because this endpoint is reachable by any
 * logged-in user — StarRocks itself enforces cluster_admin/SYSTEM OPERATE.
 * On insufficient StarRocks privileges, the server returns 403.
 */
import { apiFetch } from "./client";
import type { ClusterHistoryResponse, ClusterQueriesResponse, ClusterStatusResponse } from "../types";

export const getClusterStatus = (signal?: AbortSignal, refresh?: boolean, quiet?: boolean) =>
  apiFetch<ClusterStatusResponse>(
    refresh ? "/cluster/status?refresh=1" : "/cluster/status",
    { signal, quiet },
  );

// quiet by default: polled every few seconds; a 403 (no OPERATE privilege) is
// rendered in place by the queries panel, not toasted on every poll.
export const getClusterQueries = (signal?: AbortSignal, refresh?: boolean) =>
  apiFetch<ClusterQueriesResponse>(
    refresh ? "/cluster/queries?refresh=1" : "/cluster/queries",
    { signal, quiet: true },
  );

export const getClusterQueryHistory = (
  opts: { limit?: number; errorsOnly?: boolean } = {},
  signal?: AbortSignal,
) => {
  const params = new URLSearchParams();
  if (opts.limit) params.set("limit", String(opts.limit));
  if (opts.errorsOnly) params.set("errors_only", "1");
  const qs = params.toString();
  return apiFetch<ClusterHistoryResponse>(
    `/cluster/queries/history${qs ? `?${qs}` : ""}`,
    { signal, quiet: true },
  );
};

// KILL is grant-admin only; let errors surface as toasts (rare, deliberate action).
export const killClusterQuery = (queryId: string) =>
  apiFetch<{ status: string; query_id: string; audit: string }>("/cluster/queries/kill", {
    method: "POST",
    body: JSON.stringify({ query_id: queryId }),
  });
