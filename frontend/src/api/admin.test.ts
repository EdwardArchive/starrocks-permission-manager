import { describe, it, expect, vi, beforeEach } from "vitest";

const mockApiFetch = vi.fn();

vi.mock("./client", () => ({
  apiFetch: (...args: unknown[]) => mockApiFetch(...args),
}));

import {
  getUserPrivileges,
  getRolePrivileges,
  getUserEffectivePrivileges,
  getObjectPrivileges,
  getRoles,
  getRoleHierarchy,
  getInheritanceDag,
  getObjectHierarchy,
  searchAll,
  searchUsersRoles,
} from "./admin";

beforeEach(() => {
  mockApiFetch.mockReset();
  mockApiFetch.mockResolvedValue([]);
});

describe("admin API", () => {
  it("getUserPrivileges calls correct endpoint", async () => {
    await getUserPrivileges("admin");
    expect(mockApiFetch).toHaveBeenCalledWith("/admin/privileges/user/admin", expect.any(Object));
  });

  it("getUserPrivileges encodes username", async () => {
    await getUserPrivileges("user with spaces");
    expect(mockApiFetch).toHaveBeenCalledWith(
      "/admin/privileges/user/user%20with%20spaces",
      expect.any(Object),
    );
  });

  it("getRolePrivileges calls correct endpoint", async () => {
    await getRolePrivileges("db_admin");
    expect(mockApiFetch).toHaveBeenCalledWith("/admin/privileges/role/db_admin", expect.any(Object));
  });

  it("getUserEffectivePrivileges calls correct endpoint", async () => {
    await getUserEffectivePrivileges("root");
    expect(mockApiFetch).toHaveBeenCalledWith(
      "/admin/privileges/user/root/effective",
      expect.any(Object),
    );
  });

  it("getObjectPrivileges builds query params", async () => {
    await getObjectPrivileges("default", "analytics", "orders", "TABLE");
    const url = mockApiFetch.mock.calls[0][0] as string;
    expect(url).toContain("/admin/privileges/object?");
    expect(url).toContain("catalog=default");
    expect(url).toContain("database=analytics");
    expect(url).toContain("name=orders");
    expect(url).toContain("object_type=TABLE");
  });

  it("getObjectPrivileges omits undefined params", async () => {
    await getObjectPrivileges("default");
    const url = mockApiFetch.mock.calls[0][0] as string;
    expect(url).toContain("catalog=default");
    expect(url).not.toContain("database=");
    expect(url).not.toContain("name=");
    expect(url).not.toContain("object_type=");
  });

  it("getRoles calls /admin/roles", async () => {
    await getRoles();
    expect(mockApiFetch).toHaveBeenCalledWith("/admin/roles");
  });

  it("getRoleHierarchy calls correct endpoint", async () => {
    await getRoleHierarchy();
    expect(mockApiFetch).toHaveBeenCalledWith("/admin/dag/role-hierarchy", expect.any(Object));
  });

  it("getInheritanceDag builds correct URL", async () => {
    await getInheritanceDag("admin", "user");
    const url = mockApiFetch.mock.calls[0][0] as string;
    expect(url).toContain("/admin/roles/inheritance-dag?name=admin&type=user");
  });

  it("getObjectHierarchy with catalog param", async () => {
    await getObjectHierarchy("my_catalog");
    const url = mockApiFetch.mock.calls[0][0] as string;
    expect(url).toContain("/admin/dag/object-hierarchy?catalog=my_catalog");
  });

  it("getObjectHierarchy without catalog param", async () => {
    await getObjectHierarchy();
    const url = mockApiFetch.mock.calls[0][0] as string;
    expect(url).toBe("/admin/dag/object-hierarchy");
  });

  it("searchAll builds correct URL with defaults", async () => {
    await searchAll("orders");
    const url = mockApiFetch.mock.calls[0][0] as string;
    expect(url).toContain("/admin/search?q=orders&limit=50");
  });

  it("searchAll with custom limit", async () => {
    await searchAll("test", 10);
    const url = mockApiFetch.mock.calls[0][0] as string;
    expect(url).toContain("limit=10");
  });

  it("searchUsersRoles builds correct URL", async () => {
    await searchUsersRoles("admin");
    const url = mockApiFetch.mock.calls[0][0] as string;
    expect(url).toContain("/admin/search/users-roles?q=admin&limit=50");
  });
});
