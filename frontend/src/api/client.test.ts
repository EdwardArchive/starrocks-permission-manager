import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock dependencies before import
const mockLogout = vi.fn();
vi.mock("../stores/authStore", () => ({
  useAuthStore: {
    getState: vi.fn(() => ({
      token: null,
      logout: mockLogout,
    })),
  },
}));

vi.mock("../utils/toast", () => ({
  showToast: vi.fn(),
}));

import { apiFetch } from "./client";
import { showToast } from "../utils/toast";
import { useAuthStore } from "../stores/authStore";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
  mockLogout.mockClear();
  vi.mocked(showToast).mockClear();
  vi.mocked(useAuthStore.getState).mockReturnValue({
    token: null,
    logout: mockLogout,
  } as unknown as ReturnType<typeof useAuthStore.getState>);
});

describe("apiFetch", () => {
  it("returns parsed JSON on successful 200 response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ data: "ok" })));

    const result = await apiFetch<{ data: string }>("/test");
    expect(result).toEqual({ data: "ok" });
  });

  it("prepends /api to the path", async () => {
    const mockFetch = vi.fn().mockResolvedValue(jsonResponse({}));
    vi.stubGlobal("fetch", mockFetch);

    await apiFetch("/some/path");
    expect(mockFetch).toHaveBeenCalledWith("/api/some/path", expect.any(Object));
  });

  it("injects Authorization header when sr_token exists in localStorage", async () => {
    localStorage.setItem("sr_token", "my-jwt-token");
    const mockFetch = vi.fn().mockResolvedValue(jsonResponse({}));
    vi.stubGlobal("fetch", mockFetch);

    await apiFetch("/test");

    const callHeaders = mockFetch.mock.calls[0][1].headers;
    expect(callHeaders["Authorization"]).toBe("Bearer my-jwt-token");
  });

  it("does not include Authorization header when no token in localStorage", async () => {
    const mockFetch = vi.fn().mockResolvedValue(jsonResponse({}));
    vi.stubGlobal("fetch", mockFetch);

    await apiFetch("/test");

    const callHeaders = mockFetch.mock.calls[0][1].headers;
    expect(callHeaders["Authorization"]).toBeUndefined();
  });

  it("shows error toast on 401 for /auth/login path", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse({ detail: "Invalid credentials" }, 401)),
    );

    await expect(apiFetch("/auth/login")).rejects.toThrow("Invalid credentials");
    expect(showToast).toHaveBeenCalledWith("Invalid credentials", "error");
    expect(mockLogout).not.toHaveBeenCalled();
  });

  it("calls logout on 401 for non-login paths", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse({ detail: "Unauthorized" }, 401)),
    );

    await expect(apiFetch("/user/roles")).rejects.toThrow();
    expect(mockLogout).toHaveBeenCalledOnce();
    expect(showToast).toHaveBeenCalledWith("Session expired. Please log in again.", "warning");
  });

  it("shows server error toast on 500+ status", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse({ detail: "Internal failure" }, 500)),
    );

    await expect(apiFetch("/test")).rejects.toThrow();
    expect(showToast).toHaveBeenCalledWith("Server error: Internal failure", "error");
  });

  it("throws without toast on 422 status", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse({ detail: "Validation error" }, 422)),
    );

    await expect(apiFetch("/test")).rejects.toThrow("Validation error");
    expect(showToast).not.toHaveBeenCalled();
  });

  it("shows network error toast on TypeError (network failure)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));

    await expect(apiFetch("/test")).rejects.toThrow("Failed to fetch");
    expect(showToast).toHaveBeenCalledWith("Network error: cannot reach server", "error");
  });

  it("rethrows AbortError without showing toast", async () => {
    const abortError = new DOMException("The operation was aborted", "AbortError");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(abortError));

    await expect(apiFetch("/test")).rejects.toThrow(abortError);
    expect(showToast).not.toHaveBeenCalled();
  });
});
