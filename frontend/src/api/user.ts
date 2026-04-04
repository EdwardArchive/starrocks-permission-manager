/**
 * API client for /api/user/* endpoints (Layer 1 — all users).
 * Uses only INFORMATION_SCHEMA + SHOW commands.
 */
import { apiFetch } from "./client";
import type { CatalogItem, DAGGraph, DatabaseItem, ObjectItem, RoleItem, TableDetail } from "../types";

// ── Objects ──
export const getCatalogs = () =>
  apiFetch<CatalogItem[]>("/user/objects/catalogs");

export const getDatabases = (catalog: string) =>
  apiFetch<DatabaseItem[]>(`/user/objects/databases?catalog=${encodeURIComponent(catalog)}`);

export const getTables = (catalog: string, database: string) =>
  apiFetch<ObjectItem[]>(
    `/user/objects/tables?catalog=${encodeURIComponent(catalog)}&database=${encodeURIComponent(database)}`
  );

export const getTableDetail = (catalog: string, database: string, table: string) =>
  apiFetch<TableDetail>(
    `/user/objects/table-detail?catalog=${encodeURIComponent(catalog)}&database=${encodeURIComponent(database)}&table=${encodeURIComponent(table)}`
  );

// ── Permissions ──
export interface MyPermissionsResponse {
  username: string;
  direct_roles: string[];
  role_tree: Record<string, {
    grants: { privilege_type: string; object_type: string; object_catalog: string | null; object_database: string | null; object_name: string | null }[];
    parent_roles: string[];
  }>;
  effective_privileges: { privilege_type: string; object_type: string; object_catalog: string | null; object_database: string | null; object_name: string | null; source: string }[];
  accessible_databases: { name: string; catalog: string }[];
  accessible_catalogs: { name: string; type: string }[];
  accessible_objects: { catalog?: string; database: string; name: string; type: string; rows?: number; size?: number; signature?: string; return_type?: string; function_type?: string; properties?: string }[];
  system_objects: Record<string, string>[];
}

export const getMyPermissions = (signal?: AbortSignal) =>
  apiFetch<MyPermissionsResponse>("/user/my-permissions", { signal });

// ── Roles ──
export const getRoles = () => apiFetch<RoleItem[]>("/user/roles");

export const getRoleHierarchy = (signal?: AbortSignal) =>
  apiFetch<DAGGraph>("/user/dag/role-hierarchy", { signal });

// ── DAG ──
export const getObjectHierarchy = (catalog?: string, signal?: AbortSignal) => {
  const q = catalog ? `?catalog=${encodeURIComponent(catalog)}` : "";
  return apiFetch<DAGGraph>(`/user/dag/object-hierarchy${q}`, { signal });
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
  apiFetch<SearchResult[]>(`/user/search?q=${encodeURIComponent(q)}&limit=${limit}`);
