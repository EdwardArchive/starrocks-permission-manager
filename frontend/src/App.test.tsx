import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, waitFor, userEvent } from "./test/test-utils";
import { useAuthStore } from "./stores/authStore";
import { useDagStore } from "./stores/dagStore";
import type { UserInfo } from "./types";

// getMe stays pending: exercises the "restoring session" branch without a
// trailing state update (no uncontrolled act warning).
vi.mock("./api/auth", () => ({
  getMe: vi.fn(() => new Promise(() => {})),
}));
// DAG fetchers resolve to empty graphs so the obj/role effect's `.then` is safe.
vi.mock("./api/user", () => ({
  getObjectHierarchy: vi.fn(() => Promise.resolve({ nodes: [], edges: [] })),
  getRoleHierarchy: vi.fn(() => Promise.resolve({ nodes: [], edges: [] })),
}));
vi.mock("./api/admin", () => ({
  getObjectHierarchy: vi.fn(() => Promise.resolve({ nodes: [], edges: [] })),
  getRoleHierarchy: vi.fn(() => Promise.resolve({ nodes: [], edges: [] })),
}));

// nodeIcons pulls SVG ?raw imports that do not load under jsdom.
vi.mock("./components/dag/nodeIcons", () => ({ NODE_COLORS: {}, colorizedSvg: () => "" }));

// ReactFlowProvider passthrough (DAGView itself is stubbed below).
vi.mock("@xyflow/react", () => ({
  ReactFlowProvider: ({ children }: { children?: unknown }) => <>{children as never}</>,
}));

// Stub every child component so the test is about App's own routing/gating.
vi.mock("./components/auth/LoginForm", () => ({ default: () => <div data-testid="login-form" /> }));
vi.mock("./components/layout/Header", () => ({ default: () => <div data-testid="header" /> }));
vi.mock("./components/layout/Sidebar", () => ({ default: () => <div data-testid="sidebar" /> }));
vi.mock("./components/dag/DAGView", () => ({ default: () => <div data-testid="dag-view" /> }));
vi.mock("./components/cluster/ClusterDrawer", () => ({ default: () => <div data-testid="cluster-drawer" /> }));
vi.mock("./components/grants/ManagePrivilegesModal", () => ({ default: () => <div data-testid="manage-privs" /> }));
vi.mock("./components/tabs/PermissionDetailTab", () => ({ default: () => <div data-testid="perm-tab" /> }));
vi.mock("./components/tabs/InventoryTab", () => ({ default: () => <div data-testid="inventory-tab" /> }));
vi.mock("./components/tabs/AuditTab", () => ({ default: () => <div data-testid="audit-tab" /> }));
vi.mock("./components/tabs/ClusterTab", () => ({ default: () => <div data-testid="cluster-tab" /> }));
vi.mock("./components/common/ExportPngBtn", () => ({ default: () => <div data-testid="export-png" /> }));
vi.mock("./components/panels/ObjectDetailPanel", () => ({ default: () => <div /> }));
vi.mock("./components/panels/UserDetailPanel", () => ({ default: () => <div /> }));
vi.mock("./components/panels/GroupDetailPanel", () => ({ default: () => <div /> }));

import App from "./App";

const nonAdmin: UserInfo = {
  username: "alice", roles: ["analyst"], default_role: "analyst",
  is_user_admin: false, can_manage_grants: false,
};
const admin: UserInfo = {
  username: "admin", roles: ["db_admin"], default_role: "db_admin",
  is_user_admin: true, can_manage_grants: false,
};
const grantAdmin: UserInfo = {
  username: "root", roles: ["root"], default_role: "root",
  is_user_admin: true, can_manage_grants: true,
};

function login(user: UserInfo, tab: "obj" | "role" | "perm" | "myperm" | "audit" | "cluster" = "myperm") {
  useAuthStore.setState({ user, isLoggedIn: true, token: "t" });
  useDagStore.setState({ activeTab: tab });
}

beforeEach(() => {
  localStorage.clear();
  window.location.hash = "";
  useDagStore.setState({ activeTab: "myperm", activeCatalog: "default_catalog", panelMode: null, dagData: null });
  useAuthStore.setState({ user: null, isLoggedIn: false, token: null, connectionInfo: null });
});

afterEach(() => {
  window.location.hash = "";
  useDagStore.setState({ activeTab: "obj", panelMode: null });
  useAuthStore.setState({ user: null, isLoggedIn: false, token: null, connectionInfo: null });
});

describe("App", () => {
  it("renders the LoginForm when logged out", () => {
    useAuthStore.setState({ isLoggedIn: false, user: null });
    render(<App />);
    expect(screen.getByTestId("login-form")).toBeInTheDocument();
    expect(screen.queryByTestId("header")).not.toBeInTheDocument();
  });

  it("shows a loader while restoring an existing session", () => {
    useAuthStore.setState({ isLoggedIn: true, user: null, token: "t" });
    localStorage.setItem("sr_token", "t");
    render(<App />);
    expect(screen.getByText("Loading...")).toBeInTheDocument();
    expect(screen.queryByTestId("login-form")).not.toBeInTheDocument();
  });

  it("renders the main layout with the base tab bar for a logged-in user", () => {
    login(nonAdmin);
    render(<App />);
    expect(screen.getByTestId("header")).toBeInTheDocument();
    expect(screen.getByText("Object Hierarchy")).toBeInTheDocument();
    expect(screen.getByText("Role Map")).toBeInTheDocument();
    expect(screen.getByText("My Inventory Search")).toBeInTheDocument();
    expect(screen.getByText("Cluster Monitor")).toBeInTheDocument();
    // active content = InventoryTab (activeTab "myperm")
    expect(screen.getByTestId("inventory-tab")).toBeInTheDocument();
  });

  it("hides Permission Focus and Grant Audit tabs for a non-admin", () => {
    login(nonAdmin);
    render(<App />);
    expect(screen.queryByText("Permission Focus")).not.toBeInTheDocument();
    expect(screen.queryByText("Grant Audit")).not.toBeInTheDocument();
  });

  it("shows the Permission Focus tab for an admin (but not Grant Audit without grant rights)", () => {
    login(admin);
    render(<App />);
    expect(screen.getByText("Permission Focus")).toBeInTheDocument();
    expect(screen.queryByText("Grant Audit")).not.toBeInTheDocument();
  });

  it("shows the Grant Audit tab for a grant-admin", () => {
    login(grantAdmin);
    render(<App />);
    expect(screen.getByText("Permission Focus")).toBeInTheDocument();
    expect(screen.getByText("Grant Audit")).toBeInTheDocument();
  });

  it("routes to the Cluster Monitor content when activeTab is cluster", () => {
    login(nonAdmin, "cluster");
    render(<App />);
    expect(screen.getByTestId("cluster-tab")).toBeInTheDocument();
  });

  it("routes to PermissionDetailTab for an admin on the perm tab", () => {
    login(admin, "perm");
    render(<App />);
    expect(screen.getByTestId("perm-tab")).toBeInTheDocument();
  });

  it("routes to AuditTab for a grant-admin on the audit tab", () => {
    login(grantAdmin, "audit");
    render(<App />);
    expect(screen.getByTestId("audit-tab")).toBeInTheDocument();
  });

  it("renders the DAG view and sidebar on the Object Hierarchy tab", async () => {
    login(nonAdmin, "obj");
    render(<App />);
    // findBy absorbs the async DAG fetch state update inside act.
    expect(await screen.findByTestId("dag-view")).toBeInTheDocument();
    expect(screen.getByTestId("sidebar")).toBeInTheDocument();
    expect(screen.getByTestId("export-png")).toBeInTheDocument();
  });

  it("redirects a non-admin away from a restricted (perm) tab", async () => {
    login(nonAdmin, "perm");
    render(<App />);
    await waitFor(() => expect(useDagStore.getState().activeTab).toBe("obj"));
    expect(screen.getByTestId("dag-view")).toBeInTheDocument();
  });

  it("switches the active content when a tab button is clicked", async () => {
    login(nonAdmin);
    render(<App />);
    expect(screen.getByTestId("inventory-tab")).toBeInTheDocument();

    await userEvent.click(screen.getByText("Cluster Monitor"));

    expect(screen.getByTestId("cluster-tab")).toBeInTheDocument();
    expect(screen.queryByTestId("inventory-tab")).not.toBeInTheDocument();
  });
});
