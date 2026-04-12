import { describe, it, expect } from "vitest";
import { C, ENTITY_BADGE } from "./colors";

describe("C (color palette)", () => {
  it("has all expected color keys", () => {
    expect(C.bg).toBeDefined();
    expect(C.card).toBeDefined();
    expect(C.border).toBeDefined();
    expect(C.borderLight).toBeDefined();
    expect(C.text1).toBeDefined();
    expect(C.text2).toBeDefined();
    expect(C.text3).toBeDefined();
    expect(C.accent).toBeDefined();
    expect(C.green).toBeDefined();
    expect(C.warning).toBeDefined();
  });

  it("all values are hex color strings", () => {
    for (const value of Object.values(C)) {
      expect(value).toMatch(/^#[0-9a-fA-F]{6}$/);
    }
  });
});

describe("ENTITY_BADGE", () => {
  it("has user badge colors", () => {
    expect(ENTITY_BADGE.user.bg).toBeDefined();
    expect(ENTITY_BADGE.user.fg).toBeDefined();
  });

  it("has role badge colors", () => {
    expect(ENTITY_BADGE.role.bg).toBeDefined();
    expect(ENTITY_BADGE.role.fg).toBeDefined();
  });
});
