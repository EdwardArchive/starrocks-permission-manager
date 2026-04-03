/** Shared privilege-type color map for consistent tag styling across panels. */
export const PRIV_TAG_COLORS: Record<string, { bg: string; fg: string }> = {
  SELECT: { bg: "rgba(34,197,94,0.18)", fg: "#4ade80" },
  INSERT: { bg: "rgba(59,130,246,0.18)", fg: "#60a5fa" },
  UPDATE: { bg: "rgba(245,158,11,0.18)", fg: "#fbbf24" },
  DELETE: { bg: "rgba(239,68,68,0.18)", fg: "#f87171" },
  ALTER: { bg: "rgba(168,85,247,0.18)", fg: "#c084fc" },
  DROP: { bg: "rgba(220,38,38,0.18)", fg: "#f87171" },
  ALL: { bg: "rgba(99,102,241,0.18)", fg: "#a5b4fc" },
  GRANT: { bg: "rgba(249,115,22,0.18)", fg: "#fb923c" },
  USAGE: { bg: "rgba(14,165,233,0.18)", fg: "#38bdf8" },
  NODE: { bg: "rgba(6,182,212,0.18)", fg: "#22d3ee" },
  OPERATE: { bg: "rgba(20,184,166,0.18)", fg: "#2dd4bf" },
  CREATE: { bg: "rgba(139,92,246,0.18)", fg: "#a78bfa" },
  REFRESH: { bg: "rgba(236,72,153,0.18)", fg: "#f472b6" },
  EXPORT: { bg: "rgba(234,179,8,0.18)", fg: "#facc15" },
  IMPERSONATE: { bg: "rgba(249,115,22,0.18)", fg: "#fb923c" },
  APPLY: { bg: "rgba(6,182,212,0.18)", fg: "#22d3ee" },
};

/** Look up color for a privilege string. Falls back to CREATE prefix match, then default purple. */
export function getPrivColor(priv: string): { bg: string; fg: string } {
  const key = priv.toUpperCase();
  return PRIV_TAG_COLORS[key]
    || (key.startsWith("CREATE") ? PRIV_TAG_COLORS.CREATE : null)
    || { bg: "rgba(139,92,246,0.15)", fg: "#a78bfa" };
}
