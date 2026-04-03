import { useAuthStore } from "../../stores/authStore";
import { APP_LOGO_SVG } from "../dag/nodeIcons";

export default function Header() {
  const { user, connectionInfo, logout } = useAuthStore();

  return (
    <header style={{
      height: 56, background: "#1e293b", borderBottom: "1px solid #475569",
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
        <span style={{ fontSize: 13, color: "#94a3b8" }}>
          <strong style={{ color: "#e2e8f0" }}>{user?.username}</strong>
          {connectionInfo && `@${connectionInfo.host}:${connectionInfo.port}`}
        </span>
        <button
          onClick={logout}
          style={{
            padding: "6px 14px", background: "transparent", border: "1px solid #475569",
            borderRadius: 6, color: "#94a3b8", fontSize: 13, cursor: "pointer", fontFamily: "inherit",
          }}
          onMouseEnter={(e) => { e.currentTarget.style.borderColor = "#ef4444"; e.currentTarget.style.color = "#ef4444"; }}
          onMouseLeave={(e) => { e.currentTarget.style.borderColor = "#475569"; e.currentTarget.style.color = "#94a3b8"; }}
        >
          Logout
        </button>
      </div>
    </header>
  );
}
