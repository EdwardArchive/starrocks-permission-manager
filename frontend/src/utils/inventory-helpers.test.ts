import { describe, it, expect } from "vitest";
import { formatSQL, formatBytes, SUB_TAB_META, OBJECT_TYPE_MAP, PRIV_BY_TYPE, PRIV_KEY_MAP } from "./inventory-helpers";

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
    const garbage = "{{{{not-valid}}}}";
    const result = formatSQL(garbage);
    expect(result).toBe(garbage);
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

  it("PRIV_KEY_MAP maps all standard object types correctly", () => {
    const expected: Record<string, string> = {
      TABLE: "table", VIEW: "view", "MATERIALIZED VIEW": "mv", FUNCTION: "function",
      DATABASE: "database", CATALOG: "catalog", SYSTEM: "system",
      WAREHOUSE: "warehouse", RESOURCE: "resource", PIPE: "pipe", TASK: "task",
      "GLOBAL FUNCTION": "global function",
      "RESOURCE GROUP": "resource group",
      "STORAGE VOLUME": "storage volume",
    };
    for (const [key, value] of Object.entries(expected)) {
      expect(PRIV_KEY_MAP[key]).toBe(value);
    }
  });

  it("PRIV_KEY_MAP maps underscore variants to same values as space variants", () => {
    expect(PRIV_KEY_MAP["GLOBAL_FUNCTION"]).toBe(PRIV_KEY_MAP["GLOBAL FUNCTION"]);
    expect(PRIV_KEY_MAP["RESOURCE_GROUP"]).toBe(PRIV_KEY_MAP["RESOURCE GROUP"]);
    expect(PRIV_KEY_MAP["STORAGE_VOLUME"]).toBe(PRIV_KEY_MAP["STORAGE VOLUME"]);
  });

  it("PRIV_KEY_MAP has 17 total entries", () => {
    expect(Object.keys(PRIV_KEY_MAP)).toHaveLength(17);
  });
});
