import { describe, it, expect, vi, beforeEach } from "vitest";

const mockApiFetch = vi.fn();

vi.mock("./client", () => ({
  apiFetch: (...args: unknown[]) => mockApiFetch(...args),
}));

import {
  getCatalogs,
  getDatabases,
  getTables,
  getTableDetail,
  getMyPermissions,
  getUserEffectivePrivileges,
  getRolePrivileges,
  getObjectPrivileges,
  getRoles,
  getInheritanceDag,
  getRoleHierarchy,
  getObjectHierarchy,
  searchAll,
} from "./user";

beforeEach(() => {
  mockApiFetch.mockReset();
  mockApiFetch.mockResolvedValue([]);
});

describe("user API", () => {
  it("getCatalogs calls /user/objects/catalogs", async () => {
    await getCatalogs();
    expect(mockApiFetch).toHaveBeenCalledWith("/user/objects/catalogs");
  });

  it("getDatabases builds correct URL", async () => {
    await getDatabases("default_catalog");
    const url = mockApiFetch.mock.calls[0][0] as string;
    expect(url).toContain("/user/objects/databases?catalog=default_catalog");
  });

  it("getTables builds correct URL with both params", async () => {
    await getTables("default", "analytics");
    const url = mockApiFetch.mock.calls[0][0] as string;
    expect(url).toContain("/user/objects/tables?");
    expect(url).toContain("catalog=default");
    expect(url).toContain("database=analytics");
  });

  it("getTableDetail builds correct URL with all params", async () => {
    await getTableDetail("default", "mydb", "orders");
    const url = mockApiFetch.mock.calls[0][0] as string;
    expect(url).toContain("/user/objects/table-detail?");
    expect(url).toContain("catalog=default");
    expect(url).toContain("database=mydb");
    expect(url).toContain("table=orders");
  });

  it("getMyPermissions calls /user/my-permissions", async () => {
    await getMyPermissions();
    expect(mockApiFetch).toHaveBeenCalledWith("/user/my-permissions", expect.any(Object));
  });

  it("getUserEffectivePrivileges calls correct endpoint", async () => {
    await getUserEffectivePrivileges("admin");
    expect(mockApiFetch).toHaveBeenCalledWith(
      "/user/privileges/user/admin/effective",
      expect.any(Object),
    );
  });

  it("getRolePrivileges calls correct endpoint", async () => {
    await getRolePrivileges("db_admin");
    expect(mockApiFetch).toHaveBeenCalledWith("/user/privileges/role/db_admin", expect.any(Object));
  });

  it("getObjectPrivileges builds query params", async () => {
    await getObjectPrivileges("cat", "db", "tbl", "TABLE");
    const url = mockApiFetch.mock.calls[0][0] as string;
    expect(url).toContain("/user/privileges/object?");
    expect(url).toContain("catalog=cat");
    expect(url).toContain("database=db");
    expect(url).toContain("name=tbl");
    expect(url).toContain("object_type=TABLE");
  });

  it("getObjectPrivileges omits undefined params", async () => {
    await getObjectPrivileges("cat");
    const url = mockApiFetch.mock.calls[0][0] as string;
    expect(url).toContain("catalog=cat");
    expect(url).not.toContain("database=");
    expect(url).not.toContain("name=");
  });

  it("getRoles calls /user/roles", async () => {
    await getRoles();
    expect(mockApiFetch).toHaveBeenCalledWith("/user/roles");
  });

  it("getInheritanceDag builds correct URL", async () => {
    await getInheritanceDag("root", "role");
    const url = mockApiFetch.mock.calls[0][0] as string;
    expect(url).toContain("/user/roles/inheritance-dag?name=root&type=role");
  });

  it("getRoleHierarchy calls correct endpoint", async () => {
    await getRoleHierarchy();
    expect(mockApiFetch).toHaveBeenCalledWith("/user/dag/role-hierarchy", expect.any(Object));
  });

  it("getObjectHierarchy with catalog", async () => {
    await getObjectHierarchy("my_catalog");
    const url = mockApiFetch.mock.calls[0][0] as string;
    expect(url).toContain("/user/dag/object-hierarchy?catalog=my_catalog");
  });

  it("getObjectHierarchy without catalog", async () => {
    await getObjectHierarchy();
    const url = mockApiFetch.mock.calls[0][0] as string;
    expect(url).toBe("/user/dag/object-hierarchy");
  });

  it("searchAll builds correct URL", async () => {
    await searchAll("test_query");
    const url = mockApiFetch.mock.calls[0][0] as string;
    expect(url).toContain("/user/search?q=test_query&limit=50");
  });

  it("searchAll encodes special characters", async () => {
    await searchAll("table with spaces");
    const url = mockApiFetch.mock.calls[0][0] as string;
    expect(url).toContain("q=table%20with%20spaces");
  });
});
