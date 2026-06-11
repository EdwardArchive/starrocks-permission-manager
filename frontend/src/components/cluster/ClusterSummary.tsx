/**
 * Cluster summary card + dead-node alerts list — shared by the Cluster Monitor
 * tab and the ClusterDrawer quick glance.
 */
import { shortenNodeName } from "../../utils/nodeNameUtils";
import type { ClusterStatusResponse } from "../../types";
import { C } from "../../utils/colors";
import { StatusDot } from "./NodeCards";
import InlineIcon from "../common/InlineIcon";

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ fontSize: 12, color: C.text2 }}>
      <span style={{ color: C.text3 }}>{label}: </span>
      <strong style={{ color: C.text1 }}>{value}</strong>
    </div>
  );
}

/* ── Summary card (alive counts + aggregate metrics) ── */
export function ClusterSummary({ data, gridColumns = "1fr 1fr" }: { data: ClusterStatusResponse; gridColumns?: string }) {
  const metrics = data.metrics;
  return (
    <div style={{
      background: C.card, border: `1px solid ${C.borderLight}`, borderRadius: 8,
      padding: 14, marginBottom: 14,
    }}>
      <div style={{ display: "grid", gridTemplateColumns: gridColumns, gap: "8px 16px" }}>
        {/* FE alive */}
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <StatusDot alive={metrics.fe_alive === metrics.fe_total} />
          <span style={{ fontSize: 13, color: C.text1 }}>
            FE <strong>{metrics.fe_alive}/{metrics.fe_total}</strong> alive
          </span>
        </div>
        {/* BE alive (only if any BE exists) */}
        {metrics.be_total > 0 && (
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <StatusDot alive={metrics.be_alive === metrics.be_total} />
            <span style={{ fontSize: 13, color: C.text1 }}>
              BE <strong>{metrics.be_alive}/{metrics.be_total}</strong> alive
            </span>
          </div>
        )}
        {/* CN alive (only if any CN exists) */}
        {metrics.cn_total > 0 && (
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <StatusDot alive={metrics.cn_alive === metrics.cn_total} />
            <span style={{ fontSize: 13, color: C.text1 }}>
              CN <strong>{metrics.cn_alive}/{metrics.cn_total}</strong> alive
            </span>
          </div>
        )}
        {metrics.total_tablets != null && <Stat label="Tablets" value={metrics.total_tablets.toLocaleString()} />}
        {metrics.total_data_used && <Stat label="Data Used" value={metrics.total_data_used} />}
        {metrics.avg_disk_used_pct != null && (
          <Stat
            label={
              metrics.be_total > 0 && metrics.cn_total > 0
                ? "Avg Disk/Cache"
                : metrics.be_total > 0
                  ? "Avg Disk"
                  : "Avg Cache"
            }
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

/* ── Alerts list (dead nodes / error messages) ── */
export function ClusterAlerts({ data }: { data: ClusterStatusResponse }) {
  if (!data.has_errors) return null;
  const alerts = [
    ...data.frontends.filter((n) => !n.alive || n.err_msg),
    ...data.backends.filter((n) => !n.alive || n.err_msg),
  ].map((n) => ({ name: shortenNodeName(n.name), full: n.name, ip: n.ip, msg: n.err_msg || "Node is DEAD" }));

  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: "#ef4444", marginBottom: 6, display: "flex", alignItems: "center", gap: 6 }}>
        <InlineIcon type="warning" size={14} color="#ef4444" />
        <span>Alerts</span>
        <span style={{ color: C.text3, fontWeight: 400 }}>({alerts.length})</span>
      </div>
      {alerts.map((alert) => (
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
