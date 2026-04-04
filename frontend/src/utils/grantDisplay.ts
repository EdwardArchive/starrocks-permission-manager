/**
 * Shared utility for converting PrivilegeGrant[] into a display-ready grouped structure.
 * Used by GrantTreeView and all panels/tabs that show privilege information.
 */

import type { PrivilegeGrant } from "../types";

// ── Types ──

export interface GrantDisplayItem {
  displayName: string;  // "products_sync" | "ALL TABLES IN analytics_db" | "ALL DATABASES"
  context: string;      // "default_catalog.analytics_db" | "implicit access" | ""
  privs: string[];      // ["SELECT", "INSERT", "USAGE (implicit)"]
}

export interface GrantDisplayGroup {
  scope: string;  // "TABLE" | "DATABASE" | "CATALOG" | "SYSTEM" | ...
  icon: string;   // icon key for InlineIcon
  items: GrantDisplayItem[];
}

// ── Constants ──

const SCOPE_ORDER = ["SYSTEM", "CATALOG", "DATABASE", "TABLE", "VIEW", "MATERIALIZED VIEW", "FUNCTION", "RESOURCE", "STORAGE VOLUME", "RESOURCE GROUP", "GLOBAL FUNCTION", "WAREHOUSE", "PIPE", "TASK", "USER"];

const SCOPE_ICON_MAP: Record<string, string> = {
  SYSTEM: "system", CATALOG: "catalog", DATABASE: "database",
  TABLE: "table", VIEW: "view", "MATERIALIZED VIEW": "mv",
  FUNCTION: "function", WAREHOUSE: "system", "RESOURCE GROUP": "system",
  "STORAGE VOLUME": "system", RESOURCE: "system", "GLOBAL FUNCTION": "function",
  PIPE: "system", TASK: "system",
};

const CHILD_TYPES = new Set(["TABLE", "VIEW", "MATERIALIZED VIEW", "FUNCTION"]);

// ── Core function ──

export function buildGrantDisplay(
  grants: PrivilegeGrant[],
  opts?: { addImplicitUsage?: boolean; filter?: string },
): GrantDisplayGroup[] {
  const addImplicit = opts?.addImplicitUsage ?? true;
  const filterLower = (opts?.filter || "").toLowerCase();

  const groups: Record<string, GrantDisplayItem[]> = {};

  for (const g of grants) {
    const scope = g.object_type?.toUpperCase() || "SYSTEM";
    const { displayName, context } = _buildDisplayName(g, scope);

    // Apply search filter
    if (filterLower) {
      const searchable = `${displayName} ${context} ${g.privilege_type} ${scope}`.toLowerCase();
      if (!searchable.includes(filterLower)) continue;
    }

    // Group by scope, merge by displayName
    (groups[scope] ??= []);
    const existing = groups[scope].find((x) => x.displayName === displayName);
    if (existing) {
      if (!existing.privs.includes(g.privilege_type)) existing.privs.push(g.privilege_type);
    } else {
      groups[scope].push({ displayName, context, privs: [g.privilege_type] });
    }
  }

  // Add implicit USAGE for DATABASE/CATALOG
  if (addImplicit) {
    _addImplicitUsage(grants, groups);
  }

  // Mirror CREATE privileges to their target object type section
  // e.g. "CREATE VIEW ON DATABASE" → also show in VIEW section
  // DB-level CREATE → mirror to target type section
  const _CREATE_SCOPE_MAP: Record<string, string> = {
    "CREATE TABLE": "TABLE",
    "CREATE VIEW": "VIEW",
    "CREATE MATERIALIZED VIEW": "MATERIALIZED VIEW",
    "CREATE FUNCTION": "FUNCTION",
    "CREATE PIPE": "PIPE",
  };
  // SYSTEM-level CREATE → mirror to target type section
  const _SYSTEM_CREATE_MAP: Record<string, string> = {
    "CREATE RESOURCE GROUP": "RESOURCE GROUP",
    "CREATE RESOURCE": "RESOURCE",
    "CREATE EXTERNAL CATALOG": "CATALOG",
    "CREATE STORAGE VOLUME": "STORAGE VOLUME",
    "CREATE WAREHOUSE": "WAREHOUSE",
    "CREATE GLOBAL FUNCTION": "GLOBAL FUNCTION",
  };
  for (const g of grants) {
    const priv = g.privilege_type?.toUpperCase() || "";
    const scope = g.object_type?.toUpperCase() || "";
    // DB-level CREATE mirroring
    const dbTarget = _CREATE_SCOPE_MAP[priv];
    if (dbTarget) {
      const dbName = g.object_database || "ALL DATABASES";
      const displayName = `CREATE in ${dbName}`;
      (groups[dbTarget] ??= []);
      if (!groups[dbTarget].find((x) => x.displayName === displayName)) {
        groups[dbTarget].push({ displayName, context: g.object_catalog || "", privs: [priv] });
      }
      continue;
    }
    // SYSTEM-level CREATE mirroring
    if (scope === "SYSTEM") {
      const sysTarget = _SYSTEM_CREATE_MAP[priv];
      if (sysTarget) {
        const displayName = "CREATE (system)";
        (groups[sysTarget] ??= []);
        const existing = groups[sysTarget].find((x) => x.displayName === displayName);
        if (existing) {
          if (!existing.privs.includes(priv)) existing.privs.push(priv);
        } else {
          groups[sysTarget].push({ displayName, context: "", privs: [priv] });
        }
      }
    }
  }

  // Sort scopes
  const sorted = SCOPE_ORDER.filter((s) => groups[s]?.length);
  Object.keys(groups).forEach((s) => { if (!sorted.includes(s)) sorted.push(s); });

  return sorted.map((scope) => ({
    scope,
    icon: SCOPE_ICON_MAP[scope] || "system",
    items: groups[scope],
  }));
}

// ── Helpers ──

function _buildDisplayName(g: PrivilegeGrant, scope: string): { displayName: string; context: string } {
  if (g.object_name) {
    const context = g.object_database
      ? `${g.object_catalog || ""}.${g.object_database}`
      : g.object_catalog || "";
    return { displayName: g.object_name, context };
  }
  if (g.object_database) {
    return { displayName: `ALL ${scope}S IN ${g.object_database}`, context: g.object_catalog || "" };
  }
  if (scope === "DATABASE") return { displayName: "ALL DATABASES", context: "" };
  if (scope === "CATALOG") return { displayName: "ALL CATALOGS", context: "" };
  if (g.object_catalog) {
    return { displayName: `ALL ${scope}S IN ${g.object_catalog}`, context: "" };
  }
  if (scope !== "SYSTEM") return { displayName: `ALL ${scope}S`, context: "" };
  return { displayName: "SYSTEM", context: "" };
}

function _addImplicitUsage(grants: PrivilegeGrant[], groups: Record<string, GrantDisplayItem[]>): void {
  const implicitDbs = new Set<string>();
  const implicitCats = new Set<string>();

  for (const g of grants) {
    const scope = g.object_type?.toUpperCase() || "";
    if (CHILD_TYPES.has(scope) && g.object_database) {
      implicitDbs.add(g.object_database);
      if (g.object_catalog) implicitCats.add(g.object_catalog);
    }
    if (scope === "DATABASE" && g.object_catalog) {
      implicitCats.add(g.object_catalog);
    }
  }

  for (const db of implicitDbs) {
    const hasExplicit = groups["DATABASE"]?.some((x) => x.privs.includes("USAGE") && x.displayName.includes(db));
    if (!hasExplicit) {
      (groups["DATABASE"] ??= []).push({
        displayName: db, context: "implicit access", privs: ["USAGE (implicit)"],
      });
    }
  }

  for (const cat of implicitCats) {
    const hasExplicit = groups["CATALOG"]?.some((x) => x.privs.includes("USAGE") && x.displayName.includes(cat));
    if (!hasExplicit) {
      (groups["CATALOG"] ??= []).push({
        displayName: cat, context: "implicit access", privs: ["USAGE (implicit)"],
      });
    }
  }
}

/** Extract inherited source role names from grants (non-"direct" sources). */
export function extractSourceRoles(grants: PrivilegeGrant[]): string[] {
  return [...new Set(grants.filter((g) => g.source !== "direct").map((g) => g.source))];
}
