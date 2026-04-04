import { useAuthStore } from "../../stores/authStore";
import { APP_LOGO_SVG } from "../dag/nodeIcons";
import { C } from "../../utils/colors";

export default function Header() {
  const { user, connectionInfo, logout } = useAuthStore();

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
