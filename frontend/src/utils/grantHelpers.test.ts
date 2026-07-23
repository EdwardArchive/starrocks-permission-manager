import { describe, it, expect } from "vitest";
import { bareUser, grantMatchesObject, isRevocableRow } from "./grantHelpers";
import type { PrivilegeGrant } from "../types";

function g(overrides: Partial<PrivilegeGrant> = {}): PrivilegeGrant {
  return {
    grantee: "alice",
    grantee_type: "USER",
    object_catalog: "default_catalog",
    object_database: "sales",
    object_name: "orders",
    object_type: "TABLE",
    privilege_type: "SELECT",
    is_grantable: false,
    source: "direct",
    ...overrides,
  };
}

describe("bareUser", () => {
  it("strips the host from a quoted user@host identity", () => {
    expect(bareUser("'alice'@'%'")).toBe("alice");
    expect(bareUser("'app'@'10.0.0.1'")).toBe("app");
  });
  it("falls back to the part before @ for unquoted names", () => {
    expect(bareUser("alice@%")).toBe("alice");
  });
  it("returns a bare name trimmed and unchanged", () => {
    expect(bareUser("  root  ")).toBe("root");
    expect(bareUser("analyst")).toBe("analyst");
  });
});

describe("isRevocableRow", () => {
  it("rejects object types outside the grantable set", () => {
    expect(isRevocableRow(g({ object_type: "SYSTEM" }))).toBe(false);
  });
  it("requires a concrete catalog for CATALOG grants", () => {
    expect(isRevocableRow(g({ object_type: "CATALOG", object_catalog: "c1" }))).toBe(true);
    expect(isRevocableRow(g({ object_type: "CATALOG", object_catalog: null }))).toBe(false);
  });
  it("requires a concrete database for DATABASE grants", () => {
    expect(isRevocableRow(g({ object_type: "DATABASE", object_database: "sales" }))).toBe(true);
    expect(isRevocableRow(g({ object_type: "DATABASE", object_database: null }))).toBe(false);
  });
  it("requires both database and name for object-level grants", () => {
    expect(isRevocableRow(g())).toBe(true);
    expect(isRevocableRow(g({ object_name: null }))).toBe(false);
    expect(isRevocableRow(g({ object_database: null }))).toBe(false);
  });
});

describe("grantMatchesObject", () => {
  it("matches an exact table reference", () => {
    expect(grantMatchesObject(g(), "TABLE", "default_catalog", "sales", "orders")).toBe(true);
  });
  it("rejects a mismatched object type or path", () => {
    expect(grantMatchesObject(g(), "VIEW", "default_catalog", "sales", "orders")).toBe(false);
    expect(grantMatchesObject(g(), "TABLE", "default_catalog", "sales", "other")).toBe(false);
    expect(grantMatchesObject(g(), "TABLE", "other_catalog", "sales", "orders")).toBe(false);
  });
  it("ignores name for CATALOG and database+name for DATABASE", () => {
    expect(grantMatchesObject(g({ object_type: "CATALOG" }), "CATALOG", "default_catalog", "", "")).toBe(true);
    expect(grantMatchesObject(g({ object_type: "DATABASE" }), "DATABASE", "default_catalog", "sales", "")).toBe(true);
  });
  it("does not match a db-wide grant (null name) when a name is required", () => {
    expect(grantMatchesObject(g({ object_name: null }), "TABLE", "default_catalog", "sales", "orders")).toBe(false);
  });
});
