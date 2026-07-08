import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen } from "../../../test/test-utils";
import userEvent from "@testing-library/user-event";
import DetailPanel from "../InventoryDetailPanel";
import * as userApi from "../../../api/user";
import type { MyPermissionsResponse } from "../../../api/user";
import type { SelectedItem } from "../../../utils/inventory-helpers";
import type { TableDetail, PrivilegeGrant, DAGGraph } from "../../../types";

// The pane modules and the router import `../../../api/user` (and, transitively,
// `../common/InlineIcon`); vi.mock replaces the resolved module, so every
// importer — router + panes — sees the mock regardless of its own relative path.
vi.mock("../../../api/user", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../../../api/user")>();
  return {
    ...mod,
    getObjectPrivileges: vi.fn(() => Promise.resolve([])),
    getUserEffectivePrivileges: vi.fn(() => Promise.resolve([])),
    getRolePrivileges: vi.fn(() => Promise.resolve([])),
    getDatabases: vi.fn(() => Promise.resolve([])),
    getTables: vi.fn(() => Promise.resolve([])),
    getTableDetail: vi.fn(() => Promise.resolve(null)),
    getInheritanceDag: vi.fn(() => Promise.resolve({ nodes: [], edges: [] })),
  };
});

vi.mock("../../common/InlineIcon", () => ({
  default: ({ type }: { type: string }) => <span data-testid={`icon-${type}`} />,
}));

const FULL_DETAIL: TableDetail = {
  table_name: "orders", table_type: "BASE TABLE", engine: "OLAP",
  row_count: 1000, data_size: 2048, create_time: "2024-01-01", update_time: "2024-01-02",
  comment: "orders table", key_type: "PRIMARY KEY",
  columns: [{ name: "id", column_type: "INT", ordinal_position: 1, is_nullable: "NO", column_default: null, column_key: "PRI", comment: null }],
  ddl: "CREATE TABLE orders (id INT)",
  distribution_type: "HASH", bucket_keys: ["id"], bucket_count: 8,
  partition_method: "RANGE", partition_key: "dt", partition_count: 4,
  replication_num: 3, storage_medium: "SSD", compression: "LZ4",
};

const ROLE_GRANT: PrivilegeGrant = {
  grantee: "analyst", grantee_type: "ROLE", object_catalog: "default_catalog",
  object_database: "sales", object_name: "orders", object_type: "TABLE",
  privilege_type: "SELECT", is_grantable: false, source: "direct",
};

const USER_GRANT: PrivilegeGrant = {
  grantee: "bob", grantee_type: "USER", object_catalog: "default_catalog",
  object_database: "sales", object_name: "customers", object_type: "TABLE",
  privilege_type: "SELECT", is_grantable: false, source: "analyst",
};

const ROLE_DAG: DAGGraph = {
  nodes: [
    { id: "r_reader", label: "reader", type: "role" },
    { id: "u_alice", label: "alice", type: "user" },
  ],
  edges: [
    { id: "e1", source: "r_analyst", target: "r_reader", edge_type: "inheritance" },
    { id: "e2", source: "r_analyst", target: "u_alice", edge_type: "assignment" },
  ],
};

const myData: MyPermissionsResponse = {
  username: "alice",
  direct_roles: [],
  role_tree: {},
  effective_privileges: [],
  accessible_databases: [],
  accessible_catalogs: [],
  accessible_objects: [
    { catalog: "default_catalog", database: "analytics_db", name: "my_udf", type: "FUNCTION", signature: "my_udf(INT)", return_type: "INT", function_type: "SCALAR" },
  ],
  system_objects: [],
};

const noop = () => {};

beforeEach(() => {
  vi.mocked(userApi.getObjectPrivileges).mockResolvedValue([]);
  vi.mocked(userApi.getTableDetail).mockResolvedValue(FULL_DETAIL);
  vi.mocked(userApi.getDatabases).mockResolvedValue([{ name: "sales", catalog: "default_catalog" }]);
  vi.mocked(userApi.getTables).mockResolvedValue([{ name: "orders", object_type: "BASE TABLE", catalog: "default_catalog", database: "sales" }]);
  vi.mocked(userApi.getRolePrivileges).mockResolvedValue([ROLE_GRANT]);
  vi.mocked(userApi.getUserEffectivePrivileges).mockResolvedValue([USER_GRANT]);
  vi.mocked(userApi.getInheritanceDag).mockResolvedValue(ROLE_DAG);
});

describe("InventoryDetailPanel panes", () => {
  it("objectPanes: table Details renders ObjectDetailsPane sections", async () => {
    const item: SelectedItem = { tab: "tables", name: "orders", catalog: "default_catalog", database: "sales", objectType: "BASE TABLE" };
    render(<DetailPanel item={item} onClose={noop} myData={myData} />);

    await userEvent.click(screen.getByText("Details"));

    expect(await screen.findByText("General")).toBeInTheDocument();
    expect(screen.getByText("Statistics")).toBeInTheDocument();
    expect(screen.getByText("Storage")).toBeInTheDocument();
    expect(screen.getByText("Columns (1)")).toBeInTheDocument();
    expect(screen.getByText("DDL")).toBeInTheDocument();
  });

  it("objectPanes: function Details renders FunctionDetailsPane", async () => {
    const item: SelectedItem = { tab: "functions", name: "my_udf", database: "analytics_db", objectType: "FUNCTION" };
    render(<DetailPanel item={item} onClose={noop} myData={myData} />);

    await userEvent.click(screen.getByText("Details"));

    expect(await screen.findByText("Function Info")).toBeInTheDocument();
    expect(screen.getByText("my_udf(INT)")).toBeInTheDocument();
  });

  it("objectPanes: catalog Objects renders CatalogDatabasesPane", async () => {
    const item: SelectedItem = { tab: "catalogs", name: "default_catalog" };
    render(<DetailPanel item={item} onClose={noop} myData={myData} />);

    await userEvent.click(screen.getByText("Objects"));

    expect(await screen.findByText("Databases (1)")).toBeInTheDocument();
    expect(screen.getByText("sales")).toBeInTheDocument();
  });

  it("objectPanes: database Objects renders DatabaseObjectsPane", async () => {
    const item: SelectedItem = { tab: "databases", name: "sales", catalog: "default_catalog" };
    render(<DetailPanel item={item} onClose={noop} myData={myData} />);

    await userEvent.click(screen.getByText("Objects"));

    expect(await screen.findByText("Objects (1)")).toBeInTheDocument();
    expect(screen.getByText("orders")).toBeInTheDocument();
  });

  it("entityPanes: role Privileges + Members", async () => {
    const item: SelectedItem = { tab: "roles", name: "analyst" };
    render(<DetailPanel item={item} onClose={noop} myData={myData} />);

    expect(await screen.findByText(/Role Privileges/)).toBeInTheDocument();

    await userEvent.click(screen.getByText("Members"));

    expect(await screen.findByText("reader")).toBeInTheDocument();
    expect(screen.getByText("alice")).toBeInTheDocument();
  });

  it("entityPanes: user Privileges + Roles", async () => {
    const item: SelectedItem = { tab: "users", name: "bob" };
    render(<DetailPanel item={item} onClose={noop} myData={myData} />);

    expect(await screen.findByText(/Effective Privileges/)).toBeInTheDocument();

    await userEvent.click(screen.getByText("Roles"));

    expect(await screen.findByText("Assigned Roles (1)")).toBeInTheDocument();
    expect(screen.getByText("analyst")).toBeInTheDocument();
  });

  it("systemPanes: task Privileges renders the TASK required-privileges table verbatim", () => {
    const item: SelectedItem = { tab: "tasks", name: "my_task" };
    render(<DetailPanel item={item} onClose={noop} myData={myData} />);

    expect(screen.getByText("NO DIRECT PRIVILEGES")).toBeInTheDocument();
    expect(screen.getByText("SUBMIT TASK")).toBeInTheDocument();
    expect(screen.getByText("INSERT on target table (+ SELECT for source)")).toBeInTheDocument();
    expect(screen.getByText("DROP TASK")).toBeInTheDocument();
    expect(screen.getByText(/No privilege restriction — use caution/)).toBeInTheDocument();
    expect(screen.getByText("View Tasks")).toBeInTheDocument();
    expect(screen.getByText(/Scheduled tasks run under the creator's privilege context/)).toBeInTheDocument();
  });

  it("systemPanes: pipe Privileges falls back to the PIPE required-privileges table verbatim", async () => {
    const item: SelectedItem = { tab: "pipes", name: "my_pipe" };
    render(<DetailPanel item={item} onClose={noop} myData={myData} />);

    expect(await screen.findByText("NO PRIVILEGE GRANTS FOUND")).toBeInTheDocument();
    expect(screen.getByText("ALTER / SUSPEND / RESUME")).toBeInTheDocument();
    expect(screen.getByText("DROP PIPE")).toBeInTheDocument();
    expect(screen.getByText(/on the database \+ INSERT on target table/)).toBeInTheDocument();
    expect(screen.getByText("View Pipes")).toBeInTheDocument();
    expect(screen.getByText(/Pipes run under the creator's privilege context/)).toBeInTheDocument();
  });
});
