import { useAuthStore } from "../stores/authStore";
import { showToast } from "../utils/toast";

const BASE = "/api";

/** API error carrying the HTTP status so callers can branch (e.g. 403 → permission UI). */
export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

export async function apiFetch<T>(
  path: string,
  // quiet: suppress error toasts (except session expiry) — for polling callers
  // that render the error in place instead
  opts?: RequestInit & { signal?: AbortSignal; quiet?: boolean }
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
    } else if (opts?.quiet) {
      // Caller renders the error in place — no toast
    } else if (res.status >= 500) {
      showToast(`Server error: ${msg}`, "error");
    } else if (res.status !== 422) {
      // 422 = validation error, usually handled by caller
      showToast(msg, "error");
    }

    throw new ApiError(msg, res.status);
  }
  return res.json();
}
