import { useMemo, useRef, useState } from "react";
import { C } from "../../utils/colors";

export interface ComboOption {
  value: string;
  /** small colored tag rendered before the value (e.g. USER/ROLE) */
  badge?: { text: string; bg: string; fg: string };
  /** opaque caller data, handed back through onSelect */
  meta?: string;
}

interface ComboInputProps {
  value: string;
  onChange: (value: string) => void;
  options: ComboOption[];
  /** invoked when an option is picked from the list (default: onChange(option.value)) */
  onSelect?: (option: ComboOption) => void;
  placeholder?: string;
  testId: string;
  /** picker-only mode replacing a native <select>: typing disabled, click opens the list */
  selectOnly?: boolean;
  /** substring-filter options while typing — disable when options are already server-filtered */
  localFilter?: boolean;
}

const inputStyle: React.CSSProperties = {
  width: "100%", padding: "7px 26px 7px 10px", fontSize: 13, color: C.text1,
  background: C.bg, border: `1px solid ${C.borderLight}`, borderRadius: 6,
  fontFamily: "inherit", boxSizing: "border-box",
};

/** Text input + always-visible chevron + theme-styled dropdown.
 * Replaces native <datalist>/<select>, whose popups are browser-drawn
 * (white, unstylable) and whose arrows render inconsistently. */
export default function ComboInput({
  value,
  onChange,
  options,
  onSelect,
  placeholder,
  testId,
  selectOnly = false,
  localFilter = true,
}: ComboInputProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState<string | null>(null); // null → no filter (show all)
  const [highlight, setHighlight] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const filtered = useMemo(() => {
    if (selectOnly || !localFilter || query === null) return options;
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter((o) => o.value.toLowerCase().includes(q));
  }, [options, query, localFilter, selectOnly]);

  const openAll = () => { setOpen(true); setQuery(null); setHighlight(-1); };
  const close = () => { setOpen(false); setQuery(null); setHighlight(-1); };

  const pick = (opt: ComboOption) => {
    if (onSelect) onSelect(opt);
    else onChange(opt.value);
    close();
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!open) { openAll(); return; }
      const next = e.key === "ArrowDown" ? Math.min(highlight + 1, filtered.length - 1) : Math.max(highlight - 1, 0);
      setHighlight(next);
      listRef.current?.children[next]?.scrollIntoView?.({ block: "nearest" });
    } else if (e.key === "Enter") {
      if (open && highlight >= 0 && filtered[highlight]) { e.preventDefault(); pick(filtered[highlight]); }
    } else if (e.key === "Escape" && open) {
      e.stopPropagation(); // only close the dropdown — keep the surrounding modal open
      close();
    }
  };

  return (
    <div style={{ position: "relative" }}>
      <input
        ref={inputRef}
        data-testid={testId}
        style={{ ...inputStyle, cursor: selectOnly ? "pointer" : undefined }}
        readOnly={selectOnly}
        placeholder={placeholder}
        value={value}
        autoComplete="off"
        onChange={(e) => { onChange(e.target.value); setQuery(e.target.value); setOpen(true); setHighlight(-1); }}
        onFocus={() => { if (!selectOnly) openAll(); }}
        onClick={() => { if (selectOnly) { if (open) close(); else openAll(); } }}
        onBlur={() => setTimeout(close, 150)}
        onKeyDown={onKeyDown}
      />
      <span
        aria-hidden
        onMouseDown={(e) => {
          e.preventDefault(); // keep focus in the input
          if (open) close();
          else { inputRef.current?.focus(); openAll(); }
        }}
        style={{
          position: "absolute", right: 0, top: 0, bottom: 0, width: 26,
          display: "flex", alignItems: "center", justifyContent: "center",
          color: C.text2, fontSize: 11, cursor: "pointer", userSelect: "none",
        }}
      >
        ▾
      </span>
      {open && filtered.length > 0 && (
        <div
          ref={listRef}
          onMouseLeave={() => setHighlight(-1)}
          style={{ position: "absolute", top: "100%", left: 0, right: 0, zIndex: 20, background: C.card, border: `1px solid ${C.borderLight}`, borderRadius: 6, maxHeight: 180, overflowY: "auto", boxShadow: "0 6px 16px rgba(0,0,0,0.4)" }}
        >
          {filtered.map((o, i) => (
            <div
              key={`${o.meta ?? ""}:${o.value}`}
              data-testid={`${testId}-option`}
              onMouseDown={(e) => { e.preventDefault(); pick(o); }}
              onMouseEnter={() => setHighlight(i)}
              style={{ padding: "6px 10px", fontSize: 13, color: C.text1, cursor: "pointer", display: "flex", alignItems: "center", gap: 8, background: i === highlight ? C.bg : "transparent" }}
            >
              {o.badge && (
                <span style={{ fontSize: 10, fontWeight: 700, padding: "1px 6px", borderRadius: 4, background: o.badge.bg, color: o.badge.fg }}>
                  {o.badge.text}
                </span>
              )}
              {o.value}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
