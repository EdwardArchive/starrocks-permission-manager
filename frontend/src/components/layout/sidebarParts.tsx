/**
 * Presentational pieces for Sidebar: the inline SVG `Icon` and the hide/show
 * `EyeToggle`. Extracted verbatim from Sidebar.tsx to keep the container focused
 * on data + composition; rendering is unchanged. (The `S` style map lives in
 * sidebarStyles.ts — react-refresh forbids non-component exports here.)
 */
import { colorizedSvg } from "../dag/nodeIcons";
import { C } from "../../utils/colors";

/* ── Inline SVG icon (same as mockup: 16x16) ── */
export function Icon({ type, size = 16 }: { type: string; size?: number }) {
  const svg = colorizedSvg(type);
  if (!svg) return null;
  const sized = svg
    .replace(/width="[^"]*"/, `width="${size}"`)
    .replace(/height="[^"]*"/, `height="${size}"`);
  return (
    <span
      style={{ width: size, height: size, flexShrink: 0, display: "inline-flex", alignItems: "center", justifyContent: "center", verticalAlign: "middle" }}
      dangerouslySetInnerHTML={{ __html: sized }}
    />
  );
}

/* ── Eye toggle for hide/show ── */
export function EyeToggle({ label, hidden, onToggle }: { label: string; hidden: boolean; onToggle: (e: React.MouseEvent) => void }) {
  return (
    <span
      role="button"
      tabIndex={0}
      onClick={onToggle}
      title={hidden ? `Show ${label}` : `Hide ${label}`}
      style={{
        background: "none", border: "none", cursor: "pointer", padding: 2,
        color: hidden ? C.borderLight : C.text3, flexShrink: 0,
        display: "inline-flex", alignItems: "center", justifyContent: "center",
        opacity: hidden ? 0.5 : 0.7,
      }}
      onMouseEnter={(e) => { e.currentTarget.style.opacity = "1"; }}
      onMouseLeave={(e) => { e.currentTarget.style.opacity = hidden ? "0.5" : "0.7"; }}
    >
      {hidden ? (
        <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
          <path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94"/>
          <path d="M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19"/>
          <line x1="1" y1="1" x2="23" y2="23"/>
        </svg>
      ) : (
        <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
          <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
          <circle cx="12" cy="12" r="3"/>
        </svg>
      )}
    </span>
  );
}
