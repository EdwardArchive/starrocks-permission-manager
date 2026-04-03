/** Canonical display order of object-type scopes. */
export const SCOPE_ORDER = ["SYSTEM", "CATALOG", "DATABASE", "TABLE", "VIEW", "MATERIALIZED VIEW", "FUNCTION", "RESOURCE", "STORAGE VOLUME", "USER"];

/** Map scope name to icon type key used by colorizedSvg / InlineIcon. */
export const SCOPE_ICONS: Record<string, string> = {
  SYSTEM: "system",
  CATALOG: "catalog",
  DATABASE: "database",
  TABLE: "table",
  VIEW: "view",
  "MATERIALIZED VIEW": "mv",
  FUNCTION: "function",
};
