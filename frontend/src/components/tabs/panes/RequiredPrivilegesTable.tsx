import type { ReactNode } from "react";
import { C } from "../../../utils/inventory-helpers";

/* ══════════════════════════════════════════════════════════════
   RequiredPrivilegesTable — shared "no grantable privileges" explainer.

   Data-driven shell for the TASK and PIPE fallback panels: an info banner,
   an intro paragraph, an Action / Required Privilege table fed by row arrays,
   and an italic footnote. Both callers share a byte-identical table shell, so
   only the banner / intro / rows / note differ.
   ══════════════════════════════════════════════════════════════ */

export interface PrivReqRow {
  action: ReactNode;
  requirement: ReactNode;
}

export function RequiredPrivilegesTable({ banner, intro, rows, note }: {
  banner: string;
  intro: ReactNode;
  rows: PrivReqRow[];
  note: ReactNode;
}) {
  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 14, padding: "8px 12px", background: "rgba(59,130,246,0.06)", borderLeft: "2px solid #3b82f6", borderRadius: "0 4px 4px 0" }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: C.text1 }}>{banner}</span>
      </div>
      <p style={{ marginBottom: 10, color: C.text2 }}>{intro}</p>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, marginBottom: 12 }}>
        <thead>
          <tr style={{ borderBottom: `1px solid ${C.border}` }}>
            <th style={{ textAlign: "left", padding: "6px 8px", color: C.text3, fontSize: 10, textTransform: "uppercase" }}>Action</th>
            <th style={{ textAlign: "left", padding: "6px 8px", color: C.text3, fontSize: 10, textTransform: "uppercase" }}>Required Privilege</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} style={{ borderBottom: `1px solid ${C.border}22` }}>
              <td style={{ padding: "6px 8px", color: C.text1, fontWeight: 500 }}>{row.action}</td>
              <td style={{ padding: "6px 8px" }}>{row.requirement}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p style={{ fontSize: 11, color: C.text3, fontStyle: "italic" }}>{note}</p>
    </>
  );
}
