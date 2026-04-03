// =====================================================================
// Node icons & colors - loaded from /icons/ SVG files
// To change icons, replace the SVG files in frontend/icons/
// =====================================================================

// SVG files imported as URL strings (Vite handles this)
import systemIcon from "../../../icons/system.svg?raw";
import catalogIcon from "../../../icons/catalog.svg?raw";
import databaseIcon from "../../../icons/database.svg?raw";
import tableIcon from "../../../icons/table.svg?raw";
import viewIcon from "../../../icons/view.svg?raw";
import mvIcon from "../../../icons/mv.svg?raw";
import functionIcon from "../../../icons/function.svg?raw";
import userIcon from "../../../icons/user.svg?raw";
import roleIcon from "../../../icons/role.svg?raw";
import appLogoRaw from "../../../icons/app-logo.svg?raw";

// Raw SVG strings for inline rendering
export const NODE_SVG_RAW: Record<string, string> = {
  system: systemIcon,
  catalog: catalogIcon,
  database: databaseIcon,
  table: tableIcon,
  view: viewIcon,
  mv: mvIcon,
  function: functionIcon,
  user: userIcon,
  role: roleIcon,
};

export const APP_LOGO_SVG = appLogoRaw;

export const NODE_COLORS: Record<string, string> = {
  system: "#6b7280",
  catalog: "#3b82f6",
  database: "#22c55e",
  table: "#6366f1",
  view: "#a855f7",
  mv: "#f59e0b",
  function: "#14b8a6",
  user: "#0ea5e9",
  role: "#f97316",
};

export const EDGE_COLORS: Record<string, string> = {
  hierarchy: "#475569",
  assignment: "#0ea5e9",
  inheritance: "#f97316",
  select: "#22c55e",
  insert: "#3b82f6",
  delete: "#ef4444",
  alter: "#a855f7",
  drop: "#dc2626",
  usage: "#64748b",
};

// Helper: replace stroke/fill color in raw SVG to match node type color
const _svgCache = new Map<string, string>();

export function colorizedSvg(type: string, overrideColor?: string): string {
  const color = overrideColor || NODE_COLORS[type] || "#6b7280";
  const cacheKey = `${type}:${color}`;
  const cached = _svgCache.get(cacheKey);
  if (cached !== undefined) return cached;

  const raw = NODE_SVG_RAW[type];
  if (!raw) { _svgCache.set(cacheKey, ""); return ""; }
  // Replace stroke="..." and fill="..." with the target color (skip fill="none")
  const result = raw
    .replace(/stroke="[^"]*"/g, `stroke="${color}"`)
    .replace(/fill="(?!none)[^"]*"/g, `fill="${color}"`);
  _svgCache.set(cacheKey, result);
  return result;
}
