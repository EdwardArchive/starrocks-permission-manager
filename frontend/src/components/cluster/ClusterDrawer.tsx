import { useEffect, useState, useCallback, useRef } from "react";
import { useClusterStore } from "../../stores/clusterStore";
import { getClusterStatus } from "../../api/cluster";
import { formatRelativeTime } from "../../utils/relativeTime";
import { shortenNodeName } from "../../utils/nodeNameUtils";
import type { ClusterStatusResponse, FENodeInfo, BENodeInfo } from "../../types";
import { C } from "../../utils/colors";
import { Badge, Loader } from "../tabs/inventory-ui";
import InlineIcon from "../common/InlineIcon";

/* ── Utilization progress bar (0–100%) ── */
function UtilBar({ pct }: { pct: number }) {
  const color = pct > 85 ? "#ef4444" : pct > 70 ? C.warning : C.green;
  return (
    <div style={{ width: "100%", height: 6, background: C.border, borderRadius: 3, overflow: "hidden", marginTop: 4 }}>
      <div style={{ width: `${Math.min(pct, 100)}%`, height: "100%", background: color, borderRadius: 3, transition: "width 0.3s" }} />
    </div>
  );
}

/* ── Labelled utilization row (metric name + bar) ── */
function MetricRow({ label, pct, extra }: { label: string; pct: number; extra?: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 6 }}>
      <div style={{ fontSize: 11, color: C.text2, display: "flex", justifyContent: "space-between" }}>
        <span>{label} <span style={{ color: C.text3 }}>{extra}</span></span>
        <strong style={{ color: C.text1 }}>{pct.toFixed(1)}%</strong>
      </div>
      <UtilBar pct={pct} />
    </div>
  );
}


/* ── Status dot ── */
// Visual optical-center fix: align-items:center lines up box centers, but text's
// perceived weight sits slightly below its box center, so the dot needs a small
// downward nudge (0.5px) to *look* centered next to numbers/uppercase labels.
function StatusDot({ alive }: { alive: boolean }) {
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

/* ── FE Node card — resource metrics come from /metrics endpoint ── */
function FENodeCard({ node, expanded, onToggle }: { node: FENodeInfo; expanded: boolean; onToggle: () => void }) {
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
            <MetricRow label="Heap" pct={node.jvm_heap_used_pct ?? 0} />
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
          {node.start_time && <Detail label="Start Time" value={formatRelativeTime(node.start_time)} />}
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
function BENodeCard({ node, expanded, onToggle }: { node: BENodeInfo; expanded: boolean; onToggle: () => void }) {
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
        {/* Disk (BE: persistent) / Disk Cache (CN: local cache) */}
        {diskLabel != null && node.used_pct != null && (
          <MetricRow
            label={isCompute ? "Disk Cache" : "Disk"}
            pct={diskPct}
            extra={diskLabel}
          />
        )}

        {/* CPU (CN only — SHOW BACKENDS does not report CPU %) */}
        {isCompute && node.cpu_used_pct != null && (
          <MetricRow
            label="CPU"
            pct={node.cpu_used_pct}
            extra={node.cpu_cores != null ? `${node.cpu_cores} cores` : undefined}
          />
        )}

        {/* Memory (both BE and CN) */}
        {node.mem_used_pct != null && (
          <MetricRow
            label="Memory"
            pct={node.mem_used_pct}
            extra={node.mem_limit ? `of ${node.mem_limit}` : undefined}
          />
        )}
      </div>

      {/* Expanded details — identity / activity only; no ports */}
      {expanded && (
        <div style={{ padding: "8px 12px 10px", borderTop: `1px solid ${C.border}`, display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px 16px" }}>
          {isCompute && node.warehouse && <Detail label="Warehouse" value={node.warehouse} />}
          {!isCompute && node.cpu_cores != null && <Detail label="CPU Cores" value={String(node.cpu_cores)} />}
          {node.num_running_queries != null && <Detail label="Running Queries" value={String(node.num_running_queries)} />}
          {node.last_start_time && <Detail label="Last Start" value={formatRelativeTime(node.last_start_time)} />}
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
function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div style={{ fontSize: 10, color: C.text3, textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 1 }}>{label}</div>
      <div style={{ fontSize: 12, color: C.text1, fontWeight: 500, wordBreak: "break-all" }}>{value}</div>
    </div>
  );
}

/* ── Section header ── */
function SectionHeader({ title, count }: { title: string; count: number }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 0 6px", borderBottom: `1px solid ${C.border}`, marginBottom: 8 }}>
      <span style={{ fontSize: 13, fontWeight: 700, color: C.text1 }}>{title}</span>
      <span style={{ fontSize: 11, color: C.text3 }}>({count})</span>
    </div>
  );
}

/* ── Main ClusterDrawer ── */
export default function ClusterDrawer() {
  const { isOpen, closeDrawer, expandedNodes, toggleNodeExpansion } = useClusterStore();
  const [data, setData] = useState<ClusterStatusResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const fetchData = useCallback((refresh = false) => {
    // Cancel any in-flight request
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setLoading(true);
    setError(null);

    getClusterStatus(controller.signal, refresh)
      .then((res) => {
        setData(res);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        const msg = err instanceof Error ? err.message : "Unknown error";
        setError(msg);
        setLoading(false);
      });
  }, []);

  // Fetch on open
  useEffect(() => {
    if (isOpen) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- fetchData's sync setState(true/null) is intentional: drawer must enter loading state on open
      fetchData();
    } else {
      // Cancel any in-flight request when closed
      abortRef.current?.abort();
      abortRef.current = null;
    }
    return () => {
      abortRef.current?.abort();
    };
  }, [isOpen, fetchData]);

  // ESC key handler
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeDrawer();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, closeDrawer]);

  const metrics = data?.metrics;
  const frontends = data?.frontends ?? [];
  const backends = data?.backends ?? [];

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={closeDrawer}
        style={{
          position: "fixed", inset: 0, background: "rgba(0,0,0,0.3)",
          zIndex: 49,
          opacity: isOpen ? 1 : 0,
          pointerEvents: isOpen ? "auto" : "none",
          transition: "opacity 200ms",
        }}
      />

      {/* Drawer panel */}
      <div
        style={{
          position: "fixed", top: 0, right: 0, bottom: 0,
          width: 440, zIndex: 50,
          background: C.bg,
          borderLeft: `1px solid ${C.borderLight}`,
          display: "flex", flexDirection: "column",
          transform: isOpen ? "translateX(0)" : "translateX(100%)",
          transition: "transform 200ms ease",
          overflowY: "auto",
        }}
      >
        {/* ── Header bar ── */}
        <div style={{
          display: "flex", alignItems: "center", gap: 8, padding: "0 16px",
          height: 56, borderBottom: `1px solid ${C.borderLight}`, flexShrink: 0,
          background: C.card,
        }}>
          <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke={C.accent} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="4" width="18" height="6" rx="1"/>
            <rect x="3" y="14" width="18" height="6" rx="1"/>
            <line x1="6" y1="7" x2="6.01" y2="7"/>
            <line x1="6" y1="17" x2="6.01" y2="17"/>
          </svg>
          <span style={{ fontSize: 15, fontWeight: 700, color: C.text1, flex: 1 }}>Cluster Status</span>

          {/* Refresh button */}
          <button
            onClick={() => fetchData(true)}
            disabled={loading}
            title="Refresh"
            style={{
              width: 32, height: 32, border: `1px solid ${C.borderLight}`, borderRadius: 6,
              background: "transparent", color: C.text2, cursor: loading ? "not-allowed" : "pointer",
              display: "flex", alignItems: "center", justifyContent: "center", fontSize: 15,
              opacity: loading ? 0.5 : 1, fontFamily: "inherit",
            }}
            onMouseEnter={(e) => { if (!loading) e.currentTarget.style.color = C.accent; }}
            onMouseLeave={(e) => { e.currentTarget.style.color = C.text2; }}
          >
            <InlineIcon type="refresh" size={16} />
          </button>

          {/* Close button */}
          <button
            onClick={closeDrawer}
            title="Close"
            style={{
              width: 32, height: 32, border: `1px solid ${C.borderLight}`, borderRadius: 6,
              background: "transparent", color: C.text2, cursor: "pointer",
              display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18,
              fontFamily: "inherit",
            }}
            onMouseEnter={(e) => { e.currentTarget.style.color = "#ef4444"; e.currentTarget.style.borderColor = "#ef4444"; }}
            onMouseLeave={(e) => { e.currentTarget.style.color = C.text2; e.currentTarget.style.borderColor = C.borderLight; }}
          >
            <InlineIcon type="close" size={16} />
          </button>
        </div>

        {/* ── Scrollable body ── */}
        <div style={{ flex: 1, overflowY: "auto", padding: 16 }}>

          {/* Loading state */}
          {loading && <Loader />}

          {/* Error state (network / 5xx) */}
          {!loading && error && (
            <div style={{
              padding: 12, borderRadius: 6, border: `1px solid ${C.borderLight}`,
              background: "rgba(239,68,68,0.06)", fontSize: 12, color: C.text2, textAlign: "center",
            }}>
              Failed to load cluster status.{" "}
              <button
                onClick={() => fetchData()}
                style={{ background: "none", border: "none", color: C.accent, cursor: "pointer", fontSize: 12, padding: 0, fontFamily: "inherit" }}
              >
                Retry
              </button>
            </div>
          )}

          {/* Data content */}
          {!loading && data && (
            <>
              {/* Limited-mode banner (cluster_admin not granted) */}
              {data.mode === "limited" && (
                <div style={{
                  padding: 10, marginBottom: 12, borderRadius: 6,
                  border: `1px solid ${C.accent}40`,
                  background: `${C.accent}12`,
                  fontSize: 12, color: C.text1, display: "flex", gap: 8, alignItems: "flex-start",
                }}>
                  <span style={{ display: "inline-flex", paddingTop: 1 }}><InlineIcon type="info" size={14} /></span>
                  <span>
                    <strong>Limited view</strong> — showing only the FE you're connected to.
                    Full cluster inventory requires the <code style={{ color: C.accent }}>cluster_admin</code> role.
                  </span>
                </div>
              )}

              {/* Metrics warning banner (all /metrics probes failed) */}
              {data.metrics_warning && (
                <div style={{
                  padding: 10, marginBottom: 12, borderRadius: 6,
                  border: `1px solid ${C.warning}40`,
                  background: `${C.warning}12`,
                  fontSize: 12, color: C.text1, display: "flex", gap: 8, alignItems: "flex-start",
                }}>
                  <span style={{ display: "inline-flex", paddingTop: 1 }}><InlineIcon type="warning" size={14} /></span>
                  <span>{data.metrics_warning}</span>
                </div>
              )}

              {/* ── Summary card ── */}
              <div style={{
                background: C.card, border: `1px solid ${C.borderLight}`, borderRadius: 8,
                padding: 14, marginBottom: 14,
              }}>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px 16px" }}>
                  {/* FE alive */}
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <StatusDot alive={metrics!.fe_alive === metrics!.fe_total} />
                    <span style={{ fontSize: 13, color: C.text1 }}>
                      FE <strong>{metrics!.fe_alive}/{metrics!.fe_total}</strong> alive
                    </span>
                  </div>
                  {/* BE alive (only if any BE exists) */}
                  {metrics!.be_total > 0 && (
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <StatusDot alive={metrics!.be_alive === metrics!.be_total} />
                      <span style={{ fontSize: 13, color: C.text1 }}>
                        BE <strong>{metrics!.be_alive}/{metrics!.be_total}</strong> alive
                      </span>
                    </div>
                  )}
                  {/* CN alive (only if any CN exists) */}
                  {metrics!.cn_total > 0 && (
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <StatusDot alive={metrics!.cn_alive === metrics!.cn_total} />
                      <span style={{ fontSize: 13, color: C.text1 }}>
                        CN <strong>{metrics!.cn_alive}/{metrics!.cn_total}</strong> alive
                      </span>
                    </div>
                  )}
                  {/* Tablets */}
                  {metrics!.total_tablets != null && (
                    <div style={{ fontSize: 12, color: C.text2 }}>
                      <span style={{ color: C.text3 }}>Tablets: </span>
                      <strong style={{ color: C.text1 }}>{metrics!.total_tablets.toLocaleString()}</strong>
                    </div>
                  )}
                  {/* Data used (BE only) */}
                  {metrics!.total_data_used && (
                    <div style={{ fontSize: 12, color: C.text2 }}>
                      <span style={{ color: C.text3 }}>Data Used: </span>
                      <strong style={{ color: C.text1 }}>{metrics!.total_data_used}</strong>
                    </div>
                  )}
                  {/* Avg Disk/Cache — label depends on cluster shape */}
                  {metrics!.avg_disk_used_pct != null && (
                    <div style={{ fontSize: 12, color: C.text2 }}>
                      <span style={{ color: C.text3 }}>
                        {metrics!.be_total > 0 && metrics!.cn_total > 0
                          ? "Avg Disk/Cache: "
                          : metrics!.be_total > 0
                            ? "Avg Disk: "
                            : "Avg Cache: "}
                      </span>
                      <strong style={{ color: C.text1 }}>{metrics!.avg_disk_used_pct.toFixed(1)}%</strong>
                    </div>
                  )}
                  {/* Avg CPU (CN only) */}
                  {metrics!.avg_cpu_used_pct != null && (
                    <div style={{ fontSize: 12, color: C.text2 }}>
                      <span style={{ color: C.text3 }}>Avg CPU: </span>
                      <strong style={{ color: C.text1 }}>{metrics!.avg_cpu_used_pct.toFixed(1)}%</strong>
                    </div>
                  )}
                  {/* Avg Mem */}
                  {metrics!.avg_mem_used_pct != null && (
                    <div style={{ fontSize: 12, color: C.text2 }}>
                      <span style={{ color: C.text3 }}>Avg Mem: </span>
                      <strong style={{ color: C.text1 }}>{metrics!.avg_mem_used_pct.toFixed(1)}%</strong>
                    </div>
                  )}
                  {/* Avg FE Heap (from /metrics) */}
                  {metrics!.avg_fe_heap_used_pct != null && (
                    <div style={{ fontSize: 12, color: C.text2 }}>
                      <span style={{ color: C.text3 }}>Avg FE Heap: </span>
                      <strong style={{ color: C.text1 }}>{metrics!.avg_fe_heap_used_pct.toFixed(1)}%</strong>
                    </div>
                  )}
                </div>
              </div>

              {/* ── Alerts section ── */}
              {data.has_errors && (
                <div style={{ marginBottom: 14 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: "#ef4444", marginBottom: 6, display: "flex", alignItems: "center", gap: 6 }}>
                    <InlineIcon type="warning" size={14} color="#ef4444" />
                    <span>Alerts</span>
                    <span style={{ color: C.text3, fontWeight: 400 }}>
                      ({[...frontends, ...backends].filter((n) => !n.alive || n.err_msg).length})
                    </span>
                  </div>
                  {[
                    ...frontends.filter((n) => !n.alive || n.err_msg).map((n) => ({ name: shortenNodeName(n.name), full: n.name, ip: n.ip, msg: n.err_msg || "Node is DEAD" })),
                    ...backends.filter((n) => !n.alive || n.err_msg).map((n) => ({ name: shortenNodeName(n.name), full: n.name, ip: n.ip, msg: n.err_msg || "Node is DEAD" })),
                  ].map((alert) => (
                    <div key={`${alert.full}:${alert.ip}`} style={{
                      display: "flex", alignItems: "center", gap: 8, padding: "6px 10px",
                      borderRadius: 4, border: "1px solid rgba(239,68,68,0.3)",
                      background: "rgba(239,68,68,0.06)", marginBottom: 4, fontSize: 12,
                    }}>
                      <span title={alert.full} style={{ fontWeight: 600, color: "#ef4444" }}>{alert.name}</span>
                      <span style={{ color: C.text3 }}>{alert.ip}</span>
                      <span style={{ color: C.text2, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{alert.msg}</span>
                    </div>
                  ))}
                </div>
              )}

              {/* ── Frontend Nodes ── */}
              <SectionHeader title="Frontend Nodes" count={frontends.length} />
              {frontends.length === 0 ? (
                <div style={{ fontSize: 12, color: C.text3, padding: "8px 0" }}>No nodes reported</div>
              ) : (
                frontends.map((node) => {
                  const id = `fe:${node.name}`;
                  return (
                    <FENodeCard
                      key={id}
                      node={node}
                      expanded={expandedNodes.has(id)}
                      onToggle={() => toggleNodeExpansion(id)}
                    />
                  );
                })
              )}

              {/* ── Backend / Compute Nodes ── */}
              <div style={{ marginTop: 8 }}>
                <SectionHeader
                  title={
                    metrics!.be_total > 0 && metrics!.cn_total > 0
                      ? "Backend & Compute Nodes"
                      : metrics!.cn_total > 0
                        ? "Compute Nodes"
                        : "Backend Nodes"
                  }
                  count={backends.length}
                />
                {backends.length === 0 ? (
                  <div style={{ fontSize: 12, color: C.text3, padding: "8px 0" }}>No nodes reported</div>
                ) : (
                  backends.map((node) => {
                    const id = `${node.node_type === "compute" ? "cn" : "be"}:${node.name}`;
                    return (
                      <BENodeCard
                        key={id}
                        node={node}
                        expanded={expandedNodes.has(id)}
                        onToggle={() => toggleNodeExpansion(id)}
                      />
                    );
                  })
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </>
  );
}
