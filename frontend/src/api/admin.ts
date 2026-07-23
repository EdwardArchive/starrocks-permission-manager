/**
 * API client for /api/admin/* endpoints (Layer 1+2 — admin only).
 * Uses sys.* tables + INFORMATION_SCHEMA + SHOW commands.
 *
 * The privilege/role/DAG/search functions are shared with user.ts and live in
 * permApi.ts (single implementation); they are re-exported here bound to the
 * /api/admin/* prefix.
 */
import { apiFetch } from "./client";
import type {
  AuditEntry,
  GrantExecuteResponse,
  GrantPreviewResponse,
  GrantRequest,
  GrantSpec,
  PrivilegeGrant,
  SearchResult,
} from "../types";
import { adminPermApi } from "./permApi";

// ── Shared privilege/role/DAG/search functions (impl in permApi.ts) ──
export const getUserEffectivePrivileges = adminPermApi.getUserEffectivePrivileges;
export const getRolePrivileges = adminPermApi.getRolePrivileges;
export const getObjectPrivileges = adminPermApi.getObjectPrivileges;
export const getRoles = adminPermApi.getRoles;
export const getRoleHierarchy = adminPermApi.getRoleHierarchy;
export const getInheritanceDag = adminPermApi.getInheritanceDag;
export const getObjectHierarchy = adminPermApi.getObjectHierarchy;
export const searchAll = adminPermApi.searchAll;

// ── Privileges (admin-only) ──
export const getUserPrivileges = (username: string, signal?: AbortSignal) =>
  apiFetch<PrivilegeGrant[]>(`/admin/privileges/user/${encodeURIComponent(username)}`, { signal });

// ── Search (admin-only) ──
export const searchUsersRoles = (q: string, limit = 50) =>
  apiFetch<SearchResult[]>(`/admin/search/users-roles?q=${encodeURIComponent(q)}&limit=${limit}`);

// ── Grant management (write operations; requires can_manage_grants) ──
export const getGrantSpec = () => apiFetch<GrantSpec>("/admin/grants/spec");

export const previewGrant = (req: GrantRequest) =>
  apiFetch<GrantPreviewResponse>("/admin/grants/preview", { method: "POST", body: JSON.stringify(req) });

export const executeGrant = (req: GrantRequest) =>
  apiFetch<GrantExecuteResponse>("/admin/grants/execute", { method: "POST", body: JSON.stringify(req) });

export const getAuditLog = (limit = 100, actor?: string, action?: string) => {
  const params = new URLSearchParams({ limit: String(limit) });
  if (actor) params.set("actor", actor);
  if (action) params.set("action", action);
  return apiFetch<AuditEntry[]>(`/admin/grants/audit?${params}`);
};
