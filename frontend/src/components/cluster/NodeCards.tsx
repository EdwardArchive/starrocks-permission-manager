/**
 * Cluster node UI building blocks — shared by the Cluster Monitor tab (full
 * dashboard) and the ClusterDrawer (quick glance summary).
 * Extracted from ClusterDrawer.tsx when the Cluster tab was introduced.
 */
import { formatRelativeTime } from "../../utils/relativeTime";
import { shortenNodeName } from "../../utils/nodeNameUtils";
import type { FENodeInfo, BENodeInfo } from "../../types";
import { C } from "../../utils/colors";
import { Badge } from "../tabs/inventory-ui";

/* ── Utilization progress bar (0–100%) ──
 * variant "pressure": green→orange→red as it fills (disk/memory/CPU — full is bad).
 * variant "info": constant accent color (CN data cache — full is normal). */
export function UtilBar({ pct, variant = "pressure" }: { pct: number; variant?: "pressure" | "info" }) {
  const color =
    variant === "info" ? C.accent : pct > 85 ? "#ef4444" : pct > 70 ? C.warning : C.green;
  return (
    <div style={{ width: "100%", height: 6, background: C.border, borderRadius: 3, overflow: "hidden", marginTop: 4 }}>
      <div style={{ width: `${Math.min(pct, 100)}%`, height: "100%", background: color, borderRadius: 3, transition: "width 0.3s" }} />
    </div>
  );
}

/* ── Labelled utilization row (metric name + bar, optional trend sparkline) ── */
export function MetricRow({ label, pct, extra, variant, spark }: { label: string; pct: number; extra?: React.ReactNode; variant?: "pressure" | "info"; spark?: number[] }) {
  return (
    <div style={{ marginBottom: 6 }}>
      <div style={{ fontSize: 11, color: C.text2, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <span>{label} <span style={{ color: C.text3 }}>{extra}</span></span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          {spark && spark.length >= 2 && <Sparkline values={spark} />}
          <strong style={{ color: C.text1 }}>{pct.toFixed(1)}%</strong>
        </span>
      </div>
      <UtilBar pct={pct} variant={variant} />
    </div>
  );
}

/* ── Sparkline (session-accumulated metric trend) ──
 * A tiny inline SVG line for the last N samples; 0–100 domain. */
export function Sparkline({ values, width = 56, height = 16 }: { values: number[]; width?: number; height?: number }) {
  if (values.length < 2) return null;
  const max = Math.max(100, ...values);
  const step = width / (values.length - 1);
  const pts = values
    .map((v, i) => `${(i * step).toFixed(1)},${(height - (Math.min(v, max) / max) * height).toFixed(1)}`)
    .join(" ");
  const last = values[values.length - 1];
  const color = last > 85 ? "#ef4444" : last > 70 ? C.warning : C.green;
  return (
    <svg width={width} height={height} style={{ display: "block", flexShrink: 0 }} aria-hidden>
      <polyline points={pts} fill="none" stroke={color} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

/* ── Status dot ── */
// Visual optical-center fix: align-items:center lines up box centers, but text's
// perceived weight sits slightly below its box center, so the dot needs a small
// downward nudge (0.5px) to *look* centered next to numbers/uppercase labels.
export function StatusDot({ alive }: { alive: boolean }) {
  return (
    <span style={{
      display: "inline-block", width: 8, height: 8, borderRadius: "50%",
      background: alive ? C.green : "#ef4444", flexShrink: 0,
      boxShadow: alive ? `0 0 4px ${C.green}80` : `0 0 4px #ef444480`,
      transform: "translateY(0.5px)",
    }} />
  );
}

/* ── Role badge color ── */
function roleBadgeColor(role: string): string {
  if (role === "LEADER") return C.accent;
  if (role === "OBSERVER") return C.warning;
  return C.text2;
}

/* ── FE Node card — resource metrics come from /metrics endpoint ──
 * `now` is the (clock-skew corrected) reference for relative timestamps. */
export function FENodeCard({ node, expanded, onToggle, now, heapHistory }: { node: FENodeInfo; expanded: boolean; onToggle: () => void; now?: Date; heapHistory?: number[] }) {
  const hasMetrics = node.jvm_heap_used_pct != null;
  const displayName = shortenNodeName(node.name);
  const displayIp = shortenNodeName(node.ip);

  return (
    <div style={{ border: `1px solid ${node.alive ? C.borderLight : "#ef4444"}`, borderRadius: 6, marginBottom: 6, overflow: "hidden", background: C.card }}>
      {/* Header row — clickable */}
      <div
        onClick={onToggle}
        style={{
          display: "flex", alignItems: "center", gap: 8, padding: "8px 12px",
          cursor: "pointer", userSelect: "none",
          background: expanded ? "rgba(59,130,246,0.06)" : "transparent",
        }}
      >
        <StatusDot alive={node.alive} />
        <span
          title={node.name}
          style={{ fontSize: 13, fontWeight: 600, color: C.text1, flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
        >
          {displayName}
        </span>
        {displayIp !== displayName && (
          <span title={node.ip} style={{ fontSize: 12, color: C.text2, flexShrink: 0 }}>{displayIp}</span>
        )}
        <Badge text={node.role} color={roleBadgeColor(node.role)} />
        <Badge text={node.alive ? "ALIVE" : "DEAD"} color={node.alive ? C.green : "#ef4444"} />
        <span style={{ fontSize: 10, color: C.text3, marginLeft: 2 }}>{expanded ? "▲" : "▼"}</span>
      </div>

      {/* Resource bars — Heap usage (from /metrics) */}
      {(hasMetrics || node.metrics_error) && (
        <div style={{ padding: "4px 12px 8px" }}>
          {hasMetrics ? (
            <MetricRow label="Heap" pct={node.jvm_heap_used_pct ?? 0} spark={heapHistory} />
          ) : (
            <div
              style={{
                fontSize: 11,
                color: C.text3,
                padding: "4px 8px",
                background: "rgba(148,163,184,0.08)",
                borderRadius: 4,
                fontStyle: "italic",
              }}
              title={node.metrics_error ?? ""}
            >
              Metrics unavailable ({node.metrics_error})
            </div>
          )}
        </div>
      )}

      {/* Expanded details */}
      {expanded && (
        <div style={{ padding: "8px 12px 10px", borderTop: `1px solid ${C.border}`, display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px 16px" }}>
          {node.version && <Detail label="Version" value={node.version} />}
          {node.replayed_journal_id != null && <Detail label="Journal ID" value={node.replayed_journal_id.toLocaleString()} />}
          {node.start_time && <Detail label="Start Time" value={formatRelativeTime(node.start_time, now)} />}
          {node.gc_young_count != null && (
            <Detail
              label="Young GC (cumulative)"
              value={`${node.gc_young_count.toLocaleString()} times${node.gc_young_time_ms != null ? ` · ${(node.gc_young_time_ms / 1000).toFixed(1)}s` : ""}`}
            />
          )}
          {node.gc_old_count != null && (
            <Detail
              label="Old GC (cumulative)"
              value={`${node.gc_old_count.toLocaleString()} times${node.gc_old_time_ms != null ? ` · ${(node.gc_old_time_ms / 1000).toFixed(1)}s` : ""}`}
            />
          )}
          {node.query_p99_ms != null && (
            <Detail label="Query p99" value={`${node.query_p99_ms.toFixed(1)} ms`} />
          )}
          {node.err_msg && (
            <div style={{ gridColumn: "1 / -1", color: "#ef4444", fontSize: 12, marginTop: 4, padding: "4px 8px", background: "rgba(239,68,68,0.08)", borderRadius: 4 }}>
              {node.err_msg}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ── BE/CN Node card — branches on node_type, resource-focused ── */
export function BENodeCard({ node, expanded, onToggle, now, cpuHistory, memHistory }: { node: BENodeInfo; expanded: boolean; onToggle: () => void; now?: Date; cpuHistory?: number[]; memHistory?: number[] }) {
  const isCompute = node.node_type === "compute";
  const diskPct = node.used_pct ?? 0;
  const diskLabel =
    node.data_used_capacity && node.total_capacity
      ? `${node.data_used_capacity} / ${node.total_capacity}`
      : null;
  const displayName = shortenNodeName(node.name);
  const displayIp = shortenNodeName(node.ip);

  return (
    <div style={{ border: `1px solid ${node.alive ? C.borderLight : "#ef4444"}`, borderRadius: 6, marginBottom: 6, overflow: "hidden", background: C.card }}>
      {/* Header row — clickable */}
      <div
        onClick={onToggle}
        style={{
          display: "flex", alignItems: "center", gap: 8, padding: "8px 12px",
          cursor: "pointer", userSelect: "none",
          background: expanded ? "rgba(59,130,246,0.06)" : "transparent",
        }}
      >
        <StatusDot alive={node.alive} />
        <span
          title={node.name}
          style={{ fontSize: 13, fontWeight: 600, color: C.text1, flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
        >
          {displayName}
        </span>
        {displayIp !== displayName && (
          <span title={node.ip} style={{ fontSize: 12, color: C.text2, flexShrink: 0 }}>{displayIp}</span>
        )}
        <Badge text={isCompute ? "CN" : "BE"} color={isCompute ? C.warning : C.accent} />
        <Badge text={node.alive ? "ALIVE" : "DEAD"} color={node.alive ? C.green : "#ef4444"} />
        <span style={{ fontSize: 10, color: C.text3, marginLeft: 2 }}>{expanded ? "▲" : "▼"}</span>
      </div>

      {/* Resource bars — always visible */}
      <div style={{ padding: "4px 12px 8px" }}>
        {node.tablet_count != null && (
          <div style={{ fontSize: 11, color: C.text3, marginBottom: 4 }}>
            {node.tablet_count.toLocaleString()} tablets
          </div>
        )}
        {/* Disk (BE: persistent → pressure colors) / Disk Cache (CN: a full cache is normal → info color) */}
        {diskLabel != null && node.used_pct != null && (
          <MetricRow
            label={isCompute ? "Disk Cache" : "Disk"}
            pct={diskPct}
            extra={diskLabel}
            variant={isCompute ? "info" : "pressure"}
          />
        )}

        {/* CPU (CN: from SHOW COMPUTE NODES; BE: from /metrics probe when available) */}
        {node.cpu_used_pct != null && (
          <MetricRow
            label="CPU"
            pct={node.cpu_used_pct}
            extra={node.cpu_cores != null ? `${node.cpu_cores} cores` : undefined}
            spark={cpuHistory}
          />
        )}

        {/* Memory (both BE and CN) */}
        {node.mem_used_pct != null && (
          <MetricRow
            label="Memory"
            pct={node.mem_used_pct}
            extra={node.mem_limit ? `of ${node.mem_limit}` : undefined}
            spark={memHistory}
          />
        )}
      </div>

      {/* Expanded details — identity / activity only; no ports */}
      {expanded && (
        <div style={{ padding: "8px 12px 10px", borderTop: `1px solid ${C.border}`, display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px 16px" }}>
          {isCompute && node.warehouse && <Detail label="Warehouse" value={node.warehouse} />}
          {!isCompute && node.cpu_cores != null && <Detail label="CPU Cores" value={String(node.cpu_cores)} />}
          {node.num_running_queries != null && <Detail label="Running Queries" value={String(node.num_running_queries)} />}
          {node.last_start_time && <Detail label="Last Start" value={formatRelativeTime(node.last_start_time, now)} />}
          {node.version && <Detail label="Version" value={node.version} />}
          {node.err_msg && (
            <div style={{ gridColumn: "1 / -1", color: "#ef4444", fontSize: 12, marginTop: 4, padding: "4px 8px", background: "rgba(239,68,68,0.08)", borderRadius: 4 }}>
              {node.err_msg}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ── Key-value detail row ── */
export function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div style={{ fontSize: 10, color: C.text3, textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 1 }}>{label}</div>
      <div style={{ fontSize: 12, color: C.text1, fontWeight: 500, wordBreak: "break-all" }}>{value}</div>
    </div>
  );
}

/* ── Section header ── */
export function SectionHeader({ title, count }: { title: string; count: number }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 0 6px", borderBottom: `1px solid ${C.border}`, marginBottom: 8 }}>
      <span style={{ fontSize: 13, fontWeight: 700, color: C.text1 }}>{title}</span>
      <span style={{ fontSize: 11, color: C.text3 }}>({count})</span>
    </div>
  );
}
