import { useState } from "react";
import { useAuthStore } from "../../stores/authStore";
import { APP_LOGO_SVG } from "../dag/nodeIcons";
import { C } from "../../utils/colors";
import { useClusterStore } from "../../stores/clusterStore";
import { useGrantStore } from "../../stores/grantStore";
import { useDagStore } from "../../stores/dagStore";
import { getClusterStatus } from "../../api/cluster";
import { usePolling } from "../../hooks/usePolling";

const HEALTH_POLL_MS = 60_000;

export default function Header() {
  const { user, connectionInfo, logout } = useAuthStore();
  const toggleDrawer = useClusterStore((s) => s.toggleDrawer);
  const openWizard = useGrantStore((s) => s.openWizard);
  const [hasClusterErrors, setHasClusterErrors] = useState(false);

  // Lightweight health poll for the icon badge: non-refresh (rides the 60s
  // server cache) and quiet (no toasts) — failures just leave the badge off.
  usePolling(() => {
    getClusterStatus(undefined, false, /* quiet */ true)
      .then((res) => setHasClusterErrors(res.has_errors))
      .catch(() => setHasClusterErrors(false));
  }, HEALTH_POLL_MS, { immediate: true });

  const handleManagePrivileges = () => {
    // Prefill from the Permission Focus tab's currently-viewed user/role
    const node = useDagStore.getState().selectedNode;
    const nodeType = node?.type?.toUpperCase();
    if (node && (nodeType === "USER" || nodeType === "ROLE")) {
      openWizard({ grantee: { name: node.label, type: nodeType } });
    } else {
      openWizard();
    }
  };

  return (
    <header style={{
      height: 56, background: C.card, borderBottom: `1px solid ${C.borderLight}`,
      display: "flex", alignItems: "center", justifyContent: "space-between",
      padding: "0 20px", flexShrink: 0,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <span
          style={{ width: 22, height: 22, display: "inline-flex" }}
          dangerouslySetInnerHTML={{
            __html: APP_LOGO_SVG.replace(/<svg/, '<svg width="22" height="22"'),
          }}
        />
        <h2 style={{ fontSize: 16, fontWeight: 600, margin: 0 }}>StarRocks Permission Manager</h2>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
        <span style={{ fontSize: 13, color: C.text2 }}>
          <strong style={{ color: C.text1 }}>{user?.username}</strong>
          {connectionInfo && `@${connectionInfo.host}:${connectionInfo.port}`}
        </span>
        {user?.can_manage_grants && (
          <button
            onClick={handleManagePrivileges}
            data-testid="manage-privileges-btn"
            style={{
              padding: "6px 12px", background: "transparent", border: `1px solid ${C.accent}`,
              borderRadius: 6, color: C.accent, fontSize: 13, cursor: "pointer", fontFamily: "inherit",
              display: "flex", alignItems: "center", gap: 6,
            }}
          >
            <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
            Manage Privileges
          </button>
        )}
        <button
          onClick={toggleDrawer}
          aria-label="Cluster Status"
          title={hasClusterErrors ? "Cluster Status — issues detected" : "Cluster Status"}
          data-testid="cluster-status-btn"
          style={{
            width: 34, height: 34, padding: 0, position: "relative",
            background: "transparent", border: `1px solid ${C.borderLight}`,
            borderRadius: 6, color: C.text2, cursor: "pointer",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}
          onMouseEnter={(e) => { e.currentTarget.style.color = C.accent; e.currentTarget.style.borderColor = C.accent; }}
          onMouseLeave={(e) => { e.currentTarget.style.color = C.text2; e.currentTarget.style.borderColor = C.borderLight; }}
        >
          <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="4" width="18" height="6" rx="1"/>
            <rect x="3" y="14" width="18" height="6" rx="1"/>
            <line x1="6" y1="7" x2="6.01" y2="7"/>
            <line x1="6" y1="17" x2="6.01" y2="17"/>
          </svg>
          {hasClusterErrors && (
            <span
              data-testid="cluster-error-badge"
              style={{
                position: "absolute", top: -3, right: -3, width: 9, height: 9,
                borderRadius: "50%", background: "#ef4444",
                border: `1.5px solid ${C.card}`, boxShadow: "0 0 4px #ef444480",
              }}
            />
          )}
        </button>
        <button
          onClick={logout}
          style={{
            padding: "6px 14px", background: "transparent", border: `1px solid ${C.borderLight}`,
            borderRadius: 6, color: C.text2, fontSize: 13, cursor: "pointer", fontFamily: "inherit",
          }}
          onMouseEnter={(e) => { e.currentTarget.style.borderColor = "#ef4444"; e.currentTarget.style.color = "#ef4444"; }}
          onMouseLeave={(e) => { e.currentTarget.style.borderColor = C.borderLight; e.currentTarget.style.color = C.text2; }}
        >
          Logout
        </button>
      </div>
    </header>
  );
}
