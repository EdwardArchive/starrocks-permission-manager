import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, userEvent, act } from "../../test/test-utils";
import ManagePrivilegesModal from "./ManagePrivilegesModal";
import { useGrantStore } from "../../stores/grantStore";
import { useAuthStore } from "../../stores/authStore";
import type { PrivilegeGrant } from "../../types";

vi.mock("../../utils/toast", () => ({ showToast: vi.fn() }));

const previewGrant = vi.fn();
const executeGrant = vi.fn();
const getUserPrivileges = vi.fn();
const getRolePrivileges = vi.fn();

vi.mock("../../api/admin", () => ({
  getGrantSpec: () =>
    Promise.resolve({
      object_types: {
        CATALOG: ["USAGE", "CREATE DATABASE", "DROP", "ALL"],
        DATABASE: ["CREATE TABLE", "ALTER", "DROP", "ALL"],
        TABLE: ["SELECT", "INSERT", "UPDATE", "DELETE", "ALTER", "DROP", "EXPORT", "ALL"],
        VIEW: ["SELECT", "ALTER", "DROP", "ALL"],
        "MATERIALIZED VIEW": ["SELECT", "ALTER", "REFRESH", "DROP", "ALL"],
        FUNCTION: ["USAGE", "DROP", "ALL"],
      },
    }),
  getRoles: () => Promise.resolve([{ name: "analyst", is_builtin: false }]),
  searchUsersRoles: () =>
    Promise.resolve([
      { name: "alice", type: "user", catalog: "", database: "", path: "" },
      { name: "analyst", type: "role", catalog: "", database: "", path: "" },
    ]),
  getUserPrivileges: (...args: unknown[]) => getUserPrivileges(...args),
  getRolePrivileges: (...args: unknown[]) => getRolePrivileges(...args),
  previewGrant: (...args: unknown[]) => previewGrant(...args),
  executeGrant: (...args: unknown[]) => executeGrant(...args),
}));

vi.mock("../../api/user", () => ({
  getCatalogs: () => Promise.resolve([{ name: "default_catalog", catalog_type: "Internal" }]),
  getDatabases: () => Promise.resolve([{ name: "sales", catalog: "default_catalog" }]),
  getTables: () => Promise.resolve([{ name: "orders", object_type: "BASE TABLE", catalog: "default_catalog", database: "sales" }]),
}));

function makeGrant(overrides: Partial<PrivilegeGrant> = {}): PrivilegeGrant {
  return {
    grantee: "alice",
    grantee_type: "USER",
    object_catalog: "default_catalog",
    object_database: "sales",
    object_name: "orders",
    object_type: "TABLE",
    privilege_type: "SELECT",
    is_grantable: false,
    source: "direct",
    ...overrides,
  };
}

function openWith(prefill?: Parameters<ReturnType<typeof useGrantStore.getState>["openWizard"]>[0]) {
  act(() => useGrantStore.getState().openWizard(prefill));
}

describe("ManagePrivilegesModal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    previewGrant.mockResolvedValue({ sql: ["SET CATALOG `default_catalog`", "GRANT SELECT ON TABLE `sales`.`orders` TO USER 'alice'@'%'"], warnings: [] });
    executeGrant.mockResolvedValue({ sql: ["..."], status: "ok", audit: "ok" });
    getUserPrivileges.mockResolvedValue([]);
    getRolePrivileges.mockResolvedValue([]);
    useGrantStore.setState({ wizardOpen: false, openId: 0, prefill: null, refreshTick: 0 });
    useAuthStore.setState({
      user: { username: "root", roles: [], default_role: null, is_user_admin: true, can_manage_grants: true },
    });
  });

  it("renders nothing while closed and mounts on openWizard", async () => {
    render(<ManagePrivilegesModal />);
    expect(screen.queryByTestId("mp-modal")).toBeNull();
    openWith();
    expect(await screen.findByTestId("mp-modal")).toBeInTheDocument();
  });

  it("applies a prefill (grantee + object + action + privileges)", async () => {
    render(<ManagePrivilegesModal />);
    openWith({
      action: "REVOKE",
      grantee: { name: "alice", type: "USER" },
      object: { object_type: "TABLE", catalog: "default_catalog", database: "sales", name: "orders" },
      privileges: ["SELECT"],
    });
    expect(await screen.findByTestId("mp-modal")).toBeInTheDocument();
    expect(screen.getByTestId("mp-action-revoke")).toBeChecked();
    expect(screen.getByTestId("mp-grantee-name")).toHaveValue("alice");
    expect(screen.getByTestId("mp-database")).toHaveValue("sales");
    expect(screen.getByTestId("mp-name")).toHaveValue("orders");
  });

  it("shows the privilege checkboxes from the spec and previews on completion", async () => {
    render(<ManagePrivilegesModal />);
    openWith({
      grantee: { name: "alice", type: "USER" },
      object: { object_type: "TABLE", catalog: "default_catalog", database: "sales", name: "orders" },
    });
    const select = await screen.findByTestId("mp-priv-SELECT");
    await userEvent.click(select);
    await waitFor(() => expect(previewGrant).toHaveBeenCalled(), { timeout: 3000 });
    await waitFor(() => expect(screen.getByTestId("mp-preview-sql").textContent).toContain("GRANT SELECT ON TABLE"));
    expect(screen.getByTestId("mp-execute")).toBeEnabled();
  });

  it("presets select intent-level privilege sets and Full shows the danger badge", async () => {
    render(<ManagePrivilegesModal />);
    openWith({
      grantee: { name: "alice", type: "USER" },
      object: { object_type: "TABLE", catalog: "default_catalog", database: "sales", name: "orders" },
    });
    await screen.findByTestId("mp-preset-Read-write");
    await userEvent.click(screen.getByTestId("mp-preset-Read-write"));
    expect(screen.getByTestId("mp-priv-SELECT")).toBeChecked();
    expect(screen.getByTestId("mp-priv-INSERT")).toBeChecked();
    expect(screen.getByTestId("mp-priv-DROP")).not.toBeChecked();

    await userEvent.click(screen.getByTestId("mp-preset-Full"));
    expect(screen.getByTestId("mp-priv-ALL")).toBeChecked();
    expect(screen.getByTestId("mp-danger-badge")).toBeInTheDocument();
  });

  it("marks privileges the grantee already holds on the selected object", async () => {
    getUserPrivileges.mockResolvedValue([makeGrant()]);
    render(<ManagePrivilegesModal />);
    openWith({
      grantee: { name: "alice", type: "USER" },
      object: { object_type: "TABLE", catalog: "default_catalog", database: "sales", name: "orders" },
    });
    expect(await screen.findByTestId("mp-already-granted", {}, { timeout: 3000 })).toBeInTheDocument();
  });

  it("revoke mode lists direct grants for multi-select and updates the execute label", async () => {
    getUserPrivileges.mockResolvedValue([makeGrant(), makeGrant({ privilege_type: "INSERT" })]);
    render(<ManagePrivilegesModal />);
    openWith({ action: "REVOKE", grantee: { name: "alice", type: "USER" } });

    const rows = await screen.findAllByTestId("mp-direct-grant", {}, { timeout: 3000 });
    expect(rows).toHaveLength(2);
    await userEvent.click(rows[0]);
    await waitFor(() => expect(screen.getByTestId("mp-execute").textContent).toContain("Revoke 1 selected"));
    await userEvent.click(rows[1]);
    await waitFor(() => expect(screen.getByTestId("mp-execute").textContent).toContain("Revoke 2 selected"));
  });

  it("shows wildcard scope grants as non-selectable and warns for built-in roles", async () => {
    getRolePrivileges.mockResolvedValue([
      makeGrant({ grantee: "root", grantee_type: "ROLE", object_catalog: null, object_database: null, object_name: null }),
    ]);
    render(<ManagePrivilegesModal />);
    openWith({ action: "REVOKE", grantee: { name: "root", type: "ROLE" } });

    expect(await screen.findByTestId("mp-builtin-warning")).toBeInTheDocument();
    expect(await screen.findByTestId("mp-scope-grant", {}, { timeout: 3000 })).toBeInTheDocument();
    expect(screen.queryByTestId("mp-direct-grant")).toBeNull();
    expect(screen.getByTestId("mp-execute")).toBeDisabled();
  });

  it("inherited grants offer a jump to the source role", async () => {
    getUserPrivileges.mockResolvedValue([makeGrant({ source: "analyst" })]);
    render(<ManagePrivilegesModal />);
    openWith({ action: "REVOKE", grantee: { name: "alice", type: "USER" } });

    const inherited = await screen.findByTestId("mp-inherited-grant", {}, { timeout: 3000 });
    expect(inherited).toBeInTheDocument();
    await userEvent.click(screen.getByText("via analyst →"));
    expect(screen.getByTestId("mp-grantee-name")).toHaveValue("analyst");
    expect(screen.getByTestId("mp-grantee-type-role")).toBeChecked();
  });

  it("role assignment mode previews GRANT role TO USER", async () => {
    render(<ManagePrivilegesModal />);
    openWith({ grantee: { name: "alice", type: "USER" } });
    await screen.findByTestId("mp-type-role");
    await userEvent.click(screen.getByTestId("mp-type-role"));
    await userEvent.type(screen.getByTestId("mp-role"), "analyst");
    await waitFor(() => expect(previewGrant).toHaveBeenCalled(), { timeout: 3000 });
    const req = previewGrant.mock.calls.at(-1)![0];
    expect(req).toMatchObject({ type: "ROLE", role: "analyst", grantee: { name: "alice", type: "USER" } });
  });

  it("executes through the confirmation step and closes on success", async () => {
    render(<ManagePrivilegesModal />);
    openWith({
      grantee: { name: "alice", type: "USER" },
      object: { object_type: "TABLE", catalog: "default_catalog", database: "sales", name: "orders" },
      privileges: ["SELECT"],
    });
    const execute = await screen.findByTestId("mp-execute");
    await waitFor(() => expect(execute).toBeEnabled(), { timeout: 3000 });
    await userEvent.click(execute);
    await userEvent.click(screen.getByTestId("mp-confirm"));
    await waitFor(() => expect(executeGrant).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.queryByTestId("mp-modal")).toBeNull());
    expect(useGrantStore.getState().refreshTick).toBe(1);
  });

  it("keep-open mode stays open and logs results", async () => {
    render(<ManagePrivilegesModal />);
    openWith({
      grantee: { name: "alice", type: "USER" },
      object: { object_type: "TABLE", catalog: "default_catalog", database: "sales", name: "orders" },
      privileges: ["SELECT"],
    });
    const execute = await screen.findByTestId("mp-execute");
    await userEvent.click(screen.getByTestId("mp-keep-open"));
    await waitFor(() => expect(execute).toBeEnabled(), { timeout: 3000 });
    await userEvent.click(execute);
    await userEvent.click(screen.getByTestId("mp-confirm"));
    await waitFor(() => expect(executeGrant).toHaveBeenCalled());
    expect(await screen.findByTestId("mp-results")).toBeInTheDocument();
    expect(screen.getByTestId("mp-modal")).toBeInTheDocument();
  });

  it("self-revoke shows a lockout warning in the confirmation", async () => {
    render(<ManagePrivilegesModal />);
    openWith({
      action: "REVOKE",
      grantee: { name: "root", type: "USER" },
      object: { object_type: "TABLE", catalog: "default_catalog", database: "sales", name: "orders" },
      privileges: ["SELECT"],
    });
    const execute = await screen.findByTestId("mp-execute");
    await waitFor(() => expect(execute).toBeEnabled(), { timeout: 3000 });
    await userEvent.click(execute);
    expect(screen.getByTestId("mp-self-revoke-warning")).toBeInTheDocument();
  });

  it("closes on Escape", async () => {
    render(<ManagePrivilegesModal />);
    openWith();
    await screen.findByTestId("mp-modal");
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByTestId("mp-modal")).toBeNull());
  });
});
