/** Privilege checkbox grid + intent presets + (grant-only) WITH GRANT OPTION toggle, for the selected object. */
import { useMemo } from "react";
import type { Dispatch, SetStateAction } from "react";
import { C } from "../../utils/colors";
import { SectionH } from "./primitives";
import type { GrantSpec } from "../../types";

// intent-level privilege presets (intersected with the object type's allowlist)
const PRESETS: { label: string; privs: string[] }[] = [
  { label: "Read-only", privs: ["SELECT", "USAGE"] },
  { label: "Read-write", privs: ["SELECT", "INSERT", "UPDATE", "DELETE"] },
  { label: "Full", privs: ["ALL"] },
];

export default function PrivilegeGrid({
  spec,
  objectType,
  privileges,
  setPrivileges,
  alreadyGranted,
  action,
  modeColor,
  granteeName,
  withGrantOption,
  setWithGrantOption,
}: {
  spec: GrantSpec | null;
  objectType: string;
  privileges: Set<string>;
  setPrivileges: Dispatch<SetStateAction<Set<string>>>;
  alreadyGranted: Set<string>;
  action: "GRANT" | "REVOKE";
  modeColor: string;
  granteeName: string;
  withGrantOption: boolean;
  setWithGrantOption: Dispatch<SetStateAction<boolean>>;
}) {
  const allowedPrivs = useMemo(() => spec?.object_types[objectType] ?? [], [spec, objectType]);
  const presets = useMemo(
    () =>
      PRESETS.map((p) => ({ ...p, privs: p.privs.filter((x) => allowedPrivs.includes(x)) })).filter(
        (p) => p.privs.length > 0
      ),
    [allowedPrivs]
  );

  return (
    <>
      {/* Privileges + presets */}
      <div style={{ marginBottom: 14 }}>
        <SectionH
          title="Privileges"
          extra={action === "GRANT" && presets.length > 0 ? (
            <span style={{ display: "inline-flex", gap: 6 }}>
              {presets.map((p) => (
                <button
                  key={p.label}
                  data-testid={`mp-preset-${p.label.replace(/ /g, "-")}`}
                  onClick={() => setPrivileges(new Set(p.privs))}
                  style={{ fontSize: 11, padding: "2px 9px", borderRadius: 999, border: `1px solid ${C.borderLight}`, background: "transparent", color: C.text2, cursor: "pointer", fontFamily: "inherit" }}
                  onMouseEnter={(e) => { e.currentTarget.style.borderColor = C.accent; e.currentTarget.style.color = C.accent; }}
                  onMouseLeave={(e) => { e.currentTarget.style.borderColor = C.borderLight; e.currentTarget.style.color = C.text2; }}
                >
                  {p.label}
                </button>
              ))}
            </span>
          ) : undefined}
        />
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(135px, 1fr))", gap: 9 }}>
          {allowedPrivs.map((p) => {
            const on = privileges.has(p);
            const held = alreadyGranted.has(p);
            // revoke can only target privileges the grantee actually holds;
            // already-checked ones stay toggleable so they can be removed.
            const disabled = action === "REVOKE" && !held && !on;
            return (
              <label
                key={p}
                title={disabled ? `${granteeName.trim() || "This grantee"} does not hold ${p} on this object` : undefined}
                style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, color: disabled ? C.text3 : (on ? C.text1 : C.text2), cursor: disabled ? "not-allowed" : "pointer", padding: "8px 10px", border: `1px solid ${on ? modeColor : C.border}`, borderRadius: 6, background: on ? (action === "REVOKE" ? "#ef444422" : "#3b82f622") : C.bg, opacity: disabled ? 0.45 : 1 }}
              >
                <input
                  type="checkbox"
                  data-testid={`mp-priv-${p.replace(/ /g, "_")}`}
                  checked={on}
                  disabled={disabled}
                  onChange={() => setPrivileges((prev) => {
                    const next = new Set(prev);
                    if (next.has(p)) next.delete(p); else next.add(p);
                    return next;
                  })}
                  style={{ accentColor: modeColor, cursor: disabled ? "not-allowed" : "pointer" }}
                />
                {p}
                {held && (
                  <span data-testid="mp-already-granted" style={{ marginLeft: "auto", fontSize: 9, fontWeight: 800, padding: "1px 5px", borderRadius: 4, background: "#16a34a33", color: "#86efac" }}>
                    GRANTED
                  </span>
                )}
              </label>
            );
          })}
        </div>
        {action === "REVOKE" && alreadyGranted.size === 0 && (
          <div style={{ fontSize: 11.5, color: C.text3, marginTop: 8, lineHeight: 1.5 }}>
            {granteeName.trim()
              ? "This grantee holds no direct privileges on the selected object. Pick another object, or click a current grant above."
              : "Select a grantee to see revocable privileges."}
          </div>
        )}
      </div>

      {action === "GRANT" && (
        <label style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 12.5, color: C.text2, cursor: "pointer" }}>
          <input type="checkbox" data-testid="mp-wgo" checked={withGrantOption} onChange={(e) => setWithGrantOption(e.target.checked)} style={{ accentColor: C.accent, cursor: "pointer" }} />
          WITH GRANT OPTION
        </label>
      )}
    </>
  );
}
