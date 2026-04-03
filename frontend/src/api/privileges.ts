import { apiFetch } from "./client";
import type { PrivilegeGrant } from "../types";

export const getUserPrivileges = (username: string, signal?: AbortSignal) =>
  apiFetch<PrivilegeGrant[]>(`/privileges/user/${encodeURIComponent(username)}`, { signal });

export const getRolePrivileges = (rolename: string, signal?: AbortSignal) =>
  apiFetch<PrivilegeGrant[]>(`/privileges/role/${encodeURIComponent(rolename)}`, { signal });

export const getUserEffectivePrivileges = (username: string, signal?: AbortSignal) =>
  apiFetch<PrivilegeGrant[]>(`/privileges/user/${encodeURIComponent(username)}/effective`, { signal });

export const getObjectPrivileges = (catalog?: string, database?: string, name?: string) => {
  const params = new URLSearchParams();
  if (catalog) params.set("catalog", catalog);
  if (database) params.set("database", database);
  if (name) params.set("name", name);
  return apiFetch<PrivilegeGrant[]>(`/privileges/object?${params}`);
};
