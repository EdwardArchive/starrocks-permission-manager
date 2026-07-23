/**
 * Single source for the privilege/role/DAG/search API functions that are
 * identical across the /api/user/* and /api/admin/* route families — they differ
 * only in the URL prefix. `user.ts` / `admin.ts` re-export these bound to their
 * respective base; components choose the right family at runtime via usePermApi().
 */
import { apiFetch } from "./client";
import { useAuthStore } from "../stores/authStore";
import type { DAGGraph, PrivilegeGrant, RoleItem, SearchResult } from "../types";

function makePermApi(base: "user" | "admin") {
  return {
    getUserEffectivePrivileges: (username: string, signal?: AbortSignal) =>
      apiFetch<PrivilegeGrant[]>(`/${base}/privileges/user/${encodeURIComponent(username)}/effective`, { signal }),

    getRolePrivileges: (rolename: string, signal?: AbortSignal) =>
      apiFetch<PrivilegeGrant[]>(`/${base}/privileges/role/${encodeURIComponent(rolename)}`, { signal }),

    getObjectPrivileges: (catalog?: string, database?: string, name?: string, objectType?: string) => {
      const params = new URLSearchParams();
      if (catalog) params.set("catalog", catalog);
      if (database) params.set("database", database);
      if (name) params.set("name", name);
      if (objectType) params.set("object_type", objectType);
      return apiFetch<PrivilegeGrant[]>(`/${base}/privileges/object?${params}`);
    },

    getRoles: () => apiFetch<RoleItem[]>(`/${base}/roles`),

    getRoleHierarchy: (signal?: AbortSignal) =>
      apiFetch<DAGGraph>(`/${base}/dag/role-hierarchy`, { signal }),

    getInheritanceDag: (name: string, type: "user" | "role", signal?: AbortSignal) =>
      apiFetch<DAGGraph>(`/${base}/roles/inheritance-dag?name=${encodeURIComponent(name)}&type=${type}`, { signal }),

    getObjectHierarchy: (catalog?: string, signal?: AbortSignal) => {
      const q = catalog ? `?catalog=${encodeURIComponent(catalog)}` : "";
      return apiFetch<DAGGraph>(`/${base}/dag/object-hierarchy${q}`, { signal });
    },

    searchAll: (q: string, limit = 50) =>
      apiFetch<SearchResult[]>(`/${base}/search?q=${encodeURIComponent(q)}&limit=${limit}`),
  };
}

/** Layer 1 (all users) — /api/user/* prefix. */
export const userPermApi = makePermApi("user");
/** Layer 1+2 (admin only) — /api/admin/* prefix. */
export const adminPermApi = makePermApi("admin");

/**
 * Returns the admin-scoped API for admins, the user-scoped API otherwise.
 * Both are module singletons, so the returned reference is stable per-admin-ness
 * (safe to list in a useEffect dependency array).
 */
export function usePermApi() {
  const isAdmin = useAuthStore((s) => s.user?.is_user_admin ?? false);
  return isAdmin ? adminPermApi : userPermApi;
}
