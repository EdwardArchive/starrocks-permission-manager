/* ── App-wide color palette (Tailwind Slate + accents) ── */
export const C = {
  bg: "#0f172a",
  card: "#1e293b",
  border: "#334155",
  borderLight: "#475569",
  text1: "#e2e8f0",
  text2: "#94a3b8",
  text3: "#64748b",
  accent: "#3b82f6",
  green: "#22c55e",
  warning: "#f59e0b",
};

/** User/Role entity badge colors (used in search results, tabs) */
export const ENTITY_BADGE = {
  user: { bg: "rgba(14,165,233,0.18)", fg: "#38bdf8" },
  role: { bg: "rgba(249,115,22,0.18)", fg: "#fb923c" },
} as const;
