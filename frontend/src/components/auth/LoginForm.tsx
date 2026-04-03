import { useState } from "react";
import { login, getMe } from "../../api/auth";
import { useAuthStore } from "../../stores/authStore";
import { APP_LOGO_SVG } from "../dag/nodeIcons";

// All styles taken directly from mockup.html CSS values
const styles = {
  screen: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    height: "100vh",
    background: "linear-gradient(135deg,#0f172a 0%,#1e1b4b 50%,#0f172a 100%)",
  } as React.CSSProperties,

  card: {
    background: "#1e293b",
    border: "1px solid #475569",
    borderRadius: 16,
    padding: "48px 40px",
    width: 420,
    boxShadow: "0 25px 50px rgba(0,0,0,.5)",
  } as React.CSSProperties,

  logo: {
    textAlign: "center" as const,
    marginBottom: 24,
  } as React.CSSProperties,

  h1: {
    fontSize: 24,
    fontWeight: 700,
    marginBottom: 8,
    textAlign: "center" as const,
    color: "#e2e8f0",
  } as React.CSSProperties,

  subtitle: {
    color: "#94a3b8",
    textAlign: "center" as const,
    marginBottom: 32,
    fontSize: 14,
  } as React.CSSProperties,

  formRow: {
    display: "flex",
    gap: 12,
  } as React.CSSProperties,

  formGroup: {
    marginBottom: 16,
    flex: 1,
  } as React.CSSProperties,

  formGroupPort: {
    marginBottom: 16,
    maxWidth: 100,
  } as React.CSSProperties,

  label: {
    display: "block",
    fontSize: 13,
    color: "#94a3b8",
    marginBottom: 6,
    fontWeight: 500,
  } as React.CSSProperties,

  input: {
    width: "100%",
    padding: "10px 14px",
    background: "#0f172a",
    border: "1px solid #475569",
    borderRadius: 8,
    color: "#e2e8f0",
    fontSize: 14,
    outline: "none",
    fontFamily: "inherit",
  } as React.CSSProperties,

  button: {
    width: "100%",
    padding: 12,
    background: "#3b82f6",
    color: "#fff",
    border: "none",
    borderRadius: 8,
    fontSize: 15,
    fontWeight: 600,
    marginTop: 8,
    cursor: "pointer",
    fontFamily: "inherit",
  } as React.CSSProperties,

  error: {
    marginBottom: 16,
    padding: 12,
    borderRadius: 8,
    background: "rgba(239,68,68,0.1)",
    color: "#ef4444",
    fontSize: 14,
  } as React.CSSProperties,
};

export default function LoginForm() {
  const [host, setHost] = useState("");
  const [port, setPort] = useState("9030");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const { setAuth, setConnectionInfo } = useAuthStore();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await login({ host, port: +port, username, password });
      localStorage.setItem("sr_token", res.token);
      setConnectionInfo(host, +port);
      const me = await getMe();
      setAuth(res.token, me);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setLoading(false);
    }
  };

  const onFocus = (e: React.FocusEvent<HTMLInputElement>) => {
    e.target.style.borderColor = "#3b82f6";
  };
  const onBlur = (e: React.FocusEvent<HTMLInputElement>) => {
    e.target.style.borderColor = "#475569";
  };

  return (
    <div style={styles.screen}>
      <form onSubmit={handleSubmit} style={styles.card}>
        {/* Logo */}
        <div style={styles.logo}>
          <span
            style={{ display: "inline-block", width: 48, height: 48 }}
            dangerouslySetInnerHTML={{
              __html: APP_LOGO_SVG.replace(/<svg/, '<svg width="48" height="48"'),
            }}
          />
        </div>
        <h1 style={styles.h1}>StarRocks Permission Manager</h1>
        <p style={styles.subtitle}>
          StarRocks 클러스터에 연결하여 권한을 시각적으로 관리합니다
        </p>

        {error && <div style={styles.error}>{error}</div>}

        {/* Host + Port */}
        <div style={styles.formRow}>
          <div style={styles.formGroup}>
            <label style={styles.label}>Host</label>
            <input
              style={styles.input}
              value={host}
              onChange={(e) => setHost(e.target.value)}
              onFocus={onFocus}
              onBlur={onBlur}
              required
              placeholder="192.168.1.100"
            />
          </div>
          <div style={styles.formGroupPort}>
            <label style={styles.label}>Port</label>
            <input
              style={styles.input}
              value={port}
              onChange={(e) => setPort(e.target.value)}
              onFocus={onFocus}
              onBlur={onBlur}
              required
              placeholder="9030"
            />
          </div>
        </div>

        {/* Username */}
        <div style={{ marginBottom: 16 }}>
          <label style={styles.label}>Username</label>
          <input
            style={styles.input}
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            onFocus={onFocus}
            onBlur={onBlur}
            required
            placeholder="admin"
          />
        </div>

        {/* Password */}
        <div style={{ marginBottom: 16 }}>
          <label style={styles.label}>Password</label>
          <input
            type="password"
            style={styles.input}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onFocus={onFocus}
            onBlur={onBlur}
            required
            placeholder="Password"
          />
        </div>

        {/* Submit */}
        <button
          type="submit"
          disabled={loading}
          style={{
            ...styles.button,
            opacity: loading ? 0.5 : 1,
          }}
          onMouseEnter={(e) => (e.currentTarget.style.background = "#2563eb")}
          onMouseLeave={(e) => (e.currentTarget.style.background = "#3b82f6")}
        >
          {loading ? "Connecting..." : "Connect & Login"}
        </button>
      </form>
    </div>
  );
}
