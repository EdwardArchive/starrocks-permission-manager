/**
 * Cluster summary card + dead-node alerts list — shared by the Cluster Monitor
 * tab and the ClusterDrawer quick glance.
 */
import { shortenNodeName } from "../../utils/nodeNameUtils";
import type { ClusterStatusResponse } from "../../types";
import { C } from "../../utils/colors";
import { StatusDot, UtilBar } from "./NodeCards";
import InlineIcon from "../common/InlineIcon";

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ fontSize: 12, color: C.text2 }}>
      <span style={{ color: C.text3 }}>{label}: </span>
      <strong style={{ color: C.text1 }}>{value}</strong>
    </div>
  );
}

/* ── Compact summary card (drawer quick glance — text rows) ── */
export function ClusterSummary({ data, gridColumns = "1fr 1fr" }: { data: ClusterStatusResponse; gridColumns?: string }) {
  const metrics = data.metrics;
  return (
    <div style={{
      background: C.card, border: `1px solid ${C.borderLight}`, borderRadius: 8,
      padding: 14, marginBottom: 14,
    }}>
      <div style={{ display: "grid", gridTemplateColumns: gridColumns, gap: "8px 16px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <StatusDot alive={metrics.fe_alive === metrics.fe_total} />
          <span style={{ fontSize: 13, color: C.text1 }}>FE <strong>{metrics.fe_alive}/{metrics.fe_total}</strong> alive</span>
        </div>
        {metrics.be_total > 0 && (
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <StatusDot alive={metrics.be_alive === metrics.be_total} />
            <span style={{ fontSize: 13, color: C.text1 }}>BE <strong>{metrics.be_alive}/{metrics.be_total}</strong> alive</span>
          </div>
        )}
        {metrics.cn_total > 0 && (
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <StatusDot alive={metrics.cn_alive === metrics.cn_total} />
            <span style={{ fontSize: 13, color: C.text1 }}>CN <strong>{metrics.cn_alive}/{metrics.cn_total}</strong> alive</span>
          </div>
        )}
        {metrics.total_tablets != null && <Stat label="Tablets" value={metrics.total_tablets.toLocaleString()} />}
        {metrics.total_data_used && <Stat label="Data Used" value={metrics.total_data_used} />}
        {metrics.avg_disk_used_pct != null && (
          <Stat
            label={metrics.be_total > 0 && metrics.cn_total > 0 ? "Avg Disk/Cache" : metrics.be_total > 0 ? "Avg Disk" : "Avg Cache"}
            value={`${metrics.avg_disk_used_pct.toFixed(1)}%`}
          />
        )}
        {metrics.avg_cpu_used_pct != null && <Stat label="Avg CPU" value={`${metrics.avg_cpu_used_pct.toFixed(1)}%`} />}
        {metrics.avg_mem_used_pct != null && <Stat label="Avg Mem" value={`${metrics.avg_mem_used_pct.toFixed(1)}%`} />}
        {metrics.avg_fe_heap_used_pct != null && <Stat label="Avg FE Heap" value={`${metrics.avg_fe_heap_used_pct.toFixed(1)}%`} />}
      </div>
    </div>
  );
}

/* ── One KPI tile: label, big value, optional utilization bar; clickable ── */
function KpiTile({ label, value, pct, status, barVariant, onClick }: {
  label: string; value: string; pct?: number | null; status?: "ok" | "warn" | "bad";
  barVariant?: "pressure" | "info"; onClick?: () => void;
}) {
  const accent = status === "bad" ? "#ef4444" : status === "warn" ? C.warning : C.green;
  return (
    <button
      onClick={onClick}
      disabled={!onClick}
      style={{
        textAlign: "left", border: `1px solid ${C.borderLight}`, borderRadius: 8, background: C.card,
        padding: "10px 12px", cursor: onClick ? "pointer" : "default", fontFamily: "inherit",
        display: "flex", flexDirection: "column", gap: 6, minWidth: 0,
      }}
      onMouseEnter={(e) => { if (onClick) e.currentTarget.style.borderColor = `${C.accent}80`; }}
      onMouseLeave={(e) => { e.currentTarget.style.borderColor = C.borderLight; }}
    >
      <span style={{ fontSize: 10, color: C.text3, textTransform: "uppercase", letterSpacing: "0.04em", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{label}</span>
      <span style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
        {status && <span style={{ width: 8, height: 8, borderRadius: "50%", background: accent, flexShrink: 0 }} />}
        <strong style={{ fontSize: 17, color: C.text1, fontVariantNumeric: "tabular-nums" }}>{value}</strong>
      </span>
      {pct != null && <UtilBar pct={pct} variant={barVariant} />}
    </button>
  );
}

/* ── KPI band (Cluster Monitor tab) — tiles with status colors + jump-to-section ── */
export function ClusterKpiBand({ data, onJump }: {
  data: ClusterStatusResponse;
  onJump?: (target: "frontends" | "backends" | "queries") => void;
}) {
  const m = data.metrics;
  const aliveStatus = (alive: number, total: number) => (alive < total ? "bad" : "ok");
  const pctStatus = (p: number | null | undefined) => (p == null ? undefined : p > 85 ? "bad" : p > 70 ? "warn" : "ok");
  return (
    <div style={{
      display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 10, marginBottom: 14,
    }}>
      <KpiTile label="Frontends" value={`${m.fe_alive}/${m.fe_total}`} status={aliveStatus(m.fe_alive, m.fe_total)} onClick={onJump && (() => onJump("frontends"))} />
      {m.be_total > 0 && (
        <KpiTile label="Backends" value={`${m.be_alive}/${m.be_total}`} status={aliveStatus(m.be_alive, m.be_total)} onClick={onJump && (() => onJump("backends"))} />
      )}
      {m.cn_total > 0 && (
        <KpiTile label="Compute" value={`${m.cn_alive}/${m.cn_total}`} status={aliveStatus(m.cn_alive, m.cn_total)} onClick={onJump && (() => onJump("backends"))} />
      )}
      {m.avg_cpu_used_pct != null && <KpiTile label="Avg CPU" value={`${m.avg_cpu_used_pct.toFixed(1)}%`} pct={m.avg_cpu_used_pct} status={pctStatus(m.avg_cpu_used_pct)} />}
      {m.avg_mem_used_pct != null && <KpiTile label="Avg Memory" value={`${m.avg_mem_used_pct.toFixed(1)}%`} pct={m.avg_mem_used_pct} status={pctStatus(m.avg_mem_used_pct)} />}
      {m.avg_fe_heap_used_pct != null && <KpiTile label="Avg FE Heap" value={`${m.avg_fe_heap_used_pct.toFixed(1)}%`} pct={m.avg_fe_heap_used_pct} status={pctStatus(m.avg_fe_heap_used_pct)} />}
      {m.avg_disk_used_pct != null && (() => {
        // CN-only clusters report data-cache usage; a full cache is normal → info-colored, not an alarm.
        const cacheOnly = m.cn_total > 0 && m.be_total === 0;
        return (
          <KpiTile
            label={m.be_total > 0 && m.cn_total > 0 ? "Avg Disk/Cache" : m.be_total > 0 ? "Avg Disk" : "Avg Cache"}
            value={`${m.avg_disk_used_pct.toFixed(1)}%`}
            pct={m.avg_disk_used_pct}
            status={cacheOnly ? "ok" : pctStatus(m.avg_disk_used_pct)}
            barVariant={cacheOnly ? "info" : "pressure"}
          />
        );
      })()}
      {m.total_tablets != null && <KpiTile label="Tablets" value={m.total_tablets.toLocaleString()} />}
      {m.total_data_used && <KpiTile label="Data Used" value={m.total_data_used} />}
    </div>
  );
}

/* ── Alerts list (dead nodes / error messages) ──
 * onJumpNode (drawer) makes each alert clickable to focus that node card. */
export function ClusterAlerts({ data, onJumpNode }: {
  data: ClusterStatusResponse;
  onJumpNode?: (nodeId: string) => void;
}) {
  if (!data.has_errors) return null;
  const alerts = [
    ...data.frontends.filter((n) => !n.alive || n.err_msg).map((n) => ({ n, id: `fe:${n.name}` })),
    ...data.backends.filter((n) => !n.alive || n.err_msg).map((n) => ({ n, id: `${n.node_type === "compute" ? "cn" : "be"}:${n.name}` })),
  ].map(({ n, id }) => ({ id, name: shortenNodeName(n.name), full: n.name, ip: n.ip, msg: n.err_msg || "Node is DEAD" }));

  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: "#ef4444", marginBottom: 6, display: "flex", alignItems: "center", gap: 6 }}>
        <InlineIcon type="warning" size={14} color="#ef4444" />
        <span>Alerts</span>
        <span style={{ color: C.text3, fontWeight: 400 }}>({alerts.length})</span>
      </div>
      {alerts.map((alert) => (
        <div
          key={`${alert.full}:${alert.ip}`}
          onClick={onJumpNode ? () => onJumpNode(alert.id) : undefined}
          style={{
            display: "flex", alignItems: "center", gap: 8, padding: "6px 10px",
            borderRadius: 4, border: "1px solid rgba(239,68,68,0.3)",
            background: "rgba(239,68,68,0.06)", marginBottom: 4, fontSize: 12,
            cursor: onJumpNode ? "pointer" : "default",
          }}
        >
          <span title={alert.full} style={{ fontWeight: 600, color: "#ef4444" }}>{alert.name}</span>
          <span style={{ color: C.text3 }}>{alert.ip}</span>
          <span style={{ color: C.text2, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{alert.msg}</span>
          {onJumpNode && <span style={{ color: C.accent, flexShrink: 0 }}>→</span>}
        </div>
      ))}
    </div>
  );
}

/* ── Mode / metrics-warning banners ── */
export function ClusterBanners({ data }: { data: ClusterStatusResponse }) {
  return (
    <>
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
    </>
  );
}
