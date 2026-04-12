import { describe, it, expect, vi } from "vitest";
import { render, screen } from "../../test/test-utils";
import userEvent from "@testing-library/user-event";
import DetailPanel from "./InventoryDetailPanel";
import type { MyPermissionsResponse } from "../../api/user";
import type { SelectedItem } from "../../utils/inventory-helpers";

// Mock API calls used by DetailPanel sub-panes
vi.mock("../../api/user", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../../api/user")>();
  return {
    ...mod,
    getObjectPrivileges: vi.fn(() => Promise.resolve([])),
    getUserEffectivePrivileges: vi.fn(() => Promise.resolve([])),
    getRolePrivileges: vi.fn(() => Promise.resolve([])),
    getDatabases: vi.fn(() => Promise.resolve([])),
    getTables: vi.fn(() => Promise.resolve([])),
    getTableDetail: vi.fn(() => Promise.resolve(null)),
  };
});

vi.mock("../common/InlineIcon", () => ({
  default: ({ type }: { type: string }) => <span data-testid={`icon-${type}`} />,
}));

const makeMyData = (systemObjects: Record<string, string>[]): MyPermissionsResponse => ({
  username: "alice",
  direct_roles: [],
  role_tree: {},
  effective_privileges: [],
  accessible_databases: [],
  accessible_catalogs: [],
  accessible_objects: [],
  system_objects: systemObjects,
});

const rgItem: SelectedItem = { tab: "rgroups", name: "rg_analytics" };

describe("DetailPanel — Resource Group Info", () => {
  it("shows resource limit fields in detail panel", async () => {
    const myData = makeMyData([{
      name: "rg_analytics", type: "RESOURCE_GROUP",
      cpu_weight: "10", mem_limit: "20%", concurrency_limit: "15",
      exclusive_cpu_cores: "0", big_query_cpu_second_limit: "100",
      big_query_scan_rows_limit: "0", big_query_mem_limit: "0",
      spill_mem_limit_threshold: "0.8",
      classifiers: "[]",
    }]);

    render(<DetailPanel item={rgItem} onClose={() => {}} myData={myData} />);

    // Switch to Info tab
    const infoTab = screen.getByText("Info");
    await userEvent.click(infoTab);

    expect(screen.getByText("CPU Weight")).toBeInTheDocument();
    expect(screen.getByText("10")).toBeInTheDocument();
    expect(screen.getByText("Memory Limit")).toBeInTheDocument();
    expect(screen.getByText("20%")).toBeInTheDocument();
    expect(screen.getByText("Concurrency Limit")).toBeInTheDocument();
    expect(screen.getByText("15")).toBeInTheDocument();
    expect(screen.getByText("Big Query CPU Limit")).toBeInTheDocument();
    expect(screen.getByText("Spill Threshold")).toBeInTheDocument();
  });

  it("hides zero-value resource limit fields", async () => {
    const myData = makeMyData([{
      name: "rg_analytics", type: "RESOURCE_GROUP",
      cpu_weight: "10", mem_limit: "20%", concurrency_limit: "0",
      exclusive_cpu_cores: "0", big_query_cpu_second_limit: "0",
      big_query_scan_rows_limit: "0", big_query_mem_limit: "0",
      spill_mem_limit_threshold: "0",
      classifiers: "[]",
    }]);

    render(<DetailPanel item={rgItem} onClose={() => {}} myData={myData} />);
    await userEvent.click(screen.getByText("Info"));

    expect(screen.queryByText("Concurrency Limit")).not.toBeInTheDocument();
    expect(screen.queryByText("Exclusive CPU Cores")).not.toBeInTheDocument();
    expect(screen.queryByText("Big Query CPU Limit")).not.toBeInTheDocument();
  });

  it("shows Assigned To with parsed classifier rules", async () => {
    const classifiers = JSON.stringify([
      "(id=100, weight=3.0, user=alice, query_type in (SELECT))",
      "(id=101, weight=1.0, db=analytics_db)",
    ]);
    const myData = makeMyData([{
      name: "rg_analytics", type: "RESOURCE_GROUP",
      cpu_weight: "10", mem_limit: "20%", concurrency_limit: "0",
      classifiers,
    }]);

    render(<DetailPanel item={rgItem} onClose={() => {}} myData={myData} />);
    await userEvent.click(screen.getByText("Info"));

    expect(screen.getByText("Assigned To (2)")).toBeInTheDocument();
    expect(screen.getByText("Rule 1")).toBeInTheDocument();
    expect(screen.getByText("Rule 2")).toBeInTheDocument();
    expect(screen.getByText("User")).toBeInTheDocument();
    expect(screen.getByText("alice")).toBeInTheDocument();
    expect(screen.getByText("Database")).toBeInTheDocument();
    expect(screen.getByText("analytics_db")).toBeInTheDocument();
  });

  it("highlights current user with YOU badge", async () => {
    const classifiers = JSON.stringify([
      "(id=100, weight=1.0, user=alice)",
    ]);
    const myData = makeMyData([{
      name: "rg_analytics", type: "RESOURCE_GROUP",
      cpu_weight: "10", mem_limit: "20%", concurrency_limit: "0",
      classifiers,
    }]);

    render(<DetailPanel item={rgItem} onClose={() => {}} myData={myData} />);
    await userEvent.click(screen.getByText("Info"));

    expect(screen.getByText("YOU")).toBeInTheDocument();
  });

  it("filters out id/weight-only classifiers and shows system default message", async () => {
    const classifiers = JSON.stringify([
      "(id=0, weight=0.0)",
    ]);
    const myData = makeMyData([{
      name: "default_wg", type: "RESOURCE_GROUP",
      cpu_weight: "32", mem_limit: "100%", concurrency_limit: "0",
      classifiers,
    }]);
    const item: SelectedItem = { tab: "rgroups", name: "default_wg" };

    render(<DetailPanel item={item} onClose={() => {}} myData={myData} />);
    await userEvent.click(screen.getByText("Info"));

    expect(screen.getByText(/System default/)).toBeInTheDocument();
    expect(screen.getByText(/automatically assigned to unmatched queries/)).toBeInTheDocument();
  });

  it("shows 'No assignments defined' when classifiers is empty", async () => {
    const myData = makeMyData([{
      name: "rg_analytics", type: "RESOURCE_GROUP",
      cpu_weight: "10", mem_limit: "20%", concurrency_limit: "0",
      classifiers: "[]",
    }]);

    render(<DetailPanel item={rgItem} onClose={() => {}} myData={myData} />);
    await userEvent.click(screen.getByText("Info"));

    expect(screen.getByText("No assignments defined")).toBeInTheDocument();
  });

  it("paginates classifiers with 3 per page", async () => {
    const classifiers = JSON.stringify([
      "(id=1, weight=1.0, user=alice)",
      "(id=2, weight=1.0, user=bob)",
      "(id=3, weight=1.0, user=carol)",
      "(id=4, weight=1.0, user=dave)",
    ]);
    const myData = makeMyData([{
      name: "rg_analytics", type: "RESOURCE_GROUP",
      cpu_weight: "10", mem_limit: "20%", concurrency_limit: "0",
      classifiers,
    }]);

    render(<DetailPanel item={rgItem} onClose={() => {}} myData={myData} />);
    await userEvent.click(screen.getByText("Info"));

    // Page 1: Rules 1-3
    expect(screen.getByText("Assigned To (4)")).toBeInTheDocument();
    expect(screen.getByText("1/2")).toBeInTheDocument();
    expect(screen.getByText("Rule 1")).toBeInTheDocument();
    expect(screen.getByText("Rule 2")).toBeInTheDocument();
    expect(screen.getByText("Rule 3")).toBeInTheDocument();
    expect(screen.queryByText("Rule 4")).not.toBeInTheDocument();

    // Navigate to page 2
    await userEvent.click(screen.getByText("▶"));
    expect(screen.getByText("2/2")).toBeInTheDocument();
    expect(screen.getByText("Rule 4")).toBeInTheDocument();
    expect(screen.queryByText("Rule 1")).not.toBeInTheDocument();
  });

  it("uses human-readable labels for classifier keys", async () => {
    const classifiers = JSON.stringify([
      "(id=1, weight=1.0, user=alice, role=analyst, query_type in (SELECT), source_ip=10.0.0.0/8, db=mydb)",
    ]);
    const myData = makeMyData([{
      name: "rg_analytics", type: "RESOURCE_GROUP",
      cpu_weight: "10", mem_limit: "20%", concurrency_limit: "0",
      classifiers,
    }]);

    render(<DetailPanel item={rgItem} onClose={() => {}} myData={myData} />);
    await userEvent.click(screen.getByText("Info"));

    expect(screen.getByText("User")).toBeInTheDocument();
    expect(screen.getByText("Role")).toBeInTheDocument();
    expect(screen.getByText("Query Type")).toBeInTheDocument();
    expect(screen.getByText("Source IP")).toBeInTheDocument();
    expect(screen.getByText("Database")).toBeInTheDocument();
  });
});
