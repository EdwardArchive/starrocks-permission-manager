import { describe, it, expect } from "vitest";
import { getPrivColor, PRIV_TAG_COLORS } from "./privColors";

describe("getPrivColor", () => {
  it("returns correct colors for exact match (SELECT)", () => {
    const color = getPrivColor("SELECT");
    expect(color).toEqual(PRIV_TAG_COLORS.SELECT);
  });

  it("returns correct colors for exact match (DELETE)", () => {
    const color = getPrivColor("DELETE");
    expect(color).toEqual(PRIV_TAG_COLORS.DELETE);
  });

  it("is case-insensitive (lowercase input)", () => {
    const color = getPrivColor("select");
    expect(color).toEqual(PRIV_TAG_COLORS.SELECT);
  });

  it("returns CREATE colors for CREATE TABLE (prefix match)", () => {
    const color = getPrivColor("CREATE TABLE");
    expect(color).toEqual(PRIV_TAG_COLORS.CREATE);
  });

  it("returns CREATE colors for CREATE VIEW (prefix match)", () => {
    const color = getPrivColor("CREATE VIEW");
    expect(color).toEqual(PRIV_TAG_COLORS.CREATE);
  });

  it("returns default purple for unknown privilege", () => {
    const color = getPrivColor("SOME_UNKNOWN_PRIV");
    expect(color.bg).toContain("139,92,246");
    expect(color.fg).toBe("#a78bfa");
  });
});

describe("PRIV_TAG_COLORS", () => {
  it("contains 16 standard privilege types", () => {
    expect(Object.keys(PRIV_TAG_COLORS)).toHaveLength(16);
  });

  it("all entries have bg and fg string properties", () => {
    for (const [, value] of Object.entries(PRIV_TAG_COLORS)) {
      expect(typeof value.bg).toBe("string");
      expect(typeof value.fg).toBe("string");
      // bg should be an rgba string, fg should be a hex color
      expect(value.bg).toMatch(/^rgba\(/);
      expect(value.fg).toMatch(/^#[0-9a-fA-F]{6}$/);
    }
  });
});
