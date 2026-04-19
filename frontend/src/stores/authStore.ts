import { create } from "zustand";
import type { UserInfo } from "../types";
import { logoutApi } from "../api/auth";
import { useClusterStore } from "./clusterStore";

interface AuthState {
  token: string | null;
  user: UserInfo | null;
  isLoggedIn: boolean;
  setAuth: (token: string, user: UserInfo) => void;
  logout: () => void;
  connectionInfo: { host: string; port: number } | null;
  setConnectionInfo: (host: string, port: number) => void;
}

function loadConnectionInfo(): { host: string; port: number } | null {
  try {
    const raw = localStorage.getItem("sr_connection");
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { host?: unknown; port?: unknown };
    if (typeof parsed.host === "string" && typeof parsed.port === "number") {
      return { host: parsed.host, port: parsed.port };
    }
  } catch { /* ignore malformed storage */ }
  return null;
}

export const useAuthStore = create<AuthState>((set) => ({
  token: localStorage.getItem("sr_token"),
  user: null,
  isLoggedIn: !!localStorage.getItem("sr_token"),
  connectionInfo: loadConnectionInfo(),
  setAuth: (token, user) => {
    localStorage.setItem("sr_token", token);
    set({ token, user, isLoggedIn: true });
  },
  logout: () => {
    logoutApi().catch(() => {});
    localStorage.removeItem("sr_token");
    localStorage.removeItem("sr_connection");
    set({ token: null, user: null, isLoggedIn: false, connectionInfo: null });
    useClusterStore.getState().reset();
  },
  setConnectionInfo: (host, port) => {
    localStorage.setItem("sr_connection", JSON.stringify({ host, port }));
    set({ connectionInfo: { host, port } });
  },
}));
