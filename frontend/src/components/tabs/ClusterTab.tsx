/**
 * Cluster Monitor tab — full-width monitoring dashboard: summary band,
 * FE/BE/CN node card grid, and the Running Queries panel (issue #15).
 * The header's ClusterDrawer stays as a quick glance that links here.
 *
 * Node status polls every 30s (refresh=1, bypassing the 60s server cache);
 * polling pauses while the page is hidden.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { useClusterStore } from "../../stores/clusterStore";
import { getClusterStatus } from "../../api/cluster";
import { clockSkewMs, skewedNow } from "../../utils/relativeTime";
import type { ClusterStatusResponse } from "../../types";
import { C } from "../../utils/colors";
import { Loader } from "./inventory-ui";
import { FENodeCard, BENodeCard, SectionHeader } from "../cluster/NodeCards";
import { ClusterSummary, ClusterAlerts, ClusterBanners } from "../cluster/ClusterSummary";
import QueriesPanel from "../cluster/QueriesPanel";
import InlineIcon from "../common/InlineIcon";

const STATUS_POLL_MS = 30_000;

export default function ClusterTab() {
  const { expandedNodes, toggleNodeExpansion } = useClusterStore(
    useShallow((s) => ({
      expandedNodes: s.expandedNodes,
      toggleNodeExpansion: s.toggleNodeExpansion,
    })),
  );
  const [data, setData] = useState<ClusterStatusResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const fetchData = useCallback((refresh = false) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    getClusterStatus(controller.signal, refresh, /* quiet */ true)
      .then((res) => {
        setData(res);
        setError(null);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setError(err instanceof Error ? err.message : "Unknown error");
        setLoading(false);
      });
  }, []);

  useEffect(() => {
    fetchData();
    const interval = setInterval(() => {
      if (document.hidden) return;
      fetchData(true);
    }, STATUS_POLL_MS);
    return () => {
      clearInterval(interval);
      abortRef.current?.abort();
    };
  }, [fetchData]);

  const now = skewedNow(clockSkewMs(data?.server_now));
  const frontends = data?.frontends ?? [];
  const backends = data?.backends ?? [];

  return (
    <div data-testid="cluster-tab" style={{ flex: 1, overflowY: "auto", background: C.bg, padding: "16px 20px" }}>
      {/* Title row */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
        <span style={{ fontSize: 15, fontWeight: 700, color: C.text1, flex: 1 }}>Cluster Monitor</span>
        <span style={{ fontSize: 11, color: C.text3 }}>auto-refresh 30s</span>
        <button
          onClick={() => fetchData(true)}
          disabled={loading}
          title="Refresh now"
          data-testid="cluster-tab-refresh-btn"
          style={{
            width: 28, height: 28, border: `1px solid ${C.borderLight}`, borderRadius: 6,
            background: "transparent", color: C.text2, cursor: loading ? "not-allowed" : "pointer",
            display: "flex", alignItems: "center", justifyContent: "center",
            opacity: loading ? 0.5 : 1, fontFamily: "inherit",
          }}
          onMouseEnter={(e) => { if (!loading) e.currentTarget.style.color = C.accent; }}
          onMouseLeave={(e) => { e.currentTarget.style.color = C.text2; }}
        >
          <InlineIcon type="refresh" size={14} />
        </button>
      </div>

      {loading && <Loader />}

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

      {!loading && data && (
        <>
          <ClusterBanners data={data} />
          <ClusterSummary data={data} gridColumns="repeat(auto-fit, minmax(150px, 1fr))" />
          <ClusterAlerts data={data} />

          {/* ── Node cards — responsive grid ── */}
          <SectionHeader title="Frontend Nodes" count={frontends.length} />
          {frontends.length === 0 ? (
            <div style={{ fontSize: 12, color: C.text3, padding: "8px 0" }}>No nodes reported</div>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(360px, 1fr))", gap: "0 12px" }}>
              {frontends.map((node) => {
                const id = `fe:${node.name}`;
                return (
                  <FENodeCard
                    key={id}
                    node={node}
                    expanded={expandedNodes.has(id)}
                    onToggle={() => toggleNodeExpansion(id)}
                    now={now}
                  />
                );
              })}
            </div>
          )}

          <div style={{ marginTop: 8 }}>
            <SectionHeader
              title={
                data.metrics.be_total > 0 && data.metrics.cn_total > 0
                  ? "Backend & Compute Nodes"
                  : data.metrics.cn_total > 0
                    ? "Compute Nodes"
                    : "Backend Nodes"
              }
              count={backends.length}
            />
            {backends.length === 0 ? (
              <div style={{ fontSize: 12, color: C.text3, padding: "8px 0" }}>No nodes reported</div>
            ) : (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(360px, 1fr))", gap: "0 12px" }}>
                {backends.map((node) => {
                  const id = `${node.node_type === "compute" ? "cn" : "be"}:${node.name}`;
                  return (
                    <BENodeCard
                      key={id}
                      node={node}
                      expanded={expandedNodes.has(id)}
                      onToggle={() => toggleNodeExpansion(id)}
                      now={now}
                    />
                  );
                })}
              </div>
            )}
          </div>

          {/* ── Running Queries (issue #15) ── */}
          <div style={{ marginTop: 16 }}>
            <QueriesPanel />
          </div>
        </>
      )}
    </div>
  );
}
