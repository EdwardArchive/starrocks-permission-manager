/**
 * Running Queries panel (issue #15) — lists SHOW PROC '/current_queries'
 * joined with the SQL text, sortable by resource columns, row click expands
 * full SQL + details. Polls every 10s while mounted and the page is visible.
 *
 * StarRocks gates the data behind the OPERATE (cluster_admin) privilege;
 * a 403 renders an in-place message and stops polling.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { getClusterQueries } from "../../api/cluster";
import { ApiError } from "../../api/client";
import { clockSkewMs, formatRelativeTime, skewedNow } from "../../utils/relativeTime";
import { sortQueries, type QuerySortKey } from "../../utils/querySort";
import type { ClusterQueriesResponse, RunningQueryInfo } from "../../types";
import { C } from "../../utils/colors";
import { Badge, Loader, TH, TD } from "../tabs/inventory-ui";
import { SectionHeader, Detail } from "./NodeCards";
import InlineIcon from "../common/InlineIcon";

const POLL_MS = 10_000;

type SortKey = QuerySortKey;

/* Sortable column header: arrow only when active */
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

function NumTD({ children }: { children: React.ReactNode }) {
  return (
    <td style={{ padding: "8px 10px", fontSize: 12, color: C.text1, borderBottom: `1px solid ${C.border}`, textAlign: "right", whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>
      {children}
    </td>
  );
}

function fmtRows(n: number | null): string {
  if (n == null) return "—";
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return String(n);
}

/* Expanded row detail: full SQL + all stats */
function QueryDetail({ q, now }: { q: RunningQueryInfo; now: Date }) {
  const [copied, setCopied] = useState(false);
  return (
    <div style={{ padding: "10px 12px", background: "rgba(59,130,246,0.04)", borderBottom: `1px solid ${C.border}` }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: "6px 16px", marginBottom: 10 }}>
        <Detail label="Query ID" value={q.query_id} />
        {q.connection_id != null && <Detail label="Connection ID" value={String(q.connection_id)} />}
        {q.start_time && <Detail label="Started" value={`${formatRelativeTime(q.start_time, now)} (${q.start_time})`} />}
        {q.fe_ip && <Detail label="Frontend" value={q.fe_ip} />}
        {q.warehouse && <Detail label="Warehouse" value={q.warehouse} />}
        {q.resource_group && <Detail label="Resource Group" value={q.resource_group} />}
        {q.exec_progress && <Detail label="Progress" value={q.exec_progress} />}
        {q.spill_display && <Detail label="Disk Spill" value={q.spill_display} />}
      </div>
      {q.sql ? (
        <div style={{ position: "relative" }}>
          <pre style={{
            margin: 0, padding: "10px 12px", background: C.bg, border: `1px solid ${C.border}`,
            borderRadius: 6, fontSize: 12, color: C.text1, whiteSpace: "pre-wrap", wordBreak: "break-word",
            maxHeight: 240, overflowY: "auto", fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
          }}>
            {q.sql}
          </pre>
          <button
            onClick={() => {
              navigator.clipboard?.writeText(q.sql ?? "").then(() => {
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              });
            }}
            style={{
              position: "absolute", top: 6, right: 6, padding: "3px 8px", fontSize: 11,
              border: `1px solid ${C.borderLight}`, borderRadius: 4, background: C.card,
              color: copied ? C.green : C.text2, cursor: "pointer", fontFamily: "inherit",
            }}
          >
            {copied ? "Copied" : "Copy SQL"}
          </button>
        </div>
      ) : (
        <div style={{ fontSize: 12, color: C.text3, fontStyle: "italic" }}>
          SQL text unavailable (connection no longer in the processlist)
        </div>
      )}
    </div>
  );
}

export default function QueriesPanel() {
  const [data, setData] = useState<ClusterQueriesResponse | null>(null);
  const [error, setError] = useState<{ status: number | null; message: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [sortKey, setSortKey] = useState<SortKey>("exec_time_ms");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const deniedRef = useRef(false); // 403 → stop polling

  const fetchData = useCallback((refresh = false) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    getClusterQueries(controller.signal, refresh)
      .then((res) => {
        deniedRef.current = false;
        setData(res);
        setError(null);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        const status = err instanceof ApiError ? err.status : null;
        if (status === 403) deniedRef.current = true;
        setError({ status, message: err instanceof Error ? err.message : "Unknown error" });
        setLoading(false);
      });
  }, []);

  // Initial fetch + 10s polling (paused while the page is hidden or after a 403)
  useEffect(() => {
    fetchData();
    const interval = setInterval(() => {
      if (document.hidden || deniedRef.current) return;
      fetchData();
    }, POLL_MS);
    return () => {
      clearInterval(interval);
      abortRef.current?.abort();
    };
  }, [fetchData]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  };

  const now = skewedNow(clockSkewMs(data?.server_now));
  const queries = data ? sortQueries(data.queries, sortKey, sortDir) : [];

  return (
    <div data-testid="queries-panel">
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <div style={{ flex: 1 }}>
          <SectionHeader title="Running Queries" count={data?.queries.length ?? 0} />
        </div>
        <span style={{ fontSize: 11, color: C.text3, whiteSpace: "nowrap" }}>auto-refresh 10s</span>
        <button
          onClick={() => fetchData(true)}
          title="Refresh now"
          data-testid="queries-refresh-btn"
          style={{
            width: 26, height: 26, border: `1px solid ${C.borderLight}`, borderRadius: 6,
            background: "transparent", color: C.text2, cursor: "pointer",
            display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "inherit",
          }}
          onMouseEnter={(e) => { e.currentTarget.style.color = C.accent; }}
          onMouseLeave={(e) => { e.currentTarget.style.color = C.text2; }}
        >
          <InlineIcon type="refresh" size={13} />
        </button>
      </div>

      {loading && <Loader />}

      {/* Permission denied (no OPERATE privilege) */}
      {!loading && error?.status === 403 && (
        <div style={{
          padding: 12, borderRadius: 6, border: `1px solid ${C.accent}40`, background: `${C.accent}12`,
          fontSize: 12, color: C.text1, display: "flex", gap: 8, alignItems: "flex-start",
        }}>
          <span style={{ display: "inline-flex", paddingTop: 1 }}><InlineIcon type="info" size={14} /></span>
          <span>
            Viewing running queries requires the <code style={{ color: C.accent }}>cluster_admin</code> role
            (OPERATE privilege).{" "}
            <button
              onClick={() => fetchData(true)}
              style={{ background: "none", border: "none", color: C.accent, cursor: "pointer", fontSize: 12, padding: 0, fontFamily: "inherit" }}
            >
              Retry
            </button>
          </span>
        </div>
      )}

      {/* Other errors */}
      {!loading && error && error.status !== 403 && (
        <div style={{
          padding: 12, borderRadius: 6, border: `1px solid ${C.borderLight}`,
          background: "rgba(239,68,68,0.06)", fontSize: 12, color: C.text2, textAlign: "center",
        }}>
          Failed to load running queries.{" "}
          <button
            onClick={() => fetchData()}
            style={{ background: "none", border: "none", color: C.accent, cursor: "pointer", fontSize: 12, padding: 0, fontFamily: "inherit" }}
          >
            Retry
          </button>
        </div>
      )}

      {/* Empty state */}
      {!loading && !error && queries.length === 0 && (
        <div style={{ fontSize: 12, color: C.text3, padding: "14px 0", textAlign: "center" }}>
          No queries are currently running
        </div>
      )}

      {/* Table */}
      {!loading && !error && queries.length > 0 && (
        <div style={{ overflowX: "auto" }}>
          <table data-testid="queries-table" style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <TH>User</TH>
                <TH>DB</TH>
                <TH>State</TH>
                <QSortTH label="Exec Time" active={sortKey === "exec_time_ms"} dir={sortDir} onClick={() => toggleSort("exec_time_ms")} />
                <QSortTH label="CPU" active={sortKey === "cpu_time_ms"} dir={sortDir} onClick={() => toggleSort("cpu_time_ms")} />
                <QSortTH label="Memory" active={sortKey === "memory_bytes"} dir={sortDir} onClick={() => toggleSort("memory_bytes")} />
                <QSortTH label="Scan Rows" active={sortKey === "scan_rows"} dir={sortDir} onClick={() => toggleSort("scan_rows")} />
                <QSortTH label="Scan Bytes" active={sortKey === "scan_bytes"} dir={sortDir} onClick={() => toggleSort("scan_bytes")} />
                <QSortTH label="Spill" active={sortKey === "spill_bytes"} dir={sortDir} onClick={() => toggleSort("spill_bytes")} />
                <TH>SQL</TH>
              </tr>
            </thead>
            <tbody>
              {queries.map((q) => {
                const expanded = expandedId === q.query_id;
                return [
                  <tr
                    key={q.query_id}
                    data-testid="query-row"
                    onClick={() => setExpandedId(expanded ? null : q.query_id)}
                    style={{ cursor: "pointer", background: expanded ? "rgba(59,130,246,0.06)" : "transparent" }}
                  >
                    <TD>{q.user}</TD>
                    <TD>{q.database ?? "—"}</TD>
                    <td style={{ padding: "8px 10px", borderBottom: `1px solid ${C.border}` }}>
                      <Badge text={q.exec_state ?? "?"} color={q.exec_state === "RUNNING" ? C.green : C.text2} />
                    </td>
                    <NumTD>{q.exec_time_display ?? "—"}</NumTD>
                    <NumTD>{q.cpu_time_display ?? "—"}</NumTD>
                    <NumTD>{q.memory_display ?? "—"}</NumTD>
                    <NumTD>{fmtRows(q.scan_rows)}</NumTD>
                    <NumTD>{q.scan_bytes_display ?? "—"}</NumTD>
                    <NumTD>{q.spill_display ?? "—"}</NumTD>
                    <td style={{
                      padding: "8px 10px", fontSize: 12, color: C.text2, borderBottom: `1px solid ${C.border}`,
                      maxWidth: 320, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                      fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                    }} title={q.sql ?? undefined}>
                      {q.sql ?? "—"}
                    </td>
                  </tr>,
                  expanded ? (
                    <tr key={`${q.query_id}:detail`}>
                      <td colSpan={10} style={{ padding: 0 }}>
                        <QueryDetail q={q} now={now} />
                      </td>
                    </tr>
                  ) : null,
                ];
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
