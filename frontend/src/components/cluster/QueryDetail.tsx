/**
 * Expanded-row detail renderers for the Queries panel (Running + Recent),
 * split out of QueriesPanel to keep that module focused on the toolbar and
 * table views. Presentational only — no data fetching.
 */
import { useState } from "react";
import { formatRelativeTime } from "../../utils/relativeTime";
import { fmtBytes, fmtDurationMs } from "../../utils/queryFormat";
import type { RunningQueryInfo, HistoryQueryInfo } from "../../types";
import { C } from "../../utils/colors";
import { Detail } from "./NodeCards";

/* Copyable SQL block — shared by both detail panels */
function SqlBlock({ sql }: { sql: string | null }) {
  const [copied, setCopied] = useState(false);
  if (!sql) {
    return <div style={{ fontSize: 12, color: C.text3, fontStyle: "italic" }}>SQL text unavailable</div>;
  }
  return (
    <div style={{ position: "relative" }}>
      <pre style={{
        margin: 0, padding: "10px 12px", background: C.bg, border: `1px solid ${C.border}`,
        borderRadius: 6, fontSize: 12, color: C.text1, whiteSpace: "pre-wrap", wordBreak: "break-word",
        maxHeight: 240, overflowY: "auto", fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
      }}>{sql}</pre>
      <button
        onClick={() => navigator.clipboard?.writeText(sql).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); })}
        style={{
          position: "absolute", top: 6, right: 6, padding: "3px 8px", fontSize: 11,
          border: `1px solid ${C.borderLight}`, borderRadius: 4, background: C.card,
          color: copied ? C.green : C.text2, cursor: "pointer", fontFamily: "inherit",
        }}
      >{copied ? "Copied" : "Copy SQL"}</button>
    </div>
  );
}

/* Two-step inline KILL confirm (grant-admin only) */
function KillButton({ onKill }: { onKill: () => Promise<void> }) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  if (!confirming) {
    return (
      <button
        data-testid="kill-btn"
        onClick={() => setConfirming(true)}
        style={{
          padding: "4px 12px", fontSize: 12, fontWeight: 600, fontFamily: "inherit",
          border: "1px solid #ef444455", borderRadius: 4, background: "rgba(239,68,68,0.08)",
          color: "#ef4444", cursor: "pointer",
        }}
      >Kill query</button>
    );
  }
  return (
    <span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
      <span style={{ fontSize: 12, color: C.text2 }}>Cancel this query?</span>
      <button
        data-testid="kill-confirm-btn"
        disabled={busy}
        onClick={async () => { setBusy(true); try { await onKill(); } finally { setBusy(false); setConfirming(false); } }}
        style={{
          padding: "4px 12px", fontSize: 12, fontWeight: 600, fontFamily: "inherit",
          border: "1px solid #ef4444", borderRadius: 4, background: "#ef4444",
          color: "#fff", cursor: busy ? "not-allowed" : "pointer", opacity: busy ? 0.6 : 1,
        }}
      >{busy ? "Killing…" : "Confirm kill"}</button>
      <button
        onClick={() => setConfirming(false)}
        style={{ padding: "4px 10px", fontSize: 12, fontFamily: "inherit", border: `1px solid ${C.borderLight}`, borderRadius: 4, background: "transparent", color: C.text2, cursor: "pointer" }}
      >Cancel</button>
    </span>
  );
}

/* ── Running query detail ── */
export function RunningDetail({ q, now, totalCores, instCores, canKill, onKill }: {
  q: RunningQueryInfo; now: Date; totalCores: number | null; instCores: number | null;
  canKill: boolean; onKill: () => Promise<void>;
}) {
  return (
    <div style={{ padding: "10px 12px", background: "rgba(59,130,246,0.04)", borderBottom: `1px solid ${C.border}` }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: "6px 16px", marginBottom: 10 }}>
        <Detail label="Query ID" value={q.query_id} />
        {q.connection_id != null && <Detail label="Connection ID" value={String(q.connection_id)} />}
        {q.start_time && <Detail label="Started" value={`${formatRelativeTime(q.start_time, now)} (${q.start_time})`} />}
        {q.fe_ip && <Detail label="Frontend" value={q.fe_ip} />}
        {q.warehouse && <Detail label="Warehouse" value={q.warehouse} />}
        {q.resource_group && <Detail label="Resource Group" value={q.resource_group} />}
        {q.cpu_avg_cores != null && (
          <Detail label="Avg CPU (since start)" value={`${q.cpu_avg_cores} cores${totalCores ? ` · ${((q.cpu_avg_cores / totalCores) * 100).toFixed(1)}% of ${totalCores}` : ""}`} />
        )}
        {instCores != null && (
          <Detail label="CPU now (last interval)" value={`${instCores.toFixed(2)} cores${totalCores ? ` · ${((instCores / totalCores) * 100).toFixed(1)}%` : ""}`} />
        )}
        {q.exec_progress && <Detail label="Progress" value={q.exec_progress} />}
        {q.spill_display && <Detail label="Disk Spill" value={q.spill_display} />}
      </div>
      <SqlBlock sql={q.sql} />
      {canKill && (
        <div style={{ marginTop: 10, display: "flex", justifyContent: "flex-end" }}>
          <KillButton onKill={onKill} />
        </div>
      )}
    </div>
  );
}

/* ── History query detail ── */
export function HistoryDetail({ q, now }: { q: HistoryQueryInfo; now: Date }) {
  return (
    <div style={{ padding: "10px 12px", background: "rgba(59,130,246,0.04)", borderBottom: `1px solid ${C.border}` }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: "6px 16px", marginBottom: 10 }}>
        {q.query_id && <Detail label="Query ID" value={q.query_id} />}
        {q.timestamp && <Detail label="Finished" value={`${formatRelativeTime(q.timestamp, now)} (${q.timestamp})`} />}
        {q.user && <Detail label="User" value={q.user} />}
        {q.warehouse && <Detail label="Warehouse" value={q.warehouse} />}
        {q.query_type && <Detail label="Type" value={q.query_type} />}
        <Detail label="Duration" value={fmtDurationMs(q.query_time_ms)} />
        {q.mem_cost_bytes != null && <Detail label="Peak Memory" value={fmtBytes(q.mem_cost_bytes)} />}
        {q.cpu_cost_ns != null && <Detail label="CPU Cost" value={`${(q.cpu_cost_ns / 1e9).toFixed(2)} s`} />}
      </div>
      {q.is_error && q.error_code && (
        <div style={{ marginBottom: 10, padding: "6px 10px", borderRadius: 4, fontSize: 12, color: "#ef4444", background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.3)", whiteSpace: "pre-wrap" }}>
          {q.error_code}
        </div>
      )}
      <SqlBlock sql={q.sql} />
    </div>
  );
}
