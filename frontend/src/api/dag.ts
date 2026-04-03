import { apiFetch } from "./client";
import type { DAGGraph, RoleItem } from "../types";

export const getObjectHierarchy = (catalog?: string, signal?: AbortSignal) => {
  const q = catalog ? `?catalog=${encodeURIComponent(catalog)}` : "";
  return apiFetch<DAGGraph>(`/dag/object-hierarchy${q}`, { signal });
};

export const getRoleHierarchy = (signal?: AbortSignal) =>
  apiFetch<DAGGraph>("/dag/role-hierarchy", { signal });

export const getFullGraph = (catalog?: string, signal?: AbortSignal) => {
  const q = catalog ? `?catalog=${encodeURIComponent(catalog)}` : "";
  return apiFetch<DAGGraph>(`/dag/full${q}`, { signal });
};

export const getInheritanceDag = (name: string, type: "user" | "role", signal?: AbortSignal) =>
  apiFetch<DAGGraph>(`/roles/inheritance-dag?name=${encodeURIComponent(name)}&type=${type}`, { signal });

export const getRoles = () => apiFetch<RoleItem[]>("/roles");
