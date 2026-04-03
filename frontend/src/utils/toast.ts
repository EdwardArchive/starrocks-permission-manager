/** Simple toast notification system (no external dependency) */

type ToastType = "error" | "warning" | "info";

let container: HTMLDivElement | null = null;
const activeToasts = new Set<string>();

function getContainer() {
  if (container) return container;
  container = document.createElement("div");
  container.id = "toast-container";
  Object.assign(container.style, {
    position: "fixed",
    top: "16px",
    right: "16px",
    zIndex: "99999",
    display: "flex",
    flexDirection: "column",
    gap: "8px",
    pointerEvents: "none",
  });
  document.body.appendChild(container);
  return container;
}

const COLORS: Record<ToastType, { bg: string; border: string; text: string }> = {
  error: { bg: "#1e1215", border: "#ef4444", text: "#fca5a5" },
  warning: { bg: "#1e1a12", border: "#f59e0b", text: "#fde68a" },
  info: { bg: "#121a2e", border: "#3b82f6", text: "#93c5fd" },
};

export function showToast(message: string, type: ToastType = "error", duration = 5000) {
  // Deduplicate: skip if an identical toast is already visible
  const key = `${type}:${message}`;
  if (activeToasts.has(key)) return;
  activeToasts.add(key);

  const c = getContainer();
  const el = document.createElement("div");
  const colors = COLORS[type];
  Object.assign(el.style, {
    background: colors.bg,
    border: `1px solid ${colors.border}`,
    borderRadius: "8px",
    padding: "12px 16px",
    color: colors.text,
    fontSize: "13px",
    fontFamily: "inherit",
    maxWidth: "400px",
    wordBreak: "break-word",
    pointerEvents: "auto",
    cursor: "pointer",
    opacity: "0",
    transform: "translateX(20px)",
    transition: "opacity 0.2s, transform 0.2s",
    boxShadow: "0 4px 12px rgba(0,0,0,0.4)",
  });
  el.textContent = message;
  el.onclick = () => dismiss();
  c.appendChild(el);

  // Animate in
  requestAnimationFrame(() => {
    el.style.opacity = "1";
    el.style.transform = "translateX(0)";
  });

  const dismiss = () => {
    activeToasts.delete(key);
    el.style.opacity = "0";
    el.style.transform = "translateX(20px)";
    setTimeout(() => el.remove(), 200);
  };

  if (duration > 0) setTimeout(dismiss, duration);
}
