import { describe, it, expect, vi, beforeEach } from "vitest";

const mockApiFetch = vi.fn();

vi.mock("./client", () => ({
  apiFetch: (...args: unknown[]) => mockApiFetch(...args),
}));

import { login, getMe, logoutApi } from "./auth";

beforeEach(() => {
  mockApiFetch.mockReset();
  mockApiFetch.mockResolvedValue({});
});

describe("auth API", () => {
  it("login sends POST with credentials", async () => {
    const creds = { host: "10.0.0.1", port: 9030, username: "admin", password: "secret" };
    await login(creds);
    expect(mockApiFetch).toHaveBeenCalledWith("/auth/login", {
      method: "POST",
      body: JSON.stringify(creds),
    });
  });

  it("getMe calls /auth/me", async () => {
    await getMe();
    expect(mockApiFetch).toHaveBeenCalledWith("/auth/me");
  });

  it("logoutApi sends POST to /auth/logout", async () => {
    await logoutApi();
    expect(mockApiFetch).toHaveBeenCalledWith("/auth/logout", { method: "POST" });
  });
});
