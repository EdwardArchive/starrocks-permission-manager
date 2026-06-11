/**
 * Cluster status quick glance — right-side drawer opened from the header icon.
 * Shows gauge KPIs + alerts + a top-running-queries preview; the full
 * dashboard (node cards + queries) lives in the Cluster Monitor tab, and every
 * element here jumps straight to the matching section/node there.
 *
 * Auto-refreshes every 15s while open (paused when the page is hidden).
 */
import { useEffect, useState, useCallback, useRef } from "react";
import { useShallow } from "zustand/react/shallow";
import { useClusterStore, type ClusterFocus } from "../../stores/clusterStore";
import { useDagStore } from "../../stores/dagStore";
import { getClusterStatus, getClusterQueries } from "../../api/cluster";
import { fmtCpuShare } from "../../utils/queryFormat";
import type { ClusterStatusResponse, RunningQueryInfo } from "../../types";
import { C } from "../../utils/colors";
import { Loader } from "../tabs/inventory-ui";
import InlineIcon from "../common/InlineIcon";
import { ClusterKpiBand, ClusterAlerts, ClusterBanners } from "./ClusterSummary";

const DRAWER_POLL_MS = 15_000;
const PREVIEW_COUNT = 3;

export default function ClusterDrawer() {
  const { isOpen, closeDrawer, requestFocus } = useClusterStore(
    useShallow((s) => ({
      isOpen: s.isOpen,
      closeDrawer: s.closeDrawer,
      requestFocus: s.requestFocus,
    })),
  );
  const setActiveTab = useDagStore((s) => s.setActiveTab);
  const [data, setData] = useState<ClusterStatusResponse | null>(null);
  const [queries, setQueries] = useState<RunningQueryInfo[] | null>(null);
  const [totalCores, setTotalCores] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const qAbortRef = useRef<AbortController | null>(null);

  const fetchData = useCallback((refresh = false, withSpinner = true) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    if (withSpinner) { setLoading(true); setError(null); }

    getClusterStatus(controller.signal, refresh, /* quiet */ true)
      .then((res) => {
        setData(res);
        setTotalCores(res.backends.reduce((s, b) => s + (b.alive && b.cpu_cores != null ? b.cpu_cores : 0), 0) || null);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setError(err instanceof Error ? err.message : "Unknown error");
        setLoading(false);
      });

    // running-queries preview — best effort, quiet (403 → just hide)
    qAbortRef.current?.abort();
    const qc = new AbortController();
    qAbortRef.current = qc;
    getClusterQueries(qc.signal, refresh)
      .then((res) => setQueries(res.queries))
      .catch(() => setQueries(null));
  }, []);

  // Fetch on open + 15s auto-refresh while open and visible
  useEffect(() => {
    if (!isOpen) {
      abortRef.current?.abort();
      qAbortRef.current?.abort();
      return;
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional: enter loading on open
    fetchData();
    const id = setInterval(() => { if (!document.hidden) fetchData(true, /* withSpinner */ false); }, DRAWER_POLL_MS);
    return () => { clearInterval(id); abortRef.current?.abort(); qAbortRef.current?.abort(); };
  }, [isOpen, fetchData]);

  // ESC closes
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => { if (e.key === "Escape") closeDrawer(); };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, closeDrawer]);

  const openClusterTab = () => { setActiveTab("cluster"); closeDrawer(); };

  // Jump to a section/node in the Cluster Monitor tab, then focus it there.
  const jumpTo = (f: Omit<ClusterFocus, "nonce">) => {
    setActiveTab("cluster");
    requestFocus(f);
    closeDrawer();
  };

  const topQueries = (queries ?? [])
    .filter((q) => q.exec_time_ms != null)
    .sort((a, b) => (b.exec_time_ms ?? 0) - (a.exec_time_ms ?? 0))
    .slice(0, PREVIEW_COUNT);

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

          {/* Data content — gauges + alerts + query preview, all jump to the tab */}
          {!loading && data && (
            <>
              <ClusterBanners data={data} />
              <ClusterKpiBand data={data} onJump={(target) => jumpTo({ kind: "section", id: target })} />
              <ClusterAlerts data={data} onJumpNode={(id) => jumpTo({ kind: "node", id })} />

              {/* Running queries preview */}
              <div style={{ marginBottom: 14 }}>
                <button
                  onClick={() => jumpTo({ kind: "section", id: "queries" })}
                  data-testid="drawer-queries-preview"
                  style={{
                    width: "100%", textAlign: "left", background: "transparent", border: "none",
                    padding: 0, cursor: "pointer", fontFamily: "inherit",
                    display: "flex", alignItems: "center", gap: 8, marginBottom: 8,
                  }}
                >
                  <span style={{ fontSize: 13, fontWeight: 700, color: C.text1 }}>Running Queries</span>
                  {queries != null && <span style={{ fontSize: 11, color: C.text3 }}>({queries.length})</span>}
                  <span style={{ marginLeft: "auto", color: C.accent, fontSize: 12 }}>View all →</span>
                </button>
                {queries == null ? (
                  <div style={{ fontSize: 12, color: C.text3 }}>Requires cluster_admin</div>
                ) : topQueries.length === 0 ? (
                  <div style={{ fontSize: 12, color: C.text3 }}>No queries running</div>
                ) : (
                  topQueries.map((q) => (
                    <div
                      key={q.query_id}
                      onClick={() => jumpTo({ kind: "section", id: "queries" })}
                      style={{
                        display: "flex", alignItems: "center", gap: 8, padding: "6px 10px",
                        borderRadius: 4, border: `1px solid ${C.borderLight}`, background: C.card,
                        marginBottom: 4, fontSize: 12, cursor: "pointer",
                      }}
                    >
                      <span style={{ fontWeight: 600, color: C.text1, flexShrink: 0 }}>{q.user}</span>
                      <span style={{ color: C.text2, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontFamily: "ui-monospace, monospace" }}>{q.sql ?? "—"}</span>
                      <span style={{ color: C.text2, flexShrink: 0, fontVariantNumeric: "tabular-nums" }}>{q.exec_time_display ?? "—"}</span>
                      <span title="CPU share" style={{ color: C.text3, flexShrink: 0, fontVariantNumeric: "tabular-nums", minWidth: 36, textAlign: "right" }}>
                        {fmtCpuShare(q.cpu_avg_cores, totalCores)}
                      </span>
                    </div>
                  ))
                )}
              </div>

              {/* Full dashboard link */}
              <button
                onClick={openClusterTab}
                data-testid="open-cluster-tab-btn"
                style={{
                  width: "100%", padding: "10px 12px", marginTop: 4,
                  border: `1px solid ${C.accent}50`, borderRadius: 6,
                  background: `${C.accent}10`, color: C.accent,
                  fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: "inherit",
                  display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
                }}
                onMouseEnter={(e) => { e.currentTarget.style.background = `${C.accent}20`; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = `${C.accent}10`; }}
              >
                Open Cluster Monitor — nodes & running queries →
              </button>
            </>
          )}
        </div>
      </div>
    </>
  );
}
