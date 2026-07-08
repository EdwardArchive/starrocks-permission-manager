/** Grant-local UI atoms: segmented toggles, section header, wizard icons, warn line. */
import { useState } from "react";
import { C } from "../../utils/colors";
import InlineIcon from "../common/InlineIcon";
import { kStyle } from "./styles";

/** Segment of a themed toggle group. Keeps a real (hidden) radio input so
 * jest-dom toBeChecked() and Playwright .check() keep working on the testId. */
export function Seg({
  active,
  label,
  onSelect,
  testId,
  activeColor,
}: {
  active: boolean;
  label: React.ReactNode;
  onSelect: () => void;
  testId: string;
  activeColor?: string;
}) {
  const [focused, setFocused] = useState(false);
  return (
    <label
      style={{
        position: "relative",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 6,
        padding: "6px 14px",
        fontSize: 12.5,
        fontWeight: active ? 600 : 400,
        borderRadius: 6,
        cursor: "pointer",
        whiteSpace: "nowrap",
        userSelect: "none",
        color: active ? "#fff" : C.text2,
        background: active ? (activeColor ?? C.accent) : "transparent",
        boxShadow: focused ? `0 0 0 2px ${C.accent}` : "none",
        transition: "color .15s, background .15s, box-shadow .15s",
      }}
    >
      <input
        type="radio"
        data-testid={testId}
        checked={active}
        onChange={onSelect}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        style={{ position: "absolute", inset: 0, opacity: 0, margin: 0, cursor: "pointer" }}
      />
      {label}
    </label>
  );
}

export function SegGroup({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ display: "inline-flex", gap: 2, padding: 3, background: C.bg, border: `1px solid ${C.borderLight}`, borderRadius: 8 }}>
      {children}
    </div>
  );
}

/** Section divider header: uppercase key + optional inline extra + rule line. */
export function SectionH({ title, icon, extra }: { title: string; icon?: React.ReactNode; extra?: React.ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, margin: "0 0 10px" }}>
      {icon}
      <span style={kStyle}>{title}</span>
      {extra}
      <span style={{ flex: 1, height: 1, background: C.border }} />
    </div>
  );
}

export const GearIcon = () => (
  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke={C.text2} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
  </svg>
);

export const CopyIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <rect x="9" y="9" width="13" height="13" rx="2" />
    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
  </svg>
);

export const CheckMark = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#86efac" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M20 6 9 17l-5-5" />
  </svg>
);

export const CrossMark = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#fca5a5" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M18 6 6 18M6 6l12 12" />
  </svg>
);

export const WarnLine = ({ children, color = "#fde68a" }: { children: React.ReactNode; color?: string }) => (
  <div style={{ display: "flex", gap: 6, alignItems: "flex-start", fontSize: 12, color }}>
    <span style={{ flexShrink: 0, marginTop: 1 }}>
      <InlineIcon type="warning" size={13} color={color} />
    </span>
    <span>{children}</span>
  </div>
);
