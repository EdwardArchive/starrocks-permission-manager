import type React from "react";
import { format as sqlFormat } from "sql-formatter";

/* ── Types ── */
export type SubTab = "tables" | "views" | "mvs" | "functions" | "databases" | "catalogs" | "roles" | "users" | "warehouses" | "rgroups" | "svolumes" | "resources" | "gfunctions" | "pipes" | "tasks";
export type AllTab = SubTab;

export interface RoleRow { name: string; kind: string; source: string; grantsCount: number }
export interface SelectedItem {
  tab: SubTab;
  name: string;
  database?: string;
  catalog?: string;
  objectType?: string; // "TABLE" | "VIEW" | "MATERIALIZED VIEW" | "FUNCTION" | "DATABASE" | "ROLE"
}

/* ── Palette ── */
export const C = {
  bg: "#0f172a", card: "#1e293b", border: "#334155", borderLight: "#475569",
  text1: "#e2e8f0", text2: "#94a3b8", text3: "#64748b",
  accent: "#3b82f6", green: "#22c55e", blue: "#3b82f6",
};

/* ── Constants ── */
export const SUB_TAB_META: { key: AllTab; label: string; future?: boolean }[] = [
  { key: "roles", label: "Roles" },
  { key: "users", label: "Users" },
  { key: "catalogs", label: "Catalogs" },
  { key: "databases", label: "Databases" },
  { key: "tables", label: "Tables" },
  { key: "mvs", label: "MVs" },
  { key: "views", label: "Views" },
  { key: "functions", label: "Functions" },
  { key: "gfunctions", label: "Global Funcs" },
  { key: "pipes", label: "Pipes" },
  { key: "tasks", label: "Tasks" },
  { key: "warehouses", label: "Warehouses" },
  { key: "rgroups", label: "Resource Groups" },
  { key: "svolumes", label: "Storage Volumes" },
  { key: "resources", label: "Resources" },
];

export const OBJECT_TYPE_MAP: Record<string, string> = {
  roles: "ROLE", users: "USER", catalogs: "CATALOG", databases: "DATABASE",
  tables: "TABLE", views: "VIEW", mvs: "MATERIALIZED VIEW", functions: "FUNCTION",
  gfunctions: "GLOBAL FUNCTION", pipes: "PIPE", tasks: "TASK",
  warehouses: "WAREHOUSE", rgroups: "RESOURCE GROUP", svolumes: "STORAGE VOLUME", resources: "RESOURCE",
};

export const PRIV_BY_TYPE: Record<string, string[]> = {
  table: ["CREATE TABLE", "SELECT", "INSERT", "UPDATE", "DELETE", "ALTER", "DROP", "EXPORT"],
  view: ["CREATE VIEW", "SELECT", "ALTER", "DROP"],
  mv: ["CREATE MATERIALIZED VIEW", "SELECT", "ALTER", "DROP", "REFRESH"],
  function: ["CREATE FUNCTION", "USAGE", "DROP"],
  database: ["USAGE", "CREATE TABLE", "CREATE VIEW", "CREATE FUNCTION", "CREATE MATERIALIZED VIEW", "ALTER", "DROP"],
  catalog: ["USAGE", "CREATE DATABASE", "ALTER", "DROP"],
  system: ["GRANT", "NODE", "OPERATE", "REPOSITORY", "BLACKLIST", "FILE", "PLUGIN", "CREATE RESOURCE GROUP", "CREATE RESOURCE", "CREATE EXTERNAL CATALOG", "CREATE STORAGE VOLUME", "SECURITY"],
  "global function": ["USAGE", "DROP"],
  warehouse: ["USAGE", "ALTER", "DROP"],
  "resource group": ["CREATE RESOURCE GROUP", "ALTER", "DROP"],
  "storage volume": ["USAGE", "ALTER", "DROP"],
  resource: ["USAGE", "ALTER", "DROP"],
  pipe: ["CREATE PIPE", "ALTER", "DROP"],
  task: ["ALTER", "DROP"],
};

export const PRIV_KEY_MAP: Record<string, string> = {
  TABLE: "table", VIEW: "view", "MATERIALIZED VIEW": "mv", FUNCTION: "function",
  DATABASE: "database", CATALOG: "catalog", SYSTEM: "system",
  "GLOBAL FUNCTION": "global function", "GLOBAL_FUNCTION": "global function",
  WAREHOUSE: "warehouse", "RESOURCE GROUP": "resource group", "RESOURCE_GROUP": "resource group",
  "STORAGE VOLUME": "storage volume", "STORAGE_VOLUME": "storage volume",
  RESOURCE: "resource", PIPE: "pipe", TASK: "task",
};

/* ── Utility functions ── */
export function formatSQL(sql: string): string {
  if (sql.trim().startsWith("{")) {
    try { return JSON.stringify(JSON.parse(sql), null, 2); } catch { /* not JSON */ }
  }
  try {
    const result = sqlFormat(sql, { language: "mysql", tabWidth: 2, keywordCase: "upper", expressionWidth: 40 });
    // Remove consecutive blank lines
    return result.replace(/\n\s*\n/g, "\n");
  } catch { return sql; }
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

/* ── Matrix table header style ── */
export const matrixTh: React.CSSProperties = {
  textAlign: "left", padding: "6px 8px", color: C.text3, fontWeight: 500,
  fontSize: 10, textTransform: "uppercase", letterSpacing: "0.03em",
  borderBottom: `1px solid ${C.border}`, whiteSpace: "nowrap",
};
