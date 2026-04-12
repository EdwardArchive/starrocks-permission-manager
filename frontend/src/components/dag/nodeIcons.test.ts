import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock all SVG ?raw imports before importing the module
vi.mock("../../../icons/system.svg?raw", () => ({ default: '<svg width="24" height="24" stroke="#000"><circle cx="12" cy="12" r="10"/></svg>' }));
vi.mock("../../../icons/catalog.svg?raw", () => ({ default: '<svg width="24" height="24" stroke="#000"><rect x="4" y="4" width="16" height="16"/></svg>' }));
vi.mock("../../../icons/database.svg?raw", () => ({ default: '<svg width="24" height="24" stroke="#000"><ellipse cx="12" cy="12" rx="10" ry="6"/></svg>' }));
vi.mock("../../../icons/table.svg?raw", () => ({ default: '<svg width="24" height="24" stroke="#000"><line x1="0" y1="12" x2="24" y2="12"/></svg>' }));
vi.mock("../../../icons/view.svg?raw", () => ({ default: '<svg width="24" height="24" stroke="#000"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/></svg>' }));
vi.mock("../../../icons/mv.svg?raw", () => ({ default: '<svg width="24" height="24" stroke="#000"><polygon points="12,2 22,22 2,22"/></svg>' }));
vi.mock("../../../icons/function.svg?raw", () => ({ default: '<svg width="24" height="24" stroke="#000"><text>f(x)</text></svg>' }));
vi.mock("../../../icons/user.svg?raw", () => ({ default: '<svg width="24" height="24" stroke="#000"><circle cx="12" cy="8" r="5"/></svg>' }));
vi.mock("../../../icons/role.svg?raw", () => ({ default: '<svg width="24" height="24" stroke="#000" fill="blue"><rect x="6" y="6" width="12" height="12"/></svg>' }));
vi.mock("../../../icons/app-logo.svg?raw", () => ({ default: '<svg width="24" height="24"><circle cx="12" cy="12" r="10"/></svg>' }));

import { NODE_SVG_RAW, APP_LOGO_SVG, NODE_COLORS, ROLE_CATEGORY_COLORS, EDGE_COLORS, colorizedSvg } from "./nodeIcons";

beforeEach(() => {
  // Clear the internal SVG cache by calling with unique types each time would not work,
  // but we can test the function behavior
});

describe("NODE_SVG_RAW", () => {
  it("contains all expected node types", () => {
    const expectedTypes = ["system", "catalog", "database", "table", "view", "mv", "function", "user", "role"];
    for (const type of expectedTypes) {
      expect(NODE_SVG_RAW[type]).toBeDefined();
      expect(typeof NODE_SVG_RAW[type]).toBe("string");
    }
  });

  it("all SVG strings contain svg element", () => {
    for (const [, svg] of Object.entries(NODE_SVG_RAW)) {
      expect(svg).toContain("<svg");
    }
  });
});

describe("APP_LOGO_SVG", () => {
  it("is a non-empty string containing svg", () => {
    expect(typeof APP_LOGO_SVG).toBe("string");
    expect(APP_LOGO_SVG.length).toBeGreaterThan(0);
    expect(APP_LOGO_SVG).toContain("<svg");
  });
});

describe("NODE_COLORS", () => {
  it("has colors for all node types", () => {
    const expectedTypes = ["system", "catalog", "database", "table", "view", "mv", "function", "user", "role"];
    for (const type of expectedTypes) {
      expect(NODE_COLORS[type]).toBeDefined();
      expect(NODE_COLORS[type]).toMatch(/^#[0-9a-fA-F]{6}$/);
    }
  });
});

describe("ROLE_CATEGORY_COLORS", () => {
  it("has colors for root, builtin, and custom", () => {
    expect(ROLE_CATEGORY_COLORS.root).toBeDefined();
    expect(ROLE_CATEGORY_COLORS.builtin).toBeDefined();
    expect(ROLE_CATEGORY_COLORS.custom).toBeDefined();
  });
});

describe("EDGE_COLORS", () => {
  it("has colors for common edge types", () => {
    expect(EDGE_COLORS.hierarchy).toBeDefined();
    expect(EDGE_COLORS.assignment).toBeDefined();
    expect(EDGE_COLORS.inheritance).toBeDefined();
  });
});

describe("colorizedSvg", () => {
  it("replaces stroke color in SVG string", () => {
    const result = colorizedSvg("system");
    expect(result).toContain('stroke="#6b7280"');
    expect(result).not.toContain('stroke="#000"');
  });

  it("uses override color when provided", () => {
    const result = colorizedSvg("catalog", "#ff0000");
    expect(result).toContain('stroke="#ff0000"');
  });

  it("replaces fill color (but not fill=none)", () => {
    // role SVG has fill="blue"
    const result = colorizedSvg("role");
    const roleColor = NODE_COLORS.role; // #f97316
    expect(result).toContain(`fill="${roleColor}"`);
    expect(result).not.toContain('fill="blue"');
  });

  it("returns empty string for unknown type", () => {
    const result = colorizedSvg("nonexistent");
    expect(result).toBe("");
  });

  it("returns cached result on second call with same args", () => {
    const result1 = colorizedSvg("table");
    const result2 = colorizedSvg("table");
    expect(result1).toBe(result2);
  });

  it("uses default gray for unknown type with NODE_COLORS", () => {
    // When type is unknown, color defaults to #6b7280 but raw SVG is also undefined
    const result = colorizedSvg("unknown_type");
    expect(result).toBe("");
  });
});
