/**
 * Cluster Monitor tab — full-width dashboard: KPI band, FE/BE/CN node card
 * grid (dead nodes first, with session-accumulated CPU/heap sparklines), and
 * the queries panel (running + history). The header ClusterDrawer is a quick
 * glance that links/jumps here.
 *
 * Status polls every 30s (refresh=1, bypassing the 60s server cache); polling
 * pauses while the page is hidden.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { useClusterStore } from "../../stores/clusterStore";
import { getClusterStatus } from "../../api/cluster";
import { usePolling } from "../../hooks/usePolling";
import { clockSkewMs, skewedNow } from "../../utils/relativeTime";
import type { ClusterStatusResponse, FENodeInfo, BENodeInfo } from "../../types";
import { C } from "../../utils/colors";
import { Loader } from "./inventory-ui";
import { FENodeCard, BENodeCard, SectionHeader } from "../cluster/NodeCards";
import { ClusterKpiBand, ClusterAlerts, ClusterBanners } from "../cluster/ClusterSummary";
import QueriesPanel from "../cluster/QueriesPanel";
import InlineIcon from "../common/InlineIcon";

const STATUS_POLL_MS = 30_000;
const SPARK_MAX = 30; // points kept per node metric (session only)

// dead/error nodes float to the top so problems are seen first
function deadFirst<T extends { alive: boolean; err_msg?: string | null }>(nodes: T[]): T[] {
  return [...nodes].sort((a, b) => {
    const ab = !a.alive || !!a.err_msg ? 0 : 1;
    const bb = !b.alive || !!b.err_msg ? 0 : 1;
    return ab - bb;
  });
}

export default function ClusterTab() {
  const { expandedNodes, toggleNodeExpansion, focus, requestFocus, clearFocus } = useClusterStore(
    useShallow((s) => ({
      expandedNodes: s.expandedNodes,
      toggleNodeExpansion: s.toggleNodeExpansion,
      focus: s.focus,
      requestFocus: s.requestFocus,
      clearFocus: s.clearFocus,
    })),
  );
  const [data, setData] = useState<ClusterStatusResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Session-accumulated metric history for sparklines: nodeName → number[]
  const [sparks, setSparks] = useState<{ heap: Map<string, number[]>; cpu: Map<string, number[]>; mem: Map<string, number[]> }>(
    () => ({ heap: new Map(), cpu: new Map(), mem: new Map() }),
  );

  // Scroll anchors + transient highlight
  const feRef = useRef<HTMLDivElement>(null);
  const beRef = useRef<HTMLDivElement>(null);
  const queriesRef = useRef<HTMLDivElement>(null);
  const [highlightId, setHighlightId] = useState<string | null>(null);

  const fetchData = useCallback((refresh = false) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    getClusterStatus(controller.signal, refresh, /* quiet */ true)
      .then((res) => {
        setData(res);
        setError(null);
        setLoading(false);
        // append the latest sample to each node's history (capped)
        setSparks((prev) => {
          const push = (map: Map<string, number[]>, key: string, val: number | null | undefined) => {
            if (val == null) return map;
            const arr = [...(map.get(key) ?? []), val];
            if (arr.length > SPARK_MAX) arr.shift();
            map.set(key, arr);
            return map;
          };
          const heap = new Map(prev.heap);
          const cpu = new Map(prev.cpu);
          const mem = new Map(prev.mem);
          res.frontends.forEach((n) => push(heap, n.name, n.jvm_heap_used_pct));
          res.backends.forEach((n) => { push(cpu, n.name, n.cpu_used_pct); push(mem, n.name, n.mem_used_pct); });
          return { heap, cpu, mem };
        });
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setError(err instanceof Error ? err.message : "Unknown error");
        setLoading(false);
      });
  }, []);

  // Initial fetch on mount (rides the server cache); abort in-flight on unmount
  useEffect(() => {
    fetchData();
    return () => abortRef.current?.abort();
  }, [fetchData]);
  usePolling(() => fetchData(true), STATUS_POLL_MS);

  // Respond to a focus request from the drawer: scroll + briefly highlight
  useEffect(() => {
    if (!focus || !data) return;
    let el: HTMLElement | null = null;
    if (focus.kind === "section") {
      el = focus.id === "frontends" ? feRef.current : focus.id === "backends" ? beRef.current : queriesRef.current;
    } else {
      el = document.querySelector(`[data-node-id="${focus.id}"]`);
      // eslint-disable-next-line react-hooks/set-state-in-effect -- responding to a store-driven focus request (external event), not deriving render state
      setHighlightId(focus.id);
      setTimeout(() => setHighlightId(null), 1600);
    }
    el?.scrollIntoView({ behavior: "smooth", block: "start" });
    clearFocus();
  }, [focus, data, clearFocus]);

  const now = skewedNow(clockSkewMs(data?.server_now));
  const frontends = data ? deadFirst(data.frontends) : [];
  const backends = data ? deadFirst(data.backends) : [];
  const totalCores = (data?.backends ?? []).reduce(
    (sum, b) => sum + (b.alive && b.cpu_cores != null ? b.cpu_cores : 0),
    0,
  ) || null;

  const onJump = (target: "frontends" | "backends" | "queries") => requestFocus({ kind: "section", id: target });

  const cardWrap = (id: string, child: React.ReactNode) => (
    <div
      key={id}
      data-node-id={id}
      style={{
        borderRadius: 8,
        outline: highlightId === id ? `2px solid ${C.accent}` : "2px solid transparent",
        transition: "outline-color 0.4s",
      }}
    >
      {child}
    </div>
  );

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
        <div style={{ padding: 12, borderRadius: 6, border: `1px solid ${C.borderLight}`, background: "rgba(239,68,68,0.06)", fontSize: 12, color: C.text2, textAlign: "center" }}>
          Failed to load cluster status.{" "}
          <button onClick={() => fetchData()} style={{ background: "none", border: "none", color: C.accent, cursor: "pointer", fontSize: 12, padding: 0, fontFamily: "inherit" }}>Retry</button>
        </div>
      )}

      {!loading && data && (
        <>
          <ClusterBanners data={data} />
          <ClusterKpiBand data={data} onJump={onJump} />
          <ClusterAlerts data={data} />

          {/* ── Frontend nodes ── */}
          <div ref={feRef} style={{ scrollMarginTop: 12 }}>
            <SectionHeader title="Frontend Nodes" count={frontends.length} />
            {frontends.length === 0 ? (
              <div style={{ fontSize: 12, color: C.text3, padding: "8px 0" }}>No nodes reported</div>
            ) : (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(360px, 1fr))", gap: "0 12px" }}>
                {frontends.map((node: FENodeInfo) => {
                  const id = `fe:${node.name}`;
                  return cardWrap(id, (
                    <FENodeCard
                      node={node}
                      expanded={expandedNodes.has(id)}
                      onToggle={() => toggleNodeExpansion(id)}
                      now={now}
                      heapHistory={sparks.heap.get(node.name)}
                    />
                  ));
                })}
              </div>
            )}
          </div>

          {/* ── Backend / Compute nodes ── */}
          <div ref={beRef} style={{ marginTop: 8, scrollMarginTop: 12 }}>
            <SectionHeader
              title={
                data.metrics.be_total > 0 && data.metrics.cn_total > 0
                  ? "Backend & Compute Nodes"
                  : data.metrics.cn_total > 0 ? "Compute Nodes" : "Backend Nodes"
              }
              count={backends.length}
            />
            {backends.length === 0 ? (
              <div style={{ fontSize: 12, color: C.text3, padding: "8px 0" }}>No nodes reported</div>
            ) : (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(360px, 1fr))", gap: "0 12px" }}>
                {backends.map((node: BENodeInfo) => {
                  const id = `${node.node_type === "compute" ? "cn" : "be"}:${node.name}`;
                  return cardWrap(id, (
                    <BENodeCard
                      node={node}
                      expanded={expandedNodes.has(id)}
                      onToggle={() => toggleNodeExpansion(id)}
                      now={now}
                      cpuHistory={sparks.cpu.get(node.name)}
                      memHistory={sparks.mem.get(node.name)}
                    />
                  ));
                })}
              </div>
            )}
          </div>

          {/* ── Queries (running + history) ── */}
          <div ref={queriesRef} style={{ marginTop: 16, scrollMarginTop: 12 }}>
            <QueriesPanel totalCores={totalCores} />
          </div>
        </>
      )}
    </div>
  );
}
