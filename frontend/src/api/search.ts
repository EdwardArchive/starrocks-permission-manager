import { apiFetch } from "./client";

export interface SearchResult {
  name: string;
  type: "table" | "view" | "database" | "role" | "user";
  catalog: string;
  database: string;
  path: string;
}

export const searchAll = (q: string, limit = 50) =>
  apiFetch<SearchResult[]>(`/search?q=${encodeURIComponent(q)}&limit=${limit}`);

export const searchUsersRoles = (q: string, limit = 50) =>
  apiFetch<SearchResult[]>(`/search/users-roles?q=${encodeURIComponent(q)}&limit=${limit}`);
