/**
 * API client for /api/cluster/* endpoints.
 * Not under /api/user or /api/admin because this endpoint is reachable by any
 * logged-in user — StarRocks itself enforces cluster_admin/SYSTEM OPERATE.
 * On insufficient StarRocks privileges, the server returns 403.
 */
import { apiFetch } from "./client";
import type { ClusterQueriesResponse, ClusterStatusResponse } from "../types";

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
