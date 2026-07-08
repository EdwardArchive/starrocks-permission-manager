/**
 * Sidebar style map (extracted from Sidebar.tsx). Lives in its own module — it
 * carries function members, so it can't ride along in a component file under
 * react-refresh/only-export-components.
 */
import { C } from "../../utils/colors";

/* ── Styles matching mockup.html exactly ── */
export const S = {
  aside: {
    width: 300, flexShrink: 0, display: "flex" as const, flexDirection: "column" as const,
    borderRight: `1px solid ${C.borderLight}`, background: C.card, overflow: "hidden",
  },
  searchWrap: { padding: "12px 16px", borderBottom: `1px solid ${C.borderLight}` },
  searchInput: {
    width: "100%", padding: "8px 12px", background: C.bg, border: `1px solid ${C.borderLight}`,
    borderRadius: 6, color: C.text1, fontSize: 13, outline: "none", fontFamily: "inherit",
  },
  content: { flex: 1, overflowY: "auto" as const, padding: "8px 0" },
  sectionTitle: {
    padding: "8px 16px", fontSize: 11, fontWeight: 700, textTransform: "uppercase" as const,
    letterSpacing: "0.05em", color: C.text2,
  },
  item: (indent: number, isGroup?: boolean): React.CSSProperties => ({
    display: "flex", alignItems: "center", gap: 8, cursor: "pointer",
    padding: `6px 16px 6px ${24 + indent * 16}px`,
    fontSize: isGroup ? 12 : 13, fontWeight: isGroup ? 600 : 400,
    color: isGroup ? C.text2 : C.text1,
    border: "none", background: "transparent", width: "100%", textAlign: "left",
    fontFamily: "inherit",
  }),
  badge: (color?: string): React.CSSProperties => ({
    marginLeft: "auto", background: color || C.border, padding: "1px 6px",
    borderRadius: 10, fontSize: 11, color: color ? undefined : C.text2,
  }),
  expand: { fontSize: 10, marginRight: 2, color: C.text2, flexShrink: 0 } as React.CSSProperties,
};
