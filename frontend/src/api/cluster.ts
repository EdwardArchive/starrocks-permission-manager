/**
 * API client for /api/cluster/* endpoints.
 * Not under /api/user or /api/admin because this endpoint is reachable by any
 * logged-in user — StarRocks itself enforces cluster_admin/SYSTEM OPERATE.
 * On insufficient StarRocks privileges, the server returns 403.
 */
import { apiFetch } from "./client";
import type { ClusterStatusResponse } from "../types";

export const getClusterStatus = (signal?: AbortSignal) =>
  apiFetch<ClusterStatusResponse>("/cluster/status", { signal });
