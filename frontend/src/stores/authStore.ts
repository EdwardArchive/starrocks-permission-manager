import { create } from "zustand";
import type { UserInfo } from "../types";
import { logoutApi } from "../api/auth";

interface AuthState {
  token: string | null;
  user: UserInfo | null;
  isLoggedIn: boolean;
  setAuth: (token: string, user: UserInfo) => void;
  logout: () => void;
  connectionInfo: { host: string; port: number } | null;
  setConnectionInfo: (host: string, port: number) => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  token: localStorage.getItem("sr_token"),
  user: null,
  isLoggedIn: !!localStorage.getItem("sr_token"),
  connectionInfo: null,
  setAuth: (token, user) => {
    localStorage.setItem("sr_token", token);
    set({ token, user, isLoggedIn: true });
  },
  logout: () => {
    logoutApi().catch(() => {});
    localStorage.removeItem("sr_token");
    set({ token: null, user: null, isLoggedIn: false, connectionInfo: null });
  },
  setConnectionInfo: (host, port) => set({ connectionInfo: { host, port } }),
}));
