import InlineIcon from "../common/InlineIcon";
import { C, formatSQL } from "../../utils/inventory-helpers";

/* ── SearchInput ── */
export function SearchInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div style={{ position: "relative", width: 260 }}>
      <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke={C.text3} strokeWidth={2}
        style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)" }}>
        <circle cx="11" cy="11" r="7" /><line x1="16.5" y1="16.5" x2="21" y2="21" />
      </svg>
      <input value={value} onChange={(e) => onChange(e.target.value)}
        placeholder="Filter by name..."
        style={{
          width: "100%", padding: "7px 28px 7px 32px", background: C.bg,
          border: `1px solid ${C.border}`, borderRadius: 6, color: C.text1,
          fontSize: 12, outline: "none", fontFamily: "inherit",
        }} />
      {value && (
        <button onClick={() => onChange("")}
          style={{ position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", color: C.text3, cursor: "pointer", fontSize: 14 }}>
          &times;
        </button>
      )}
    </div>
  );
}

/* ── Chip ── */
export function Chip({ label, active, onClick, muted }: { label: string; active: boolean; onClick: () => void; muted?: boolean }) {
  const color = muted ? C.text3 : C.accent;
  return (
    <button onClick={onClick} style={{
      padding: "3px 10px", borderRadius: 12, fontSize: 11, fontWeight: 500, cursor: "pointer",
      border: `1px solid ${active ? color : C.border}`, fontFamily: "inherit",
      background: active ? `${color}20` : "transparent",
      color: active ? color : C.text2,
      opacity: muted && !active ? 0.6 : 1,
    }}>{label}</button>
  );
}

/* ── Badge ── */
export function Badge({ text, color }: { text: string; color: string }) {
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", justifyContent: "center",
      lineHeight: 1, padding: "2px 7px", borderRadius: 4, fontSize: 10,
      fontWeight: 600, background: `${color}18`, color, border: `1px solid ${color}30`,
      textTransform: "uppercase", letterSpacing: "0.03em",
    }}>{text}</span>
  );
}

/* ── SectionLabel ── */
export function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      display: "flex", alignItems: "center", marginBottom: 12,
      padding: "6px 14px",
      background: "rgba(59,130,246,0.04)",
      borderLeft: "2px solid #3b82f6",
      borderRadius: "0 4px 4px 0",
    }}>
      <span style={{ fontSize: 12, fontWeight: 700, color: C.text1, textTransform: "uppercase", letterSpacing: "0.06em" }}>{children}</span>
    </div>
  );
}

/* ── Loader ── */
export function Loader() {
  return <div style={{ padding: 24, textAlign: "center", color: C.text3, fontSize: 12 }}>Loading...</div>;
}

/* ── TH (table header) ── */
export function TH({ children }: { children: React.ReactNode }) {
  return (
    <th style={{
      textAlign: "left", padding: "8px 10px", color: C.text3, fontWeight: 500,
      fontSize: 10, textTransform: "uppercase", letterSpacing: "0.05em",
      borderBottom: `1px solid ${C.border}`,
    }}>{children}</th>
  );
}

/* ── SortTH ── */
export function SortTH({ label, dir, onToggle }: { label: string; dir: "asc" | "desc"; onToggle: () => void }) {
  return (
    <th onClick={onToggle} style={{
      textAlign: "left", padding: "8px 10px", color: C.text2, fontWeight: 600,
      fontSize: 10, textTransform: "uppercase", letterSpacing: "0.05em",
      borderBottom: `1px solid ${C.border}`, cursor: "pointer", userSelect: "none",
    }}>
      <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
        {label}
        <span style={{ fontSize: 8, color: dir === "asc" ? "#3b82f6" : "#ef4444" }}>{dir === "asc" ? "▲" : "▼"}</span>
      </span>
    </th>
  );
}

/* ── TD (table data) ── */
export function TD({ children }: { children: React.ReactNode }) {
  return <td style={{ padding: "7px 10px", verticalAlign: "middle" }}>{children}</td>;
}

/* ── MetaItem ── */
export function MetaItem({ label, value }: { label: string; value: string }) {
  // Special creator format: __CREATOR__name__system|user
  const creatorMatch = value.match(/^__CREATOR__(.+)__(system|user)$/);
  if (creatorMatch) {
    const [, name, kind] = creatorMatch;
    return (
      <>
        <span style={{ color: C.text3 }}>{label}</span>
        <span style={{ display: "flex", alignItems: "center", gap: 6, color: C.text1, fontWeight: 500 }}>
          <InlineIcon type={kind === "system" ? "system" : "user"} size={14} />
          {name}
          <span style={{ fontSize: 10, padding: "1px 6px", borderRadius: 4, background: kind === "system" ? "rgba(107,114,128,0.15)" : "rgba(14,165,233,0.15)", color: kind === "system" ? "#9ca3af" : "#38bdf8" }}>
            {kind}
          </span>
        </span>
      </>
    );
  }

  const isCode = /^(SELECT |INSERT |CREATE |GRANT |\{)/i.test(value.trim());
  const formatted = isCode ? formatSQL(value) : value;
  const isDefinition = label === "Definition";
  return (
    <>
      <span style={{ color: C.text3 }}>{label}</span>
      {isCode ? (
        <pre style={{
          margin: 0, padding: 10, background: C.bg, borderRadius: 4,
          border: `1px solid ${C.border}`, fontSize: 12, color: C.text2,
          whiteSpace: "pre-wrap", wordBreak: "break-word", lineHeight: 1.6,
          maxHeight: isDefinition ? 400 : 240, overflowY: "auto", overflowX: "hidden",
        }}>{formatted}</pre>
      ) : (
        <span style={{ color: C.text1, fontWeight: 500, wordBreak: "break-all", whiteSpace: "pre-wrap" }}>{value}</span>
      )}
    </>
  );
}

