/**
 * API client for /api/cluster/* endpoints.
 * Not under /api/user or /api/admin because this endpoint is reachable by any
 * logged-in user — StarRocks itself enforces cluster_admin/SYSTEM OPERATE.
 * On insufficient StarRocks privileges, the server returns 403.
 */
import { apiFetch } from "./client";
import type { ClusterStatusResponse } from "../types";

export const getClusterStatus = (signal?: AbortSignal, refresh?: boolean) =>
  apiFetch<ClusterStatusResponse>(
    refresh ? "/cluster/status?refresh=1" : "/cluster/status",
    { signal },
  );
