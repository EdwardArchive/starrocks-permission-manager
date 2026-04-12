import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("../api/auth", () => ({
  logoutApi: vi.fn(() => Promise.resolve({ detail: "ok" })),
}));

import { useAuthStore } from "./authStore";
import { logoutApi } from "../api/auth";
import type { UserInfo } from "../types";

const mockUser: UserInfo = {
  username: "test_user",
  roles: ["role_admin", "db_reader"],
  default_role: "role_admin",
  is_user_admin: true,
};

beforeEach(() => {
  localStorage.clear();
  vi.mocked(logoutApi).mockClear();
  useAuthStore.setState({
    token: null, user: null, isLoggedIn: false, connectionInfo: null,
  });
});

describe("useAuthStore", () => {
  describe("initial state (after reset)", () => {
    it("has null token", () => {
      expect(useAuthStore.getState().token).toBeNull();
    });

    it("has null user", () => {
      expect(useAuthStore.getState().user).toBeNull();
    });

    it("has isLoggedIn false", () => {
      expect(useAuthStore.getState().isLoggedIn).toBe(false);
    });

    it("has null connectionInfo", () => {
      expect(useAuthStore.getState().connectionInfo).toBeNull();
    });
  });

  describe("setAuth", () => {
    it("sets token, user, and isLoggedIn to true", () => {
      useAuthStore.getState().setAuth("jwt-123", mockUser);

      const state = useAuthStore.getState();
      expect(state.token).toBe("jwt-123");
      expect(state.user).toEqual(mockUser);
      expect(state.isLoggedIn).toBe(true);
    });

    it("persists token to localStorage", () => {
      useAuthStore.getState().setAuth("jwt-456", mockUser);
      expect(localStorage.getItem("sr_token")).toBe("jwt-456");
    });

    it("stores complete user info", () => {
      useAuthStore.getState().setAuth("jwt-789", mockUser);
      const user = useAuthStore.getState().user!;
      expect(user.username).toBe("test_user");
      expect(user.roles).toEqual(["role_admin", "db_reader"]);
      expect(user.is_user_admin).toBe(true);
    });
  });

  describe("logout", () => {
    it("clears token, user, isLoggedIn, and connectionInfo", () => {
      useAuthStore.getState().setAuth("jwt-123", mockUser);
      useAuthStore.getState().setConnectionInfo("host1", 9030);

      useAuthStore.getState().logout();

      const state = useAuthStore.getState();
      expect(state.token).toBeNull();
      expect(state.user).toBeNull();
      expect(state.isLoggedIn).toBe(false);
      expect(state.connectionInfo).toBeNull();
    });

    it("removes sr_token from localStorage", () => {
      useAuthStore.getState().setAuth("jwt-123", mockUser);
      expect(localStorage.getItem("sr_token")).toBe("jwt-123");

      useAuthStore.getState().logout();
      expect(localStorage.getItem("sr_token")).toBeNull();
    });

    it("calls logoutApi (fire-and-forget)", () => {
      useAuthStore.getState().setAuth("jwt-123", mockUser);
      useAuthStore.getState().logout();
      expect(logoutApi).toHaveBeenCalledOnce();
    });
  });

  describe("setConnectionInfo", () => {
    it("sets host and port", () => {
      useAuthStore.getState().setConnectionInfo("10.0.0.1", 9030);
      const info = useAuthStore.getState().connectionInfo;
      expect(info).toEqual({ host: "10.0.0.1", port: 9030 });
    });

    it("can be called multiple times (overwrites)", () => {
      useAuthStore.getState().setConnectionInfo("host1", 9030);
      useAuthStore.getState().setConnectionInfo("host2", 9031);
      expect(useAuthStore.getState().connectionInfo).toEqual({ host: "host2", port: 9031 });
    });
  });
});
