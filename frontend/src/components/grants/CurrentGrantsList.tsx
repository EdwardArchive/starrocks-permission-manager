/** Revoke helper: lists the grantee's direct/scope/inherited grants; clicking a direct row loads it into the form. */
import { C } from "../../utils/colors";
import { SectionH } from "./primitives";
import type { PrivilegeGrant } from "../../types";

export default function CurrentGrantsList({
  directGrants,
  scopeGrants,
  inheritedGrants,
  onLoad,
  onJump,
}: {
  directGrants: PrivilegeGrant[];
  scopeGrants: PrivilegeGrant[];
  inheritedGrants: PrivilegeGrant[];
  onLoad: (g: PrivilegeGrant) => void;
  onJump: (sourceRole: string) => void;
}) {
  return (
    <div style={{ marginBottom: 16 }}>
      <SectionH title="Current grants" extra={<span style={{ fontSize: 10.5, color: C.text3 }}>click to load</span>} />
      <div style={{ border: `1px solid ${C.border}`, borderRadius: 8, maxHeight: 190, overflowY: "auto", background: C.bg }}>
        {directGrants.length === 0 && inheritedGrants.length === 0 && scopeGrants.length === 0 ? (
          <div style={{ padding: 12, fontSize: 12, color: C.text3 }}>No grants found for this grantee.</div>
        ) : (
          <>
            {directGrants.map((g, i) => (
              <div
                key={`d${i}`}
                data-testid="mp-direct-grant"
                role="button"
                tabIndex={0}
                onClick={() => onLoad(g)}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onLoad(g); } }}
                title="Load into the form below to revoke"
                style={{ padding: "8px 11px", fontSize: 12, color: C.text2, cursor: "pointer", borderBottom: `1px solid ${C.border}`, display: "flex", gap: 8, alignItems: "center" }}
                onMouseEnter={(e) => { e.currentTarget.style.background = "#ef444414"; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
              >
                <strong style={{ color: "#fca5a5" }}>{g.privilege_type}</strong>
                <span>{g.object_type}</span>
                <span style={{ color: C.text3 }}>
                  {[g.object_catalog, g.object_database, g.object_name].filter(Boolean).join(".")}
                </span>
                <span style={{ marginLeft: "auto", color: C.accent, fontSize: 11 }}>load →</span>
              </div>
            ))}
            {scopeGrants.map((g, i) => (
              <div
                key={`s${i}`}
                data-testid="mp-scope-grant"
                title="Wildcard scope grant (e.g. ON ALL TABLES IN ALL DATABASES) — cannot be revoked per-object"
                style={{ padding: "8px 11px", fontSize: 12, color: C.text3, borderBottom: `1px solid ${C.border}`, display: "flex", gap: 8, alignItems: "center", opacity: 0.6 }}
              >
                <span style={{ width: 13 }} />
                <strong>{g.privilege_type}</strong>
                <span>{g.object_type}</span>
                <span style={{ fontStyle: "italic" }}>ALL (scope grant — not revocable per-object)</span>
              </div>
            ))}
            {inheritedGrants.map((g, i) => (
              <div
                key={`i${i}`}
                data-testid="mp-inherited-grant"
                style={{ padding: "8px 11px", fontSize: 12, color: C.text3, borderBottom: `1px solid ${C.border}`, display: "flex", gap: 8, alignItems: "center", opacity: 0.75 }}
              >
                <span style={{ width: 13 }} />
                <strong>{g.privilege_type}</strong>
                <span>{g.object_type}</span>
                <span>{[g.object_catalog, g.object_database, g.object_name].filter(Boolean).join(".")}</span>
                <button
                  onClick={() => onJump(g.source)}
                  style={{ marginLeft: "auto", border: "none", background: "transparent", color: C.accent, fontSize: 11, cursor: "pointer", fontFamily: "inherit" }}
                  title={`Inherited — revoke at role ${g.source}`}
                >
                  via {g.source} →
                </button>
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  );
}
