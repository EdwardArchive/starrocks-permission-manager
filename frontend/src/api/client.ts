import { useAuthStore } from "../stores/authStore";
import { showToast } from "../utils/toast";

const BASE = "/api";

export async function apiFetch<T>(
  path: string,
  opts?: RequestInit & { signal?: AbortSignal }
): Promise<T> {
  const token = localStorage.getItem("sr_token");
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...((opts?.headers as Record<string, string>) ?? {}),
  };

  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, { ...opts, headers });
  } catch (e: unknown) {
    // Network error or aborted - don't show toast for aborted requests
    if (e instanceof DOMException && e.name === "AbortError") throw e;
    showToast("Network error: cannot reach server", "error");
    throw e;
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const msg = body.detail || `API error ${res.status}`;

    if (res.status === 401) {
      // Login failure shows server message; other 401s are session expiry
      if (path === "/auth/login") {
        showToast(msg, "error");
      } else {
        showToast("Session expired. Please log in again.", "warning");
        useAuthStore.getState().logout();
      }
    } else if (res.status >= 500) {
      showToast(`Server error: ${msg}`, "error");
    } else if (res.status !== 422) {
      // 422 = validation error, usually handled by caller
      showToast(msg, "error");
    }

    throw new Error(msg);
  }
  return res.json();
}
