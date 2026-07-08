/**
 * Queries panel (issue #15 + cluster-monitor follow-ups).
 *
 * Two subtabs:
 *  - Running: SHOW PROC '/global_current_queries' joined with the SQL text,
 *    sortable, with an instantaneous CPU% derived from the poll-to-poll delta
 *    and a grant-admin-only KILL action. Polls on a selectable interval.
 *  - Recent:  completed queries from the AuditLoader table (history), with an
 *    errors-only filter. Hidden gracefully when the plugin table is absent.
 *
 * StarRocks gates the data behind cluster_admin; a 403 renders in place.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getClusterQueries, getClusterQueryHistory, killClusterQuery } from "../../api/cluster";
import { usePolling, useTickerNow } from "../../hooks/usePolling";
import { ApiError } from "../../api/client";
import { clockSkewMs, formatRelativeTime, skewedNow } from "../../utils/relativeTime";
import { sortQueries, sortHistory, type QuerySortKey, type HistorySortKey } from "../../utils/querySort";
import { fmtRows, fmtBytes, fmtDurationMs, fmtCpuShare } from "../../utils/queryFormat";
import { showToast } from "../../utils/toast";
import type {
  ClusterQueriesResponse,
  ClusterHistoryResponse,
  RunningQueryInfo,
  HistoryQueryInfo,
} from "../../types";
import { C } from "../../utils/colors";
import { Badge, Loader, TH } from "../tabs/inventory-ui";
import { Detail } from "./NodeCards";
import InlineIcon from "../common/InlineIcon";

const REFRESH_OPTIONS = [
  { label: "5s", ms: 5_000 },
  { label: "10s", ms: 10_000 },
  { label: "30s", ms: 30_000 },
  { label: "Off", ms: 0 },
];
const DEFAULT_INTERVAL_MS = 10_000;
const HISTORY_LIMIT = 100;

type Tab = "running" | "history";

/* Sortable, right-aligned numeric column header */
function QSortTH({ label, active, dir, onClick }: { label: string; active: boolean; dir: "asc" | "desc"; onClick: () => void }) {
  return (
    <th onClick={onClick} style={{
      textAlign: "right", padding: "8px 10px", color: active ? C.text1 : C.text2, fontWeight: 600,
      fontSize: 10, textTransform: "uppercase", letterSpacing: "0.05em",
      borderBottom: `1px solid ${C.border}`, cursor: "pointer", userSelect: "none", whiteSpace: "nowrap",
    }}>
      <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
        {label}
        {active && <span style={{ fontSize: 8, color: C.accent }}>{dir === "asc" ? "▲" : "▼"}</span>}
      </span>
    </th>
  );
}

/* One base style for every data cell — keeps font size, line height, and
 * vertical alignment identical across text/badge/numeric/SQL columns. */
const CELL_BASE: React.CSSProperties = {
  padding: "8px 10px", fontSize: 12, lineHeight: "18px", color: C.text1,
  borderBottom: `1px solid ${C.border}`, verticalAlign: "middle", whiteSpace: "nowrap",
};

function CellTD({ children, muted, title }: { children: React.ReactNode; muted?: boolean; title?: string }) {
  return <td title={title} style={{ ...CELL_BASE, color: muted ? C.text3 : C.text1 }}>{children}</td>;
}
function NumTD({ children, title }: { children: React.ReactNode; title?: string }) {
  return <td title={title} style={{ ...CELL_BASE, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{children}</td>;
}
function SqlTD({ sql }: { sql: string | null }) {
  return (
    <td style={{
      ...CELL_BASE, color: C.text2, maxWidth: 320, overflow: "hidden", textOverflow: "ellipsis",
      fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
    }} title={sql ?? undefined}>
      {sql ?? "—"}
    </td>
  );
}

function StateBadge({ state, isError }: { state: string | null; isError?: boolean }) {
  const ok = !isError && state !== "ERR";
  const color = state === "RUNNING" ? C.green : ok ? C.green : "#ef4444";
  return <Badge text={state ?? "?"} color={color} />;
}

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
function RunningDetail({ q, now, totalCores, instCores, canKill, onKill }: {
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
function HistoryDetail({ q, now }: { q: HistoryQueryInfo; now: Date }) {
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

/* Shared filter test across the visible text columns */
function matchesFilter(text: string, ...fields: (string | null | undefined)[]): boolean {
  if (!text) return true;
  const q = text.toLowerCase();
  return fields.some((f) => f != null && f.toLowerCase().includes(q));
}

const inputStyle: React.CSSProperties = {
  padding: "5px 9px", fontSize: 12, fontFamily: "inherit", background: C.bg,
  border: `1px solid ${C.borderLight}`, borderRadius: 6, color: C.text1, outline: "none",
};

export default function QueriesPanel({ totalCores = null }: { totalCores?: number | null }) {
  const [tab, setTab] = useState<Tab>("running");
  const [intervalMs, setIntervalMs] = useState(DEFAULT_INTERVAL_MS);
  const [filter, setFilter] = useState("");
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);
  const nowTick = useTickerNow(); // 1s ticker for "updated Xs ago"

  // Running
  const [running, setRunning] = useState<ClusterQueriesResponse | null>(null);
  const [runErr, setRunErr] = useState<{ status: number | null; message: string } | null>(null);
  const [runLoading, setRunLoading] = useState(true);
  const [runSortKey, setRunSortKey] = useState<QuerySortKey>("exec_time_ms");
  const [runSortDir, setRunSortDir] = useState<"asc" | "desc">("desc");
  const [runExpanded, setRunExpanded] = useState<string | null>(null);
  const runAbort = useRef<AbortController | null>(null);
  const deniedRef = useRef(false);
  // instantaneous CPU: query_id → { cpuMs, atMs }; and the derived cores
  const cpuSamples = useRef<Map<string, { cpuMs: number; atMs: number }>>(new Map());
  const [instCores, setInstCores] = useState<Map<string, number>>(new Map());

  // History
  const [history, setHistory] = useState<ClusterHistoryResponse | null>(null);
  const [histErr, setHistErr] = useState<{ status: number | null; message: string } | null>(null);
  const [histLoading, setHistLoading] = useState(false);
  const [errorsOnly, setErrorsOnly] = useState(false);
  const [histSortKey, setHistSortKey] = useState<HistorySortKey>("timestamp");
  const [histSortDir, setHistSortDir] = useState<"asc" | "desc">("desc");
  const [histExpanded, setHistExpanded] = useState<string | null>(null);
  const histAbort = useRef<AbortController | null>(null);

  const fetchRunning = useCallback((refresh = false) => {
    runAbort.current?.abort();
    const controller = new AbortController();
    runAbort.current = controller;
    getClusterQueries(controller.signal, refresh)
      .then((res) => {
        deniedRef.current = false;
        // derive instantaneous CPU from the delta vs the previous sample
        const nowMs = Date.now();
        const nextSamples = new Map<string, { cpuMs: number; atMs: number }>();
        const nextInst = new Map<string, number>();
        for (const q of res.queries) {
          if (q.cpu_time_ms != null) {
            const prev = cpuSamples.current.get(q.query_id);
            nextSamples.set(q.query_id, { cpuMs: q.cpu_time_ms, atMs: nowMs });
            if (prev && nowMs > prev.atMs) {
              const cores = (q.cpu_time_ms - prev.cpuMs) / (nowMs - prev.atMs);
              if (cores >= 0) nextInst.set(q.query_id, cores);
            }
          }
        }
        cpuSamples.current = nextSamples;
        setInstCores(nextInst);
        setRunning(res);
        setRunErr(null);
        setRunLoading(false);
        setLastUpdated(nowMs);
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        const status = err instanceof ApiError ? err.status : null;
        if (status === 403) deniedRef.current = true;
        setRunErr({ status, message: err instanceof Error ? err.message : "Unknown error" });
        setRunLoading(false);
      });
  }, []);

  const fetchHistory = useCallback((errOnly: boolean) => {
    histAbort.current?.abort();
    const controller = new AbortController();
    histAbort.current = controller;
    setHistLoading(true);
    getClusterQueryHistory({ limit: HISTORY_LIMIT, errorsOnly: errOnly }, controller.signal)
      .then((res) => { setHistory(res); setHistErr(null); setHistLoading(false); setLastUpdated(Date.now()); })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        const status = err instanceof ApiError ? err.status : null;
        setHistErr({ status, message: err instanceof Error ? err.message : "Unknown error" });
        setHistLoading(false);
      });
  }, []);

  // Running: fetch now on subtab entry / interval change; then poll on the
  // selected interval while active (ticks skipped while hidden or after a 403)
  useEffect(() => {
    if (tab !== "running") return;
    fetchRunning();
    return () => runAbort.current?.abort();
  }, [tab, intervalMs, fetchRunning]);
  usePolling(() => { if (!deniedRef.current) fetchRunning(); }, intervalMs, { enabled: tab === "running" });

  // History: fetch now on subtab entry / filter or interval change (+ polling)
  useEffect(() => {
    if (tab !== "history") return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetchHistory's sync setLoading(true) is intentional: enter loading on tab open
    fetchHistory(errorsOnly);
    return () => histAbort.current?.abort();
  }, [tab, errorsOnly, intervalMs, fetchHistory]);
  usePolling(() => fetchHistory(errorsOnly), intervalMs, { enabled: tab === "history" });

  const now = skewedNow(clockSkewMs(tab === "running" ? running?.server_now : history?.server_now));

  const toggleRunSort = (key: QuerySortKey) => {
    if (runSortKey === key) setRunSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setRunSortKey(key); setRunSortDir("desc"); }
  };
  const toggleHistSort = (key: HistorySortKey) => {
    if (histSortKey === key) setHistSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setHistSortKey(key); setHistSortDir("desc"); }
  };

  const runRows = useMemo(() => {
    if (!running) return [];
    const filtered = running.queries.filter((q) => matchesFilter(filter, q.user, q.database, q.warehouse, q.sql));
    return sortQueries(filtered, runSortKey, runSortDir);
  }, [running, filter, runSortKey, runSortDir]);

  const histRows = useMemo(() => {
    if (!history) return [];
    const filtered = history.queries.filter((q) => matchesFilter(filter, q.user, q.database, q.warehouse, q.sql));
    return sortHistory(filtered, histSortKey, histSortDir);
  }, [history, filter, histSortKey, histSortDir]);

  const doKill = async (q: RunningQueryInfo) => {
    try {
      await killClusterQuery(q.query_id);
      showToast(`Query killed (${q.user})`, "info");
      setRunExpanded(null);
      fetchRunning(true);
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Kill failed", "error");
    }
  };

  const updatedAgo = lastUpdated ? Math.max(0, Math.round((nowTick - lastUpdated) / 1000)) : null;
  const canKill = running?.can_kill ?? false;

  return (
    <div data-testid="queries-panel">
      {/* Header: subtabs + controls */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <div style={{ display: "flex", gap: 4 }}>
          {(["running", "history"] as Tab[]).map((t) => (
            <button
              key={t}
              data-testid={`queries-tab-${t}`}
              onClick={() => setTab(t)}
              style={{
                padding: "6px 14px", fontSize: 13, fontWeight: 600, fontFamily: "inherit", cursor: "pointer",
                border: "none", borderBottom: `2px solid ${tab === t ? C.accent : "transparent"}`,
                background: "none", color: tab === t ? C.accent : C.text2,
              }}
            >{t === "running" ? "Running" : "Recent"}</button>
          ))}
        </div>
        <span style={{ fontSize: 11, color: C.text3 }}>
          {tab === "running" ? `${running?.queries.length ?? 0} running` : history?.available ? `${history.queries.length} recent` : ""}
        </span>

        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 10 }}>
          {tab === "history" && (
            <label style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 12, color: C.text2, cursor: "pointer" }}>
              <input type="checkbox" data-testid="history-errors-only" checked={errorsOnly} onChange={(e) => setErrorsOnly(e.target.checked)} style={{ accentColor: C.accent, cursor: "pointer" }} />
              Errors only
            </label>
          )}
          <input
            data-testid="queries-filter"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter user / db / SQL…"
            style={{ ...inputStyle, width: 200 }}
          />
          <select
            data-testid="refresh-interval"
            value={intervalMs}
            onChange={(e) => setIntervalMs(Number(e.target.value))}
            style={{ ...inputStyle, cursor: "pointer" }}
            title="Auto-refresh interval"
          >
            {REFRESH_OPTIONS.map((o) => <option key={o.label} value={o.ms}>{o.label}</option>)}
          </select>
          {updatedAgo != null && (
            <span style={{ fontSize: 11, color: C.text3, whiteSpace: "nowrap" }}>updated {updatedAgo}s ago</span>
          )}
          <button
            onClick={() => (tab === "running" ? fetchRunning(true) : fetchHistory(errorsOnly))}
            title="Refresh now"
            data-testid="queries-refresh-btn"
            style={{ width: 26, height: 26, border: `1px solid ${C.borderLight}`, borderRadius: 6, background: "transparent", color: C.text2, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "inherit" }}
            onMouseEnter={(e) => { e.currentTarget.style.color = C.accent; }}
            onMouseLeave={(e) => { e.currentTarget.style.color = C.text2; }}
          >
            <InlineIcon type="refresh" size={13} />
          </button>
        </div>
      </div>
      <div style={{ borderBottom: `1px solid ${C.border}`, margin: "6px 0 8px" }} />

      {tab === "running" ? (
        <RunningView
          rows={runRows} loading={runLoading} error={runErr} now={now} totalCores={totalCores}
          instCores={instCores} sortKey={runSortKey} sortDir={runSortDir} onSort={toggleRunSort}
          expandedId={runExpanded} onExpand={setRunExpanded} canKill={canKill} onKill={doKill}
          onRetry={() => fetchRunning(true)}
        />
      ) : (
        <HistoryView
          data={history} rows={histRows} loading={histLoading} error={histErr} now={now}
          sortKey={histSortKey} sortDir={histSortDir} onSort={toggleHistSort}
          expandedId={histExpanded} onExpand={setHistExpanded} onRetry={() => fetchHistory(errorsOnly)}
        />
      )}
    </div>
  );
}

/* ── Running view ── */
function RunningView({ rows, loading, error, now, totalCores, instCores, sortKey, sortDir, onSort, expandedId, onExpand, canKill, onKill, onRetry }: {
  rows: RunningQueryInfo[]; loading: boolean; error: { status: number | null; message: string } | null;
  now: Date; totalCores: number | null; instCores: Map<string, number>;
  sortKey: QuerySortKey; sortDir: "asc" | "desc"; onSort: (k: QuerySortKey) => void;
  expandedId: string | null; onExpand: (id: string | null) => void;
  canKill: boolean; onKill: (q: RunningQueryInfo) => Promise<void>; onRetry: () => void;
}) {
  if (loading && rows.length === 0) return <Loader />;
  if (error?.status === 403) return <PermissionNote onRetry={onRetry} />;
  if (error) return <ErrorNote label="running queries" onRetry={onRetry} />;
  if (rows.length === 0) return <EmptyNote text="No queries are currently running" />;

  return (
    <div style={{ overflowX: "auto" }}>
      <table data-testid="queries-table" style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr>
            <TH>User</TH><TH>DB</TH><TH>State</TH>
            <QSortTH label="Exec Time" active={sortKey === "exec_time_ms"} dir={sortDir} onClick={() => onSort("exec_time_ms")} />
            <QSortTH label="CPU %" active={sortKey === "cpu_avg_cores"} dir={sortDir} onClick={() => onSort("cpu_avg_cores")} />
            <QSortTH label="Memory" active={sortKey === "memory_bytes"} dir={sortDir} onClick={() => onSort("memory_bytes")} />
            <QSortTH label="Scan Rows" active={sortKey === "scan_rows"} dir={sortDir} onClick={() => onSort("scan_rows")} />
            <QSortTH label="Scan Bytes" active={sortKey === "scan_bytes"} dir={sortDir} onClick={() => onSort("scan_bytes")} />
            <TH>SQL</TH>
          </tr>
        </thead>
        <tbody>
          {rows.map((q) => {
            const expanded = expandedId === q.query_id;
            const inst = instCores.get(q.query_id) ?? null;
            const cpuVal = inst ?? q.cpu_avg_cores;
            const cpuTitle = inst != null
              ? `now ≈${inst.toFixed(2)} cores (last interval)`
              : q.cpu_avg_cores != null ? `avg ≈${q.cpu_avg_cores} cores since start` : undefined;
            return [
              <tr key={q.query_id} data-testid="query-row" onClick={() => onExpand(expanded ? null : q.query_id)}
                style={{ cursor: "pointer", background: expanded ? "rgba(59,130,246,0.06)" : "transparent" }}>
                <CellTD>{q.user}</CellTD>
                {q.database ? <CellTD>{q.database}</CellTD>
                  : <CellTD muted title="No current database — query ran fully-qualified without USE">—</CellTD>}
                <td style={{ ...CELL_BASE, lineHeight: 1 }}><StateBadge state={q.exec_state} /></td>
                <NumTD>{q.exec_time_display ?? "—"}</NumTD>
                <NumTD title={cpuTitle}>{fmtCpuShare(cpuVal, totalCores)}</NumTD>
                <NumTD>{q.memory_display ?? "—"}</NumTD>
                <NumTD>{fmtRows(q.scan_rows)}</NumTD>
                <NumTD>{q.scan_bytes_display ?? "—"}</NumTD>
                <SqlTD sql={q.sql} />
              </tr>,
              expanded ? (
                <tr key={`${q.query_id}:d`}>
                  <td colSpan={9} style={{ padding: 0 }}>
                    <RunningDetail q={q} now={now} totalCores={totalCores} instCores={inst} canKill={canKill} onKill={() => onKill(q)} />
                  </td>
                </tr>
              ) : null,
            ];
          })}
        </tbody>
      </table>
    </div>
  );
}

/* ── History view ── */
function HistoryView({ data, rows, loading, error, now, sortKey, sortDir, onSort, expandedId, onExpand, onRetry }: {
  data: ClusterHistoryResponse | null; rows: HistoryQueryInfo[]; loading: boolean;
  error: { status: number | null; message: string } | null; now: Date;
  sortKey: HistorySortKey; sortDir: "asc" | "desc"; onSort: (k: HistorySortKey) => void;
  expandedId: string | null; onExpand: (id: string | null) => void; onRetry: () => void;
}) {
  if (loading && !data) return <Loader />;
  if (error?.status === 403) return <PermissionNote onRetry={onRetry} />;
  if (error) return <ErrorNote label="query history" onRetry={onRetry} />;
  if (data && !data.available) return <EmptyNote text={data.reason ?? "Query history is unavailable on this cluster."} />;
  if (rows.length === 0) return <EmptyNote text="No completed queries found" />;

  return (
    <div style={{ overflowX: "auto" }}>
      <table data-testid="history-table" style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr>
            <QSortTH label="Finished" active={sortKey === "timestamp"} dir={sortDir} onClick={() => onSort("timestamp")} />
            <TH>User</TH><TH>DB</TH><TH>State</TH>
            <QSortTH label="Duration" active={sortKey === "query_time_ms"} dir={sortDir} onClick={() => onSort("query_time_ms")} />
            <QSortTH label="Scan Rows" active={sortKey === "scan_rows"} dir={sortDir} onClick={() => onSort("scan_rows")} />
            <QSortTH label="Scan Bytes" active={sortKey === "scan_bytes"} dir={sortDir} onClick={() => onSort("scan_bytes")} />
            <QSortTH label="Memory" active={sortKey === "mem_cost_bytes"} dir={sortDir} onClick={() => onSort("mem_cost_bytes")} />
            <TH>SQL</TH>
          </tr>
        </thead>
        <tbody>
          {rows.map((q, i) => {
            const id = q.query_id ?? `row-${i}`;
            const expanded = expandedId === id;
            return [
              <tr key={id} data-testid="history-row" onClick={() => onExpand(expanded ? null : id)}
                style={{ cursor: "pointer", background: expanded ? "rgba(59,130,246,0.06)" : "transparent" }}>
                <CellTD title={q.timestamp ?? undefined}>{q.timestamp ? formatRelativeTime(q.timestamp, now) : "—"}</CellTD>
                <CellTD>{q.user ?? "—"}</CellTD>
                {q.database ? <CellTD>{q.database}</CellTD> : <CellTD muted>—</CellTD>}
                <td style={{ ...CELL_BASE, lineHeight: 1 }}><StateBadge state={q.state} isError={q.is_error} /></td>
                <NumTD>{fmtDurationMs(q.query_time_ms)}</NumTD>
                <NumTD>{fmtRows(q.scan_rows)}</NumTD>
                <NumTD>{fmtBytes(q.scan_bytes)}</NumTD>
                <NumTD>{fmtBytes(q.mem_cost_bytes)}</NumTD>
                <SqlTD sql={q.sql} />
              </tr>,
              expanded ? (
                <tr key={`${id}:d`}>
                  <td colSpan={9} style={{ padding: 0 }}><HistoryDetail q={q} now={now} /></td>
                </tr>
              ) : null,
            ];
          })}
        </tbody>
      </table>
    </div>
  );
}

/* ── Shared status notes ── */
function PermissionNote({ onRetry }: { onRetry: () => void }) {
  return (
    <div style={{ padding: 12, borderRadius: 6, border: `1px solid ${C.accent}40`, background: `${C.accent}12`, fontSize: 12, color: C.text1, display: "flex", gap: 8, alignItems: "flex-start" }}>
      <span style={{ display: "inline-flex", paddingTop: 1 }}><InlineIcon type="info" size={14} /></span>
      <span>
        This view requires the <code style={{ color: C.accent }}>cluster_admin</code> role (OPERATE privilege).{" "}
        <button onClick={onRetry} style={{ background: "none", border: "none", color: C.accent, cursor: "pointer", fontSize: 12, padding: 0, fontFamily: "inherit" }}>Retry</button>
      </span>
    </div>
  );
}
function ErrorNote({ label, onRetry }: { label: string; onRetry: () => void }) {
  return (
    <div style={{ padding: 12, borderRadius: 6, border: `1px solid ${C.borderLight}`, background: "rgba(239,68,68,0.06)", fontSize: 12, color: C.text2, textAlign: "center" }}>
      Failed to load {label}.{" "}
      <button onClick={onRetry} style={{ background: "none", border: "none", color: C.accent, cursor: "pointer", fontSize: 12, padding: 0, fontFamily: "inherit" }}>Retry</button>
    </div>
  );
}
function EmptyNote({ text }: { text: string }) {
  return <div style={{ fontSize: 12, color: C.text3, padding: "14px 0", textAlign: "center" }}>{text}</div>;
}
