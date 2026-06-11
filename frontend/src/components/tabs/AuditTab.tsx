import { useEffect, useState } from "react";
import { getAuditLog } from "../../api/admin";
import { useGrantStore } from "../../stores/grantStore";
import { C } from "../../utils/colors";
import { Loader } from "./inventory-ui";
import type { AuditEntry } from "../../types";

const thStyle: React.CSSProperties = {
  textAlign: "left", padding: "8px 12px", fontSize: 12, color: C.text2,
  fontWeight: 600, borderBottom: `1px solid ${C.borderLight}`, whiteSpace: "nowrap",
};
const tdStyle: React.CSSProperties = {
  padding: "8px 12px", fontSize: 12.5, color: C.text1,
  borderBottom: `1px solid ${C.borderLight}`, verticalAlign: "top",
};

export default function AuditTab() {
  const refreshTick = useGrantStore((s) => s.refreshTick);
  const [entries, setEntries] = useState<AuditEntry[] | null>(null);
  const [error, setError] = useState("");
  const [actorFilter, setActorFilter] = useState("");
  const [actionFilter, setActionFilter] = useState("");
  const [failuresOnly, setFailuresOnly] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getAuditLog(200, actorFilter || undefined, actionFilter || undefined)
      .then((es) => { if (!cancelled) { setEntries(es); setError(""); } })
      .catch((e: Error) => { if (!cancelled) { setEntries([]); setError(e.message); } });
    return () => { cancelled = true; };
  }, [refreshTick, actorFilter, actionFilter]);

  const visible = entries === null ? null : failuresOnly ? entries.filter((e) => e.result !== "ok") : entries;

  return (
    <div style={{ flex: 1, overflow: "auto", background: C.bg, padding: 20 }}>
      <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 14 }}>
        <input
          data-testid="audit-actor-filter"
          placeholder="Filter by actor…"
          value={actorFilter}
          onChange={(e) => setActorFilter(e.target.value)}
          style={{ padding: "6px 10px", fontSize: 13, background: C.card, color: C.text1, border: `1px solid ${C.borderLight}`, borderRadius: 6, fontFamily: "inherit", width: 220 }}
        />
        <select
          data-testid="audit-action-filter"
          value={actionFilter}
          onChange={(e) => setActionFilter(e.target.value)}
          style={{ padding: "6px 10px", fontSize: 13, background: C.card, color: C.text1, border: `1px solid ${C.borderLight}`, borderRadius: 6, fontFamily: "inherit", cursor: "pointer" }}
        >
          <option value="">All actions</option>
          <option value="GRANT">GRANT</option>
          <option value="REVOKE">REVOKE</option>
        </select>
        <label style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 12.5, color: C.text2, cursor: "pointer" }}>
          <input
            type="checkbox"
            data-testid="audit-failures-only"
            checked={failuresOnly}
            onChange={(e) => setFailuresOnly(e.target.checked)}
            style={{ accentColor: C.accent, cursor: "pointer" }}
          />
          Failures only
        </label>
        <span style={{ fontSize: 12, color: C.text3, marginLeft: "auto" }}>
          {visible ? `${visible.length} entries` : ""}
        </span>
      </div>

      {visible === null ? (
        <Loader />
      ) : error ? (
        <div style={{ padding: 24, fontSize: 13, color: C.text2 }}>
          Could not load the audit log: {error}
          <div style={{ marginTop: 6, color: C.text3, fontSize: 12 }}>
            Make sure the srpm_audit.grant_log table exists and your account can SELECT it (see operator setup docs).
          </div>
        </div>
      ) : (
        <table data-testid="audit-table" style={{ width: "100%", borderCollapse: "collapse", background: C.card, border: `1px solid ${C.borderLight}`, borderRadius: 8 }}>
          <thead>
            <tr>
              <th style={thStyle}>Time</th>
              <th style={thStyle}>Actor</th>
              <th style={thStyle}>Action</th>
              <th style={thStyle}>Kind</th>
              <th style={thStyle}>SQL</th>
              <th style={thStyle}>Result</th>
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 ? (
              <tr><td style={{ ...tdStyle, color: C.text3 }} colSpan={6}>No audit entries.</td></tr>
            ) : (
              visible.map((e, i) => (
                <tr key={i} data-testid="audit-row">
                  <td style={{ ...tdStyle, whiteSpace: "nowrap", color: C.text2 }}>{e.log_time}</td>
                  <td style={{ ...tdStyle, whiteSpace: "nowrap" }}>{e.actor}</td>
                  <td style={{ ...tdStyle, color: e.action === "GRANT" ? "#4ade80" : "#f87171", fontWeight: 600 }}>{e.action}</td>
                  <td style={{ ...tdStyle, color: C.text2 }}>{e.grant_type}</td>
                  <td style={{ ...tdStyle, fontFamily: "monospace", fontSize: 12, wordBreak: "break-all" }}>
                    {e.sql_text}
                    <button
                      data-testid="audit-copy-sql"
                      title="Copy SQL"
                      onClick={() => { void navigator.clipboard?.writeText(e.sql_text); }}
                      style={{ marginLeft: 6, padding: "0 6px", fontSize: 10, border: `1px solid ${C.borderLight}`, borderRadius: 4, background: "transparent", color: C.text3, cursor: "pointer", fontFamily: "inherit" }}
                    >
                      copy
                    </button>
                    {e.error_msg && <div style={{ color: "#fca5a5", marginTop: 4 }}>{e.error_msg}</div>}
                  </td>
                  <td style={{ ...tdStyle, color: e.result === "ok" ? "#4ade80" : "#f87171", fontWeight: 600 }}>{e.result}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      )}
    </div>
  );
}
