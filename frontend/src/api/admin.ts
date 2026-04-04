/**
 * API client for /api/admin/* endpoints (Layer 1+2 — admin only).
 * Uses sys.* tables + INFORMATION_SCHEMA + SHOW commands.
 */
import { apiFetch } from "./client";
import type { DAGGraph, PrivilegeGrant, RoleItem } from "../types";

// ── Privileges ──
export const getUserPrivileges = (username: string, signal?: AbortSignal) =>
  apiFetch<PrivilegeGrant[]>(`/admin/privileges/user/${encodeURIComponent(username)}`, { signal });

export const getRolePrivileges = (rolename: string, signal?: AbortSignal) =>
  apiFetch<PrivilegeGrant[]>(`/admin/privileges/role/${encodeURIComponent(rolename)}`, { signal });

export const getUserEffectivePrivileges = (username: string, signal?: AbortSignal) =>
  apiFetch<PrivilegeGrant[]>(`/admin/privileges/user/${encodeURIComponent(username)}/effective`, { signal });

export const getObjectPrivileges = (catalog?: string, database?: string, name?: string, objectType?: string) => {
  const params = new URLSearchParams();
  if (catalog) params.set("catalog", catalog);
  if (database) params.set("database", database);
  if (name) params.set("name", name);
  if (objectType) params.set("object_type", objectType);
  return apiFetch<PrivilegeGrant[]>(`/admin/privileges/object?${params}`);
};

// ── Roles ──
export const getRoles = () => apiFetch<RoleItem[]>("/admin/roles");

export const getRoleHierarchy = (signal?: AbortSignal) =>
  apiFetch<DAGGraph>("/admin/dag/role-hierarchy", { signal });

export const getInheritanceDag = (name: string, type: "user" | "role", signal?: AbortSignal) =>
  apiFetch<DAGGraph>(`/admin/roles/inheritance-dag?name=${encodeURIComponent(name)}&type=${type}`, { signal });

// ── DAG ──
export const getObjectHierarchy = (catalog?: string, signal?: AbortSignal) => {
  const q = catalog ? `?catalog=${encodeURIComponent(catalog)}` : "";
  return apiFetch<DAGGraph>(`/admin/dag/object-hierarchy${q}`, { signal });
};

export const getFullGraph = (catalog?: string, signal?: AbortSignal) => {
  const q = catalog ? `?catalog=${encodeURIComponent(catalog)}` : "";
  return apiFetch<DAGGraph>(`/admin/dag/full${q}`, { signal });
};

// ── Search ──
export interface SearchResult {
  name: string;
  type: "table" | "view" | "database" | "role" | "user";
  catalog: string;
  database: string;
  path: string;
}

export const searchAll = (q: string, limit = 50) =>
  apiFetch<SearchResult[]>(`/admin/search?q=${encodeURIComponent(q)}&limit=${limit}`);

export const searchUsersRoles = (q: string, limit = 50) =>
  apiFetch<SearchResult[]>(`/admin/search/users-roles?q=${encodeURIComponent(q)}&limit=${limit}`);
