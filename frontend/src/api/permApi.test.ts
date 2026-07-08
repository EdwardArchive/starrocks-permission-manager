import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";

const mockApiFetch = vi.fn();

vi.mock("./client", () => ({
  apiFetch: (...args: unknown[]) => mockApiFetch(...args),
}));

import { userPermApi, adminPermApi, usePermApi } from "./permApi";
import { useAuthStore } from "../stores/authStore";
import type { UserInfo } from "../types";

beforeEach(() => {
  mockApiFetch.mockReset();
  mockApiFetch.mockResolvedValue([]);
});

// The user/admin variants come from the same factory, differing only in prefix.
// Running every function against both bases doubles as the factory contract test.
const VARIANTS = [
  ["user", userPermApi],
  ["admin", adminPermApi],
] as const;

describe("permApi factory — URL prefixes", () => {
  it.each(VARIANTS)("%s.getUserEffectivePrivileges", async (base, api) => {
    await api.getUserEffectivePrivileges("root");
    expect(mockApiFetch).toHaveBeenCalledWith(`/${base}/privileges/user/root/effective`, expect.any(Object));
  });

  it.each(VARIANTS)("%s.getRolePrivileges", async (base, api) => {
    await api.getRolePrivileges("db_admin");
    expect(mockApiFetch).toHaveBeenCalledWith(`/${base}/privileges/role/db_admin`, expect.any(Object));
  });

  it.each(VARIANTS)("%s.getObjectPrivileges builds query params", async (base, api) => {
    await api.getObjectPrivileges("cat", "db", "tbl", "TABLE");
    const url = mockApiFetch.mock.calls[0][0] as string;
    expect(url).toContain(`/${base}/privileges/object?`);
    expect(url).toContain("catalog=cat");
    expect(url).toContain("database=db");
    expect(url).toContain("name=tbl");
    expect(url).toContain("object_type=TABLE");
  });

  it.each(VARIANTS)("%s.getObjectPrivileges omits undefined params", async (base, api) => {
    await api.getObjectPrivileges("cat");
    const url = mockApiFetch.mock.calls[0][0] as string;
    expect(url).toContain(`/${base}/privileges/object?`);
    expect(url).toContain("catalog=cat");
    expect(url).not.toContain("database=");
    expect(url).not.toContain("name=");
    expect(url).not.toContain("object_type=");
  });

  it.each(VARIANTS)("%s.getRoles", async (base, api) => {
    await api.getRoles();
    expect(mockApiFetch).toHaveBeenCalledWith(`/${base}/roles`);
  });

  it.each(VARIANTS)("%s.getRoleHierarchy", async (base, api) => {
    await api.getRoleHierarchy();
    expect(mockApiFetch).toHaveBeenCalledWith(`/${base}/dag/role-hierarchy`, expect.any(Object));
  });

  it.each(VARIANTS)("%s.getInheritanceDag", async (base, api) => {
    await api.getInheritanceDag("root", "role");
    const url = mockApiFetch.mock.calls[0][0] as string;
    expect(url).toContain(`/${base}/roles/inheritance-dag?name=root&type=role`);
  });

  it.each(VARIANTS)("%s.getObjectHierarchy with catalog", async (base, api) => {
    await api.getObjectHierarchy("my_catalog");
    const url = mockApiFetch.mock.calls[0][0] as string;
    expect(url).toContain(`/${base}/dag/object-hierarchy?catalog=my_catalog`);
  });

  it.each(VARIANTS)("%s.getObjectHierarchy without catalog", async (base, api) => {
    await api.getObjectHierarchy();
    const url = mockApiFetch.mock.calls[0][0] as string;
    expect(url).toBe(`/${base}/dag/object-hierarchy`);
  });

  it.each(VARIANTS)("%s.searchAll encodes query + honors limit", async (base, api) => {
    await api.searchAll("q with spaces", 10);
    const url = mockApiFetch.mock.calls[0][0] as string;
    expect(url).toContain(`/${base}/search?q=q%20with%20spaces&limit=10`);
  });
});

const nonAdmin: UserInfo = { username: "alice", roles: [], default_role: null, is_user_admin: false, can_manage_grants: false };
const admin: UserInfo = { username: "root", roles: [], default_role: null, is_user_admin: true, can_manage_grants: false };

describe("usePermApi — selects by is_user_admin", () => {
  it("returns the user-scoped API for a non-admin", () => {
    useAuthStore.setState({ user: nonAdmin, isLoggedIn: true, token: "t" });
    const { result } = renderHook(() => usePermApi());
    expect(result.current).toBe(userPermApi);
  });

  it("returns the admin-scoped API for an admin", () => {
    useAuthStore.setState({ user: admin, isLoggedIn: true, token: "t" });
    const { result } = renderHook(() => usePermApi());
    expect(result.current).toBe(adminPermApi);
  });

  it("defaults to the user-scoped API when logged out", () => {
    useAuthStore.setState({ user: null, isLoggedIn: false, token: null });
    const { result } = renderHook(() => usePermApi());
    expect(result.current).toBe(userPermApi);
  });
});
