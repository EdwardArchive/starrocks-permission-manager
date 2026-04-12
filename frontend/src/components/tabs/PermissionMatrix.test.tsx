import { describe, it, expect, vi } from "vitest";
import { render, screen } from "../../test/test-utils";
import { GranteeName, PermissionMatrixView } from "./PermissionMatrix";
import type { PrivilegeGrant } from "../../types";

// Mock InlineIcon to avoid SVG ?raw imports
vi.mock("../common/InlineIcon", () => ({
  default: ({ type }: { type: string }) => <span data-testid={`icon-${type}`} />,
}));

function makeGrant(overrides: Partial<PrivilegeGrant> = {}): PrivilegeGrant {
  return {
    grantee: "test_user",
    grantee_type: "USER",
    object_catalog: "default_catalog",
    object_database: "test_db",
    object_name: "my_table",
    object_type: "TABLE",
    privilege_type: "SELECT",
    is_grantable: false,
    source: "direct",
    ...overrides,
  };
}

describe("GranteeName", () => {
  it("renders a simple user name", () => {
    const grants = [makeGrant({ grantee: "admin", grantee_type: "USER" })];
    render(<GranteeName name="admin" grants={grants} />);

    expect(screen.getByText("admin")).toBeInTheDocument();
    expect(screen.getByTestId("icon-user")).toBeInTheDocument();
  });

  it("parses 'user'@'host' format and displays only the username", () => {
    const grants = [makeGrant({ grantee: "'root'@'%'", grantee_type: "USER" })];
    render(<GranteeName name="'root'@'%'" grants={grants} />);

    expect(screen.getByText("root")).toBeInTheDocument();
    // '%' host maps to "ALL CIDR"
    expect(screen.getByText("(ALL CIDR)")).toBeInTheDocument();
    expect(screen.getByTestId("icon-user")).toBeInTheDocument();
  });

  it("renders role type with role icon", () => {
    const grants = [makeGrant({ grantee: "db_admin", grantee_type: "ROLE" })];
    render(<GranteeName name="db_admin" grants={grants} />);

    expect(screen.getByText("db_admin")).toBeInTheDocument();
    expect(screen.getByTestId("icon-role")).toBeInTheDocument();
  });

  it("renders user@host with specific host showing /32 suffix", () => {
    const grants = [makeGrant({ grantee: "'app'@'10.0.0.1'", grantee_type: "USER" })];
    render(<GranteeName name="'app'@'10.0.0.1'" grants={grants} />);

    expect(screen.getByText("app")).toBeInTheDocument();
    expect(screen.getByText("(10.0.0.1/32)")).toBeInTheDocument();
  });
});

describe("PermissionMatrixView", () => {
  it("renders privilege columns for TABLE type", () => {
    const grants = [makeGrant({ privilege_type: "SELECT", source: "direct" })];
    render(<PermissionMatrixView grants={grants} objectType="TABLE" />);

    // TABLE columns: CREATE TABLE → "CREATE", SELECT, INSERT, UPDATE, DELETE, ALTER, DROP, EXPORT
    expect(screen.getByText("Grantee")).toBeInTheDocument();
    expect(screen.getByText("SELECT")).toBeInTheDocument();
    expect(screen.getByText("INSERT")).toBeInTheDocument();
    expect(screen.getByText("DELETE")).toBeInTheDocument();
  });

  it("shows 'D' indicator for direct grants", () => {
    const grants = [makeGrant({ privilege_type: "SELECT", source: "direct" })];
    render(<PermissionMatrixView grants={grants} objectType="TABLE" />);

    const badges = screen.getAllByText("D");
    expect(badges.length).toBeGreaterThanOrEqual(1);
  });

  it("shows 'I' indicator for inherited grants", () => {
    const grants = [makeGrant({ privilege_type: "SELECT", source: "inherited" })];
    render(<PermissionMatrixView grants={grants} objectType="TABLE" />);

    const badges = screen.getAllByText("I");
    expect(badges.length).toBeGreaterThanOrEqual(1);
  });

  it("shows empty state when no grants are provided", () => {
    render(<PermissionMatrixView grants={[]} objectType="TABLE" />);

    expect(screen.getByText("No privilege grants found")).toBeInTheDocument();
  });

  it("renders multiple grantees in separate rows", () => {
    const grants = [
      makeGrant({ grantee: "user_a", privilege_type: "SELECT", source: "direct" }),
      makeGrant({ grantee: "user_b", privilege_type: "INSERT", source: "direct" }),
    ];
    render(<PermissionMatrixView grants={grants} objectType="TABLE" />);

    expect(screen.getByText("user_a")).toBeInTheDocument();
    expect(screen.getByText("user_b")).toBeInTheDocument();
  });

  it("renders 'All Roles' and 'All Users' rows when public role has grants", () => {
    const grants = [
      makeGrant({ grantee: "public", grantee_type: "ROLE", privilege_type: "SELECT", source: "direct" }),
      makeGrant({ grantee: "admin_user", grantee_type: "USER", privilege_type: "INSERT", source: "direct" }),
    ];
    render(<PermissionMatrixView grants={grants} objectType="TABLE" />);

    expect(screen.getByText("All Roles")).toBeInTheDocument();
    expect(screen.getByText("All Users")).toBeInTheDocument();
    // admin_user should still appear since they have INSERT (not just public's SELECT)
    expect(screen.getByText("admin_user")).toBeInTheDocument();
  });
});
