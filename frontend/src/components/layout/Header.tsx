import { useAuthStore } from "../../stores/authStore";
import { APP_LOGO_SVG } from "../dag/nodeIcons";
import { C } from "../../utils/colors";
import { useClusterStore } from "../../stores/clusterStore";

export default function Header() {
  const { user, connectionInfo, logout } = useAuthStore();
  const toggleDrawer = useClusterStore((s) => s.toggleDrawer);

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
        <button
          onClick={toggleDrawer}
          aria-label="Cluster Status"
          title="Cluster Status"
          data-testid="cluster-status-btn"
          style={{
            width: 34, height: 34, padding: 0,
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
