/**
 * API client for /api/user/* endpoints (Layer 1 — all users).
 * Uses only INFORMATION_SCHEMA + SHOW commands.
 *
 * The privilege/role/DAG/search functions are shared with admin.ts and live in
 * permApi.ts (single implementation); they are re-exported here bound to the
 * /api/user/* prefix.
 */
import { apiFetch } from "./client";
import type { CatalogItem, DatabaseItem, MyPermissionsResponse, ObjectItem, SearchResult, TableDetail } from "../types";
import { userPermApi } from "./permApi";

// ── Shared privilege/role/DAG/search functions (impl in permApi.ts) ──
export const getUserEffectivePrivileges = userPermApi.getUserEffectivePrivileges;
export const getRolePrivileges = userPermApi.getRolePrivileges;
export const getObjectPrivileges = userPermApi.getObjectPrivileges;
export const getRoles = userPermApi.getRoles;
export const getRoleHierarchy = userPermApi.getRoleHierarchy;
export const getInheritanceDag = userPermApi.getInheritanceDag;
export const getObjectHierarchy = userPermApi.getObjectHierarchy;
export const searchAll = userPermApi.searchAll;

// Types formerly declared here now live in ../types (re-exported for importers).
export type { MyPermissionsResponse, SearchResult };

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
export const getMyPermissions = (signal?: AbortSignal) =>
  apiFetch<MyPermissionsResponse>("/user/my-permissions", { signal });
