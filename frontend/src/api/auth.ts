import { apiFetch } from "./client";
import type { LoginRequest, LoginResponse, UserInfo } from "../types";

export const login = (data: LoginRequest) =>
  apiFetch<LoginResponse>("/auth/login", {
    method: "POST",
    body: JSON.stringify(data),
  });

export const getMe = () => apiFetch<UserInfo>("/auth/me");

export const logoutApi = () =>
  apiFetch<{ detail: string }>("/auth/logout", { method: "POST" });
