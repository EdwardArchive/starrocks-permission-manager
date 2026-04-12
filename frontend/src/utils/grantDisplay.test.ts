import { describe, it, expect } from "vitest";
import { buildGrantDisplay, extractSourceRoles } from "./grantDisplay";
import type { PrivilegeGrant } from "../types";

/** Helper to build a minimal PrivilegeGrant for tests. */
function grant(overrides: Partial<PrivilegeGrant> = {}): PrivilegeGrant {
  return {
    grantee: "test_user",
    grantee_type: "USER",
    object_catalog: null,
    object_database: null,
    object_name: null,
    object_type: "SYSTEM",
    privilege_type: "GRANT",
    is_grantable: false,
    source: "direct",
    ...overrides,
  };
}

// ── Basic grouping ──

describe("buildGrantDisplay", () => {
  describe("basic grouping", () => {
    it("returns empty array for empty grants", () => {
      expect(buildGrantDisplay([])).toEqual([]);
    });

    it("groups grants by object_type scope", () => {
      const grants = [
        grant({ object_type: "TABLE", privilege_type: "SELECT", object_name: "t1", object_database: "db1" }),
        grant({ object_type: "DATABASE", privilege_type: "USAGE", object_database: "db1" }),
      ];
      const result = buildGrantDisplay(grants, { addImplicitUsage: false });
      const scopes = result.map((g) => g.scope);
      expect(scopes).toContain("TABLE");
      expect(scopes).toContain("DATABASE");
    });

    it("merges privileges for same displayName within a scope", () => {
      const grants = [
        grant({ object_type: "TABLE", privilege_type: "SELECT", object_name: "t1", object_database: "db1" }),
        grant({ object_type: "TABLE", privilege_type: "INSERT", object_name: "t1", object_database: "db1" }),
      ];
      const result = buildGrantDisplay(grants, { addImplicitUsage: false });
      const tableGroup = result.find((g) => g.scope === "TABLE");
      expect(tableGroup!.items).toHaveLength(1);
      expect(tableGroup!.items[0].privs).toContain("SELECT");
      expect(tableGroup!.items[0].privs).toContain("INSERT");
    });

    it("deduplicates identical privilege_type entries", () => {
      const grants = [
        grant({ object_type: "TABLE", privilege_type: "SELECT", object_name: "t1", object_database: "db1" }),
        grant({ object_type: "TABLE", privilege_type: "SELECT", object_name: "t1", object_database: "db1" }),
      ];
      const result = buildGrantDisplay(grants, { addImplicitUsage: false });
      const tableGroup = result.find((g) => g.scope === "TABLE");
      expect(tableGroup!.items[0].privs).toEqual(["SELECT"]);
    });
  });

  // ── Display name construction ──

  describe("display name construction", () => {
    it("uses object_name as displayName when present", () => {
      const result = buildGrantDisplay(
        [grant({ object_type: "TABLE", privilege_type: "SELECT", object_name: "products", object_database: "db1" })],
        { addImplicitUsage: false },
      );
      expect(result.find((g) => g.scope === "TABLE")!.items[0].displayName).toBe("products");
    });

    it("builds context as catalog.database when both exist", () => {
      const result = buildGrantDisplay(
        [grant({ object_type: "TABLE", privilege_type: "SELECT", object_name: "t1", object_catalog: "cat1", object_database: "db1" })],
        { addImplicitUsage: false },
      );
      expect(result.find((g) => g.scope === "TABLE")!.items[0].context).toBe("cat1.db1");
    });

    it("builds ALL TABLES IN {db} when object_name is null but database exists", () => {
      const result = buildGrantDisplay(
        [grant({ object_type: "TABLE", privilege_type: "SELECT", object_name: null, object_database: "db1" })],
        { addImplicitUsage: false },
      );
      expect(result.find((g) => g.scope === "TABLE")!.items[0].displayName).toBe("ALL TABLES IN db1");
    });

    it("builds ALL DATABASES for DATABASE scope with no db/name", () => {
      const result = buildGrantDisplay(
        [grant({ object_type: "DATABASE", privilege_type: "USAGE" })],
        { addImplicitUsage: false },
      );
      expect(result.find((g) => g.scope === "DATABASE")!.items[0].displayName).toBe("ALL DATABASES");
    });

    it("builds ALL CATALOGS for CATALOG scope", () => {
      const result = buildGrantDisplay(
        [grant({ object_type: "CATALOG", privilege_type: "USAGE" })],
        { addImplicitUsage: false },
      );
      expect(result.find((g) => g.scope === "CATALOG")!.items[0].displayName).toBe("ALL CATALOGS");
    });

    it("builds SYSTEM display name for SYSTEM scope", () => {
      const result = buildGrantDisplay([grant({ object_type: "SYSTEM", privilege_type: "GRANT" })]);
      expect(result.find((g) => g.scope === "SYSTEM")!.items[0].displayName).toBe("SYSTEM");
    });
  });

  // ── Implicit USAGE ──

  describe("implicit USAGE", () => {
    it("adds implicit DATABASE USAGE when TABLE grant has object_database", () => {
      const result = buildGrantDisplay([
        grant({ object_type: "TABLE", privilege_type: "SELECT", object_name: "t1", object_database: "db1", object_catalog: "cat1" }),
      ]);
      const dbGroup = result.find((g) => g.scope === "DATABASE");
      expect(dbGroup).toBeDefined();
      expect(dbGroup!.items.some((i) => i.privs.includes("USAGE (implicit)"))).toBe(true);
    });

    it("adds implicit CATALOG USAGE when TABLE grant has object_catalog", () => {
      const result = buildGrantDisplay([
        grant({ object_type: "TABLE", privilege_type: "SELECT", object_name: "t1", object_database: "db1", object_catalog: "cat1" }),
      ]);
      const catGroup = result.find((g) => g.scope === "CATALOG");
      expect(catGroup).toBeDefined();
      expect(catGroup!.items.some((i) => i.privs.includes("USAGE (implicit)"))).toBe(true);
    });

    it("does NOT add implicit USAGE when explicit USAGE already exists", () => {
      const result = buildGrantDisplay([
        grant({ object_type: "TABLE", privilege_type: "SELECT", object_name: "t1", object_database: "db1" }),
        grant({ object_type: "DATABASE", privilege_type: "USAGE", object_database: "db1", object_name: "db1" }),
      ]);
      const dbGroup = result.find((g) => g.scope === "DATABASE")!;
      const implicitItems = dbGroup.items.filter((i) => i.privs.includes("USAGE (implicit)"));
      expect(implicitItems).toHaveLength(0);
    });

    it("skips implicit USAGE when addImplicitUsage is false", () => {
      const result = buildGrantDisplay(
        [grant({ object_type: "TABLE", privilege_type: "SELECT", object_name: "t1", object_database: "db1" })],
        { addImplicitUsage: false },
      );
      const dbGroup = result.find((g) => g.scope === "DATABASE");
      expect(dbGroup).toBeUndefined();
    });
  });

  // ── CREATE mirroring ──

  describe("CREATE privilege mirroring", () => {
    it("mirrors CREATE TABLE from DATABASE scope to TABLE section", () => {
      const result = buildGrantDisplay(
        [grant({ object_type: "DATABASE", privilege_type: "CREATE TABLE", object_database: "db1" })],
        { addImplicitUsage: false },
      );
      const tableGroup = result.find((g) => g.scope === "TABLE");
      expect(tableGroup).toBeDefined();
      expect(tableGroup!.items.some((i) => i.displayName.includes("CREATE in"))).toBe(true);
    });

    it("mirrors CREATE VIEW from DATABASE scope to VIEW section", () => {
      const result = buildGrantDisplay(
        [grant({ object_type: "DATABASE", privilege_type: "CREATE VIEW", object_database: "db1" })],
        { addImplicitUsage: false },
      );
      const viewGroup = result.find((g) => g.scope === "VIEW");
      expect(viewGroup).toBeDefined();
      expect(viewGroup!.items.some((i) => i.displayName.includes("CREATE in"))).toBe(true);
    });

    it("mirrors SYSTEM CREATE RESOURCE GROUP to RESOURCE GROUP section", () => {
      const result = buildGrantDisplay(
        [grant({ object_type: "SYSTEM", privilege_type: "CREATE RESOURCE GROUP" })],
      );
      const rgGroup = result.find((g) => g.scope === "RESOURCE GROUP");
      expect(rgGroup).toBeDefined();
      expect(rgGroup!.items.some((i) => i.displayName === "CREATE (system)")).toBe(true);
    });

    it("mirrors SYSTEM CREATE EXTERNAL CATALOG to CATALOG section", () => {
      const result = buildGrantDisplay(
        [grant({ object_type: "SYSTEM", privilege_type: "CREATE EXTERNAL CATALOG" })],
      );
      const catGroup = result.find((g) => g.scope === "CATALOG");
      expect(catGroup).toBeDefined();
      expect(catGroup!.items.some((i) => i.displayName === "CREATE (system)")).toBe(true);
    });
  });

  // ── Scope sorting ──

  describe("scope sorting", () => {
    it("sorts scopes according to SCOPE_ORDER", () => {
      const grants = [
        grant({ object_type: "TABLE", privilege_type: "SELECT", object_name: "t1", object_database: "db1" }),
        grant({ object_type: "SYSTEM", privilege_type: "GRANT" }),
        grant({ object_type: "DATABASE", privilege_type: "USAGE", object_name: "db1" }),
      ];
      const result = buildGrantDisplay(grants, { addImplicitUsage: false });
      const scopes = result.map((g) => g.scope);
      const sysIdx = scopes.indexOf("SYSTEM");
      const dbIdx = scopes.indexOf("DATABASE");
      const tblIdx = scopes.indexOf("TABLE");
      expect(sysIdx).toBeLessThan(dbIdx);
      expect(dbIdx).toBeLessThan(tblIdx);
    });

    it("places unknown scopes after known ones", () => {
      const grants = [
        grant({ object_type: "UNKNOWN_TYPE", privilege_type: "USAGE" }),
        grant({ object_type: "SYSTEM", privilege_type: "GRANT" }),
      ];
      const result = buildGrantDisplay(grants);
      const scopes = result.map((g) => g.scope);
      expect(scopes.indexOf("SYSTEM")).toBeLessThan(scopes.indexOf("UNKNOWN_TYPE"));
    });
  });

  // ── Search filter ──

  describe("search filtering", () => {
    const baseGrants = [
      grant({ object_type: "TABLE", privilege_type: "SELECT", object_name: "products", object_database: "shop_db" }),
      grant({ object_type: "TABLE", privilege_type: "INSERT", object_name: "orders", object_database: "shop_db" }),
      grant({ object_type: "DATABASE", privilege_type: "USAGE", object_name: "analytics_db" }),
    ];

    it("filters grants by displayName substring (case-insensitive)", () => {
      const result = buildGrantDisplay(baseGrants, { filter: "prod", addImplicitUsage: false });
      expect(result).toHaveLength(1);
      expect(result[0].items[0].displayName).toBe("products");
    });

    it("filters grants by privilege_type", () => {
      const result = buildGrantDisplay(baseGrants, { filter: "insert", addImplicitUsage: false });
      expect(result).toHaveLength(1);
      expect(result[0].items[0].displayName).toBe("orders");
    });

    it("filters grants by scope name", () => {
      const result = buildGrantDisplay(baseGrants, { filter: "database", addImplicitUsage: false });
      expect(result).toHaveLength(1);
      expect(result[0].scope).toBe("DATABASE");
    });

    it("returns empty array when filter matches nothing", () => {
      const result = buildGrantDisplay(baseGrants, { filter: "zzz_no_match", addImplicitUsage: false });
      expect(result).toEqual([]);
    });
  });

  // ── Icon mapping ──

  describe("icon mapping", () => {
    it("assigns correct icon for known scopes", () => {
      const result = buildGrantDisplay([
        grant({ object_type: "TABLE", privilege_type: "SELECT", object_name: "t1", object_database: "db1" }),
      ], { addImplicitUsage: false });
      expect(result.find((g) => g.scope === "TABLE")!.icon).toBe("table");
    });

    it("defaults to system for unknown scopes", () => {
      const result = buildGrantDisplay([
        grant({ object_type: "UNKNOWN_TYPE", privilege_type: "USAGE" }),
      ]);
      expect(result.find((g) => g.scope === "UNKNOWN_TYPE")!.icon).toBe("system");
    });
  });
});

// ── extractSourceRoles ──

describe("extractSourceRoles", () => {
  it("returns empty array when all grants are direct", () => {
    const grants = [
      grant({ source: "direct" }),
      grant({ source: "direct" }),
    ];
    expect(extractSourceRoles(grants)).toEqual([]);
  });

  it("extracts unique role names from non-direct sources", () => {
    const grants = [
      grant({ source: "direct" }),
      grant({ source: "role_admin" }),
      grant({ source: "db_reader" }),
    ];
    const roles = extractSourceRoles(grants);
    expect(roles).toContain("role_admin");
    expect(roles).toContain("db_reader");
    expect(roles).not.toContain("direct");
  });

  it("deduplicates role names", () => {
    const grants = [
      grant({ source: "role_admin" }),
      grant({ source: "role_admin" }),
      grant({ source: "role_admin" }),
    ];
    expect(extractSourceRoles(grants)).toEqual(["role_admin"]);
  });
});
