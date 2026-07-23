import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, userEvent } from "../../test/test-utils";
import type { MyPermissionsResponse } from "../../api/user";
import { useAuthStore } from "../../stores/authStore";
import type { UserInfo } from "../../types";

// ── API mocks (bare-const wrapper pattern; wrappers defer the read to call-time
//    so declaration order is safe — mirrors ManagePrivilegesModal.test.tsx) ──
const getMyPermissions = vi.fn();
const userGetRoles = vi.fn();
const userGetRoleHierarchy = vi.fn();
const adminGetRoles = vi.fn();
const adminGetRoleHierarchy = vi.fn();

vi.mock("../../api/user", () => ({
  getMyPermissions: (...a: unknown[]) => getMyPermissions(...a),
}));
// Components now resolve getRoles/getRoleHierarchy through usePermApi(). A single
// stable api object (per the real singleton contract) keeps the effect's [permApi]
// dep identity constant; the store is read at call-time to route to the right spy.
vi.mock("../../api/permApi", () => {
  const isAdmin = () => useAuthStore.getState().user?.is_user_admin ?? false;
  const api = {
    getRoles: (...a: unknown[]) => (isAdmin() ? adminGetRoles : userGetRoles)(...a),
    getRoleHierarchy: (...a: unknown[]) => (isAdmin() ? adminGetRoleHierarchy : userGetRoleHierarchy)(...a),
  };
  return { usePermApi: () => api };
});

// Cut the SVG ?raw import chain (inventory-ui → InlineIcon → nodeIcons).
vi.mock("../common/InlineIcon", () => ({ default: () => <span /> }));

// Shallow-stub the detail panel to keep this test focused on the tab itself.
vi.mock("./InventoryDetailPanel", () => ({
  default: ({ item }: { item: { name: string } }) => (
    <div data-testid="detail-panel">{item.name}</div>
  ),
}));

import InventoryTab from "./InventoryTab";

const FIXTURE: MyPermissionsResponse = {
  username: "alice",
  direct_roles: ["analyst"],
  role_tree: {
    analyst: {
      grants: [
        { privilege_type: "SELECT", object_type: "TABLE", object_catalog: "default_catalog", object_database: "sales", object_name: "orders" },
      ],
      parent_roles: [],
    },
    reader: { grants: [], parent_roles: [] },
  },
  effective_privileges: [],
  accessible_catalogs: [{ name: "default_catalog", type: "Internal" }],
  accessible_databases: [
    { name: "sales", catalog: "default_catalog" },
    { name: "analytics_db", catalog: "default_catalog" },
  ],
  accessible_objects: [
    { catalog: "default_catalog", database: "sales", name: "orders", type: "BASE TABLE", rows: 1000, size: 2048 },
    { catalog: "default_catalog", database: "sales", name: "customers", type: "BASE TABLE", rows: 42, size: 1024 },
    { catalog: "default_catalog", database: "analytics_db", name: "daily_report", type: "VIEW" },
    { catalog: "default_catalog", database: "analytics_db", name: "sales_mv", type: "MATERIALIZED VIEW", rows: 10, size: 512 },
    { catalog: "default_catalog", database: "analytics_db", name: "my_udf", type: "FUNCTION", signature: "my_udf(INT)" },
  ],
  system_objects: [],
};

const nonAdminUser: UserInfo = {
  username: "alice", roles: ["analyst"], default_role: "analyst",
  is_user_admin: false, can_manage_grants: false,
};
const adminUser: UserInfo = {
  username: "root", roles: ["root"], default_role: "root",
  is_user_admin: true, can_manage_grants: true,
};

beforeEach(() => {
  vi.clearAllMocks();
  getMyPermissions.mockResolvedValue(FIXTURE);
  userGetRoles.mockResolvedValue([]);
  userGetRoleHierarchy.mockResolvedValue({ nodes: [], edges: [] });
  adminGetRoles.mockResolvedValue([
    { name: "admin_role_a", is_builtin: false },
    { name: "public", is_builtin: true },
  ]);
  adminGetRoleHierarchy.mockResolvedValue({
    nodes: [
      { id: "u1", label: "alice@%", type: "user" },
      { id: "r1", label: "analyst", type: "role" },
    ],
    edges: [],
  });
  useAuthStore.setState({ user: nonAdminUser, isLoggedIn: true, token: "t" });
  window.location.hash = "";
});

afterEach(() => {
  useAuthStore.setState({ user: null, isLoggedIn: false, token: null });
  window.location.hash = "";
});

describe("InventoryTab", () => {
  it("renders sub-tab chips with the correct counts for a non-admin user", async () => {
    render(<InventoryTab />);

    // Loading guard clears only after getMyPermissions resolves.
    expect(await screen.findByText("Tables (2)")).toBeInTheDocument();
    expect(screen.getByText("Roles (2)")).toBeInTheDocument();
    expect(screen.getByText("Users (0)")).toBeInTheDocument();
    expect(screen.getByText("Catalogs (1)")).toBeInTheDocument();
    expect(screen.getByText("Databases (2)")).toBeInTheDocument();
    expect(screen.getByText("MVs (1)")).toBeInTheDocument();
    expect(screen.getByText("Views (1)")).toBeInTheDocument();
    expect(screen.getByText("Functions (1)")).toBeInTheDocument();
  });

  it("shows role rows in the default (roles) sub-tab", async () => {
    render(<InventoryTab />);

    // "analyst" (direct) + "reader" (inherited) derived from role_tree.
    expect(await screen.findByText("analyst")).toBeInTheDocument();
    expect(screen.getByText("reader")).toBeInTheDocument();
    // uses SHOW-based (non-admin) role source, not the admin roles API
    expect(userGetRoles).toHaveBeenCalled();
    expect(adminGetRoles).not.toHaveBeenCalled();
  });

  it("switches to the Tables sub-tab and shows table rows", async () => {
    render(<InventoryTab />);
    await screen.findByText("Tables (2)");

    await userEvent.click(screen.getByText("Tables (2)"));

    expect(await screen.findByText("orders")).toBeInTheDocument();
    expect(screen.getByText("customers")).toBeInTheDocument();
    // roles rows no longer rendered
    expect(screen.queryByText("reader")).not.toBeInTheDocument();
  });

  it("switches to the Catalogs sub-tab and shows catalog rows", async () => {
    render(<InventoryTab />);
    await screen.findByText("Catalogs (1)");

    await userEvent.click(screen.getByText("Catalogs (1)"));

    expect(await screen.findByText("default_catalog")).toBeInTheDocument();
    expect(screen.getByText("Internal")).toBeInTheDocument();
  });

  it("switches to the Databases sub-tab and shows database rows", async () => {
    render(<InventoryTab />);
    await screen.findByText("Databases (2)");

    await userEvent.click(screen.getByText("Databases (2)"));

    expect(await screen.findByText("sales")).toBeInTheDocument();
    expect(screen.getByText("analytics_db")).toBeInTheDocument();
  });

  it("opens the detail panel when a row is clicked", async () => {
    render(<InventoryTab />);
    await screen.findByText("Tables (2)");
    await userEvent.click(screen.getByText("Tables (2)"));
    await screen.findByText("orders");

    await userEvent.click(screen.getByText("orders"));

    const panel = await screen.findByTestId("detail-panel");
    expect(panel).toHaveTextContent("orders");
  });

  it("uses the admin roles API and lists all roles + users for an admin", async () => {
    useAuthStore.setState({ user: adminUser, isLoggedIn: true, token: "t" });
    render(<InventoryTab />);

    // Admin roles come from the admin API (allRoles starts empty, flips on resolve).
    expect(await screen.findByText("admin_role_a")).toBeInTheDocument();
    expect(await screen.findByText("Users (1)")).toBeInTheDocument();
    expect(adminGetRoles).toHaveBeenCalledTimes(1);
    expect(adminGetRoleHierarchy).toHaveBeenCalledTimes(1);
    expect(userGetRoles).not.toHaveBeenCalled();
  });

  it("restores the selected item from the URL hash", async () => {
    window.location.hash = "#myperm/tables/orders?db=sales";
    render(<InventoryTab />);

    const panel = await screen.findByTestId("detail-panel");
    expect(panel).toHaveTextContent("orders");
  });
});
