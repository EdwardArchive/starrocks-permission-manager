import { describe, it, expect } from "vitest";
import { SCOPE_ORDER, SCOPE_ICONS } from "./scopeConfig";

describe("SCOPE_ORDER", () => {
  it("is an array of scope strings", () => {
    expect(Array.isArray(SCOPE_ORDER)).toBe(true);
    expect(SCOPE_ORDER.length).toBeGreaterThan(0);
  });

  it("starts with SYSTEM", () => {
    expect(SCOPE_ORDER[0]).toBe("SYSTEM");
  });

  it("contains common scope types", () => {
    expect(SCOPE_ORDER).toContain("CATALOG");
    expect(SCOPE_ORDER).toContain("DATABASE");
    expect(SCOPE_ORDER).toContain("TABLE");
    expect(SCOPE_ORDER).toContain("VIEW");
    expect(SCOPE_ORDER).toContain("FUNCTION");
  });

  it("has SYSTEM before CATALOG before DATABASE", () => {
    const sysIdx = SCOPE_ORDER.indexOf("SYSTEM");
    const catIdx = SCOPE_ORDER.indexOf("CATALOG");
    const dbIdx = SCOPE_ORDER.indexOf("DATABASE");
    expect(sysIdx).toBeLessThan(catIdx);
    expect(catIdx).toBeLessThan(dbIdx);
  });
});

describe("SCOPE_ICONS", () => {
  it("maps common scopes to icon types", () => {
    expect(SCOPE_ICONS.SYSTEM).toBe("system");
    expect(SCOPE_ICONS.CATALOG).toBe("catalog");
    expect(SCOPE_ICONS.DATABASE).toBe("database");
    expect(SCOPE_ICONS.TABLE).toBe("table");
    expect(SCOPE_ICONS.VIEW).toBe("view");
    expect(SCOPE_ICONS["MATERIALIZED VIEW"]).toBe("mv");
    expect(SCOPE_ICONS.FUNCTION).toBe("function");
  });
});
