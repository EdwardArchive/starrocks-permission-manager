/** Pure grant-domain helpers shared by the Manage Privileges wizard's hooks and subcomponents. */
import type { PrivilegeGrant } from "../types";

/** Wizard picker order — the grantable-object subset of scopeConfig SCOPE_ORDER (no SYSTEM/RESOURCE/… scopes). */
export const OBJECT_TYPE_ORDER = ["CATALOG", "DATABASE", "TABLE", "VIEW", "MATERIALIZED VIEW", "FUNCTION"];

/** A grant row is only revocable per-object when it carries a concrete object path.
 * Wildcard scope grants (e.g. root's ON ALL TABLES IN ALL DATABASES) come back with
 * null catalog/db/name and cannot be revoked through a single-object REVOKE. */
export function isRevocableRow(g: PrivilegeGrant): boolean {
  if (!OBJECT_TYPE_ORDER.includes(g.object_type)) return false;
  if (g.object_type === "CATALOG") return !!g.object_catalog;
  if (g.object_type === "DATABASE") return !!g.object_database;
  return !!g.object_database && !!g.object_name;
}

/** Normalize 'alice'@'%' → alice for self-revoke comparison.
 * NOT parseGrantee (utils/granteeName): that regex/host-label logic differs; this
 * one is deliberately the minimal bare-username extraction the self-revoke check needs. */
export function bareUser(name: string): string {
  const m = name.match(/^'([^']+)'@/);
  return (m ? m[1] : name.split("@")[0]).trim();
}

/** Does a grant row target the given object reference exactly? */
export function grantMatchesObject(
  g: PrivilegeGrant,
  objectType: string,
  catalog: string,
  database: string,
  name: string
): boolean {
  if (g.object_type !== objectType) return false;
  if ((g.object_catalog ?? "") !== catalog) return false;
  const needsDb = objectType !== "CATALOG";
  const needsName = !["CATALOG", "DATABASE"].includes(objectType);
  if (needsDb && (g.object_database ?? "") !== database) return false;
  if (needsName && (g.object_name ?? "") !== name) return false;
  return true;
}
