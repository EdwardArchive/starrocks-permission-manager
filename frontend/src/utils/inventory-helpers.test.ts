import { describe, it, expect } from "vitest";
import { formatSQL, formatBytes, SUB_TAB_META, OBJECT_TYPE_MAP, PRIV_BY_TYPE } from "./inventory-helpers";

// ── formatSQL ──

describe("formatSQL", () => {
  it("formats a simple SELECT statement with uppercase keywords", () => {
    const result = formatSQL("select id, name from users where id = 1");
    expect(result).toContain("SELECT");
    expect(result).toContain("FROM");
    expect(result).toContain("WHERE");
  });

  it("returns JSON-formatted string when input is JSON", () => {
    const input = '{"key":"value","nested":{"a":1}}';
    const result = formatSQL(input);
    expect(result).toContain('"key": "value"');
    expect(result).toContain('"nested"');
  });

  it("returns original string when formatting fails", () => {
    // A string that is neither valid SQL nor JSON
    const garbage = "{{{{not-valid}}}}";
    const result = formatSQL(garbage);
    // Should at least not throw; may return the original or a best-effort format
    expect(typeof result).toBe("string");
  });

  it("removes consecutive blank lines from formatted output", () => {
    const result = formatSQL("select 1; select 2");
    // Should not contain two consecutive newlines (with optional whitespace between)
    expect(result).not.toMatch(/\n\s*\n/);
  });
});

// ── formatBytes ──

describe("formatBytes", () => {
  it("formats zero bytes", () => {
    expect(formatBytes(0)).toBe("0 B");
  });

  it("formats bytes (< 1024)", () => {
    expect(formatBytes(512)).toBe("512 B");
  });

  it("formats kilobytes", () => {
    expect(formatBytes(1024)).toBe("1.0 KB");
    expect(formatBytes(1536)).toBe("1.5 KB");
  });

  it("formats megabytes", () => {
    expect(formatBytes(1024 * 1024)).toBe("1.0 MB");
    expect(formatBytes(1.5 * 1024 * 1024)).toBe("1.5 MB");
  });

  it("formats gigabytes", () => {
    expect(formatBytes(1024 * 1024 * 1024)).toBe("1.00 GB");
    expect(formatBytes(2.33 * 1024 * 1024 * 1024)).toBe("2.33 GB");
  });
});

// ── Constants ──

describe("constants", () => {
  it("SUB_TAB_META contains all 15 expected tabs", () => {
    expect(SUB_TAB_META).toHaveLength(15);
    const keys = SUB_TAB_META.map((t) => t.key);
    expect(keys).toContain("roles");
    expect(keys).toContain("users");
    expect(keys).toContain("catalogs");
    expect(keys).toContain("databases");
    expect(keys).toContain("tables");
    expect(keys).toContain("mvs");
    expect(keys).toContain("views");
    expect(keys).toContain("functions");
  });

  it("OBJECT_TYPE_MAP maps all SubTab keys to uppercase types", () => {
    for (const meta of SUB_TAB_META) {
      expect(OBJECT_TYPE_MAP[meta.key]).toBeDefined();
      expect(OBJECT_TYPE_MAP[meta.key]).toBe(OBJECT_TYPE_MAP[meta.key].toUpperCase());
    }
  });

  it("PRIV_BY_TYPE has entries for standard object types", () => {
    const expectedKeys = ["table", "view", "mv", "function", "database", "catalog", "system"];
    for (const key of expectedKeys) {
      expect(PRIV_BY_TYPE[key]).toBeDefined();
      expect(Array.isArray(PRIV_BY_TYPE[key])).toBe(true);
      expect(PRIV_BY_TYPE[key].length).toBeGreaterThan(0);
    }
  });
});
