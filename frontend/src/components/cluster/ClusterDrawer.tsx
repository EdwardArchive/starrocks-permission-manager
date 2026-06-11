/**
 * Cluster status quick glance — right-side drawer opened from the header icon.
 * Shows the summary card + alerts; the full dashboard (node cards + running
 * queries) lives in the Cluster Monitor tab, linked from here.
 */
import { useEffect, useState, useCallback, useRef } from "react";
import { useShallow } from "zustand/react/shallow";
import { useClusterStore } from "../../stores/clusterStore";
import { useDagStore } from "../../stores/dagStore";
import { getClusterStatus } from "../../api/cluster";
import type { ClusterStatusResponse } from "../../types";
import { C } from "../../utils/colors";
import { Loader } from "../tabs/inventory-ui";
import InlineIcon from "../common/InlineIcon";
import { ClusterSummary, ClusterAlerts, ClusterBanners } from "./ClusterSummary";

export default function ClusterDrawer() {
  const { isOpen, closeDrawer } = useClusterStore(
    useShallow((s) => ({
      isOpen: s.isOpen,
      closeDrawer: s.closeDrawer,
    })),
  );
  const setActiveTab = useDagStore((s) => s.setActiveTab);
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

  const openClusterTab = () => {
    setActiveTab("cluster");
    closeDrawer();
  };

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

          {/* Data content — quick glance: banners + summary + alerts */}
          {!loading && data && (
            <>
              <ClusterBanners data={data} />
              <ClusterSummary data={data} />
              <ClusterAlerts data={data} />

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
