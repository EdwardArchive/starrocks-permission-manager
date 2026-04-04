import { apiFetch } from "./client";
import type { PrivilegeGrant } from "../types";

export const getUserPrivileges = (username: string, signal?: AbortSignal) =>
  apiFetch<PrivilegeGrant[]>(`/privileges/user/${encodeURIComponent(username)}`, { signal });

export const getRolePrivileges = (rolename: string, signal?: AbortSignal) =>
  apiFetch<PrivilegeGrant[]>(`/privileges/role/${encodeURIComponent(rolename)}`, { signal });

export const getUserEffectivePrivileges = (username: string, signal?: AbortSignal) =>
  apiFetch<PrivilegeGrant[]>(`/privileges/user/${encodeURIComponent(username)}/effective`, { signal });

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
  apiFetch<MyPermissionsResponse>("/privileges/my-permissions", { signal });

export const getObjectPrivileges = (catalog?: string, database?: string, name?: string, objectType?: string) => {
  const params = new URLSearchParams();
  if (catalog) params.set("catalog", catalog);
  if (database) params.set("database", database);
  if (name) params.set("name", name);
  if (objectType) params.set("object_type", objectType);
  return apiFetch<PrivilegeGrant[]>(`/privileges/object?${params}`);
};
