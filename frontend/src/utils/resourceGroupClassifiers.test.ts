import { describe, it, expect } from "vitest";
import { parseResourceGroupClassifiers } from "./resourceGroupClassifiers";

describe("parseResourceGroupClassifiers", () => {
  it("returns empty for undefined / null / empty string", () => {
    expect(parseResourceGroupClassifiers(undefined)).toEqual({ classifiers: [], isSystemDefault: false });
    expect(parseResourceGroupClassifiers(null)).toEqual({ classifiers: [], isSystemDefault: false });
    expect(parseResourceGroupClassifiers("")).toEqual({ classifiers: [], isSystemDefault: false });
  });

  it("returns empty (not system default) for an empty JSON array", () => {
    expect(parseResourceGroupClassifiers("[]")).toEqual({ classifiers: [], isSystemDefault: false });
  });

  it("parses a single classifier with '=' key/value pairs", () => {
    const json = JSON.stringify(["(id=101, weight=1.0, db=analytics_db)"]);
    const { classifiers, isSystemDefault } = parseResourceGroupClassifiers(json);
    expect(isSystemDefault).toBe(false);
    expect(classifiers).toEqual([{ id: "101", weight: "1.0", db: "analytics_db" }]);
  });

  it("parses the ' in ' operator (e.g. query_type in (SELECT))", () => {
    const json = JSON.stringify(["(id=100, weight=3.0, user=alice, query_type in (SELECT))"]);
    const { classifiers } = parseResourceGroupClassifiers(json);
    expect(classifiers).toEqual([
      { id: "100", weight: "3.0", user: "alice", query_type: "(SELECT)" },
    ]);
  });

  it("parses multiple classifiers", () => {
    const json = JSON.stringify([
      "(id=1, weight=1.0, user=alice)",
      "(id=2, weight=1.0, db=mydb)",
    ]);
    const { classifiers } = parseResourceGroupClassifiers(json);
    expect(classifiers).toHaveLength(2);
    expect(classifiers[0].user).toBe("alice");
    expect(classifiers[1].db).toBe("mydb");
  });

  it("drops id/weight-only rules and flags system default", () => {
    const json = JSON.stringify(["(id=0, weight=0.0)"]);
    expect(parseResourceGroupClassifiers(json)).toEqual({ classifiers: [], isSystemDefault: true });
  });

  it("ignores parts with neither '=' nor ' in ' (system default when nothing meaningful)", () => {
    const json = JSON.stringify(["(justword)"]);
    expect(parseResourceGroupClassifiers(json)).toEqual({ classifiers: [], isSystemDefault: true });
  });

  it("keeps meaningful rules while dropping id/weight-only siblings", () => {
    const json = JSON.stringify([
      "(id=0, weight=0.0)",
      "(id=1, weight=1.0, user=bob)",
    ]);
    const { classifiers, isSystemDefault } = parseResourceGroupClassifiers(json);
    expect(isSystemDefault).toBe(false);
    expect(classifiers).toEqual([{ id: "1", weight: "1.0", user: "bob" }]);
  });

  it("handles a classifier whose inner has no matchable parts (empty match → [])", () => {
    // "()" → inner "" → String.match returns null → parts fall back to []
    expect(parseResourceGroupClassifiers(JSON.stringify(["()"]))).toEqual({ classifiers: [], isSystemDefault: true });
  });

  it("returns empty on invalid JSON (parse throws)", () => {
    expect(parseResourceGroupClassifiers("not json{")).toEqual({ classifiers: [], isSystemDefault: false });
  });
});
