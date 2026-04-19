import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, act } from "../../test/test-utils";
import ClusterDrawer from "./ClusterDrawer";
import { useClusterStore } from "../../stores/clusterStore";
import type { ClusterStatusResponse } from "../../types";

/* ── Mocks ── */

const mockGetClusterStatus = vi.fn();
vi.mock("../../api/cluster", () => ({
  getClusterStatus: (...args: unknown[]) => mockGetClusterStatus(...args),
}));

vi.mock("../dag/nodeIcons", () => ({
  colorizedSvg: (type: string) =>
    `<svg width="24" height="24"><circle data-type="${type}"/></svg>`,
  NODE_SVG_RAW: {},
  NODE_COLORS: {},
  APP_LOGO_SVG: '<svg width="24" height="24"></svg>',
}));

/* ── Test data factories ── */

function makeFENode(
  overrides: Partial<ClusterStatusResponse["frontends"][0]> = {},
): ClusterStatusResponse["frontends"][0] {
  return {
    name: "fe-01",
    ip: "10.0.0.1",
    edit_log_port: 9010,
    http_port: 8030,
    query_port: 9030,
    rpc_port: 9020,
    role: "LEADER",
    alive: true,
    join: true,
    last_heartbeat: null,
    replayed_journal_id: 12345,
    start_time: "2026-04-19 10:00:00",
    version: "3.3.0",
    err_msg: null,
    jvm_heap_used_pct: 45.2,
    gc_young_count: 10,
    gc_young_time_ms: 500,
    gc_old_count: 1,
    gc_old_time_ms: 200,
    query_p99_ms: 15.3,
    metrics_error: null,
    ...overrides,
  };
}

function makeBENode(
  overrides: Partial<ClusterStatusResponse["backends"][0]> = {},
): ClusterStatusResponse["backends"][0] {
  return {
    name: "be-01",
    ip: "10.0.0.2",
    node_type: "backend",
    heartbeat_port: 9050,
    be_port: 9060,
    http_port: 8040,
    brpc_port: 8060,
    alive: true,
    last_heartbeat: null,
    last_start_time: "2026-04-19 10:00:00",
    tablet_count: 1000,
    data_used_capacity: "100 GB",
    total_capacity: "500 GB",
    used_pct: 20.5,
    cpu_cores: 8,
    cpu_used_pct: null,
    mem_used_pct: 60.3,
    mem_limit: "16 GB",
    num_running_queries: 3,
    warehouse: null,
    version: "3.3.0",
    err_msg: null,
    ...overrides,
  };
}

function makeClusterData(
  overrides: Partial<ClusterStatusResponse> = {},
): ClusterStatusResponse {
  return {
    frontends: [makeFENode()],
    backends: [makeBENode()],
    metrics: {
      fe_total: 1,
      fe_alive: 1,
      be_total: 1,
      be_alive: 1,
      cn_total: 0,
      cn_alive: 0,
      total_tablets: 1000,
      total_data_used: "100 GB",
      avg_disk_used_pct: 20.5,
      avg_cpu_used_pct: null,
      avg_mem_used_pct: 60.3,
      avg_fe_heap_used_pct: 45.2,
    },
    has_errors: false,
    mode: "full",
    metrics_warning: null,
    ...overrides,
  };
}

/* ── Setup ── */

beforeEach(() => {
  vi.clearAllMocks();
  mockGetClusterStatus.mockResolvedValue(makeClusterData());
  useClusterStore.setState({ isOpen: false, expandedNodes: new Set<string>() });
});

/* ── Tests ── */

describe("ClusterDrawer", () => {
  describe("structural rendering", () => {
    it("renders Cluster Status title", () => {
      render(<ClusterDrawer />);
      expect(screen.getByText("Cluster Status")).toBeInTheDocument();
    });

    it("renders Refresh and Close buttons", () => {
      render(<ClusterDrawer />);
      expect(screen.getByTitle("Refresh")).toBeInTheDocument();
      expect(screen.getByTitle("Close")).toBeInTheDocument();
    });

    it("does not fetch when drawer is closed", () => {
      render(<ClusterDrawer />);
      expect(mockGetClusterStatus).not.toHaveBeenCalled();
    });
  });

  describe("open/close behavior", () => {
    it("close button calls closeDrawer", async () => {
      useClusterStore.setState({ isOpen: true });
      render(<ClusterDrawer />);
      await waitFor(() => expect(screen.queryByText("Loading...")).not.toBeInTheDocument());

      screen.getByTitle("Close").click();
      expect(useClusterStore.getState().isOpen).toBe(false);
    });

    it("ESC key closes drawer when open", async () => {
      useClusterStore.setState({ isOpen: true });
      render(<ClusterDrawer />);

      await act(async () => {
        document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      });

      expect(useClusterStore.getState().isOpen).toBe(false);
    });

    it("ESC key does nothing when drawer is already closed", () => {
      render(<ClusterDrawer />);
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      expect(useClusterStore.getState().isOpen).toBe(false);
    });

    it("backdrop click closes drawer", async () => {
      useClusterStore.setState({ isOpen: true });
      const { container } = render(<ClusterDrawer />);
      await waitFor(() => expect(screen.queryByText("Loading...")).not.toBeInTheDocument());

      const backdrop = container.firstElementChild as HTMLElement;
      backdrop?.click();
      expect(useClusterStore.getState().isOpen).toBe(false);
    });
  });

  describe("loading state", () => {
    it("shows loading indicator when open and fetching", async () => {
      let resolvePromise!: (data: ClusterStatusResponse) => void;
      mockGetClusterStatus.mockReturnValue(
        new Promise<ClusterStatusResponse>((res) => { resolvePromise = res; }),
      );

      useClusterStore.setState({ isOpen: true });
      render(<ClusterDrawer />);

      expect(screen.getByText("Loading...")).toBeInTheDocument();

      await act(async () => { resolvePromise(makeClusterData()); });
    });

    it("refresh button is disabled while loading", async () => {
      let resolvePromise!: (data: ClusterStatusResponse) => void;
      mockGetClusterStatus.mockReturnValue(
        new Promise<ClusterStatusResponse>((res) => { resolvePromise = res; }),
      );

      useClusterStore.setState({ isOpen: true });
      render(<ClusterDrawer />);

      expect(screen.getByTitle("Refresh")).toBeDisabled();

      await act(async () => { resolvePromise(makeClusterData()); });
    });
  });

  describe("error state", () => {
    it("shows error message on fetch failure", async () => {
      mockGetClusterStatus.mockRejectedValue(new Error("Network error"));
      useClusterStore.setState({ isOpen: true });
      render(<ClusterDrawer />);

      await waitFor(() =>
        expect(screen.getByText(/Failed to load cluster status/)).toBeInTheDocument(),
      );
    });

    it("Retry button re-fetches", async () => {
      mockGetClusterStatus.mockRejectedValue(new Error("Network error"));
      useClusterStore.setState({ isOpen: true });
      render(<ClusterDrawer />);

      await waitFor(() => expect(screen.getByText("Retry")).toBeInTheDocument());

      mockGetClusterStatus.mockResolvedValue(makeClusterData());
      screen.getByText("Retry").click();

      await waitFor(() => expect(screen.queryByText("Retry")).not.toBeInTheDocument());
    });

    it("abort error is not shown as an error state", async () => {
      let rejectPromise!: (err: Error) => void;
      mockGetClusterStatus.mockReturnValue(
        new Promise<ClusterStatusResponse>((_, rej) => { rejectPromise = rej; }),
      );

      useClusterStore.setState({ isOpen: true });
      render(<ClusterDrawer />);

      await act(async () => {
        act(() => { useClusterStore.getState().closeDrawer(); });
        rejectPromise(new DOMException("Request aborted", "AbortError"));
      });

      expect(screen.queryByText(/Failed to load/)).not.toBeInTheDocument();
    });
  });

  describe("data rendering — summary section", () => {
    it("shows FE and BE alive counts", async () => {
      useClusterStore.setState({ isOpen: true });
      render(<ClusterDrawer />);
      await waitFor(() => expect(screen.queryByText("Loading...")).not.toBeInTheDocument());

      expect(screen.getAllByText(/1\/1/).length).toBeGreaterThanOrEqual(2);
    });

    it("shows CN alive count when cn_total > 0", async () => {
      mockGetClusterStatus.mockResolvedValue(
        makeClusterData({
          metrics: {
            fe_total: 1, fe_alive: 1, be_total: 0, be_alive: 0,
            cn_total: 2, cn_alive: 1,
            total_tablets: null, total_data_used: null,
            avg_disk_used_pct: null, avg_cpu_used_pct: null,
            avg_mem_used_pct: null, avg_fe_heap_used_pct: null,
          },
        }),
      );
      useClusterStore.setState({ isOpen: true });
      render(<ClusterDrawer />);
      await waitFor(() => expect(screen.getByText(/1\/2/)).toBeInTheDocument());
    });

    it("shows Avg Disk label", async () => {
      useClusterStore.setState({ isOpen: true });
      render(<ClusterDrawer />);
      await waitFor(() => expect(screen.getByText(/Avg Disk/)).toBeInTheDocument());
    });

    it("shows Avg Mem label", async () => {
      useClusterStore.setState({ isOpen: true });
      render(<ClusterDrawer />);
      await waitFor(() => expect(screen.getByText("Avg Mem:")).toBeInTheDocument());
    });

    it("shows Avg FE Heap label", async () => {
      useClusterStore.setState({ isOpen: true });
      render(<ClusterDrawer />);
      await waitFor(() => expect(screen.getByText("Avg FE Heap:")).toBeInTheDocument());
    });

    it("shows Avg CPU when present", async () => {
      mockGetClusterStatus.mockResolvedValue(
        makeClusterData({
          metrics: {
            fe_total: 1, fe_alive: 1, be_total: 0, be_alive: 0,
            cn_total: 1, cn_alive: 1,
            total_tablets: null, total_data_used: null,
            avg_disk_used_pct: null, avg_cpu_used_pct: 25.5,
            avg_mem_used_pct: null, avg_fe_heap_used_pct: null,
          },
        }),
      );
      useClusterStore.setState({ isOpen: true });
      render(<ClusterDrawer />);
      await waitFor(() => expect(screen.getByText("Avg CPU:")).toBeInTheDocument());
    });

    it("shows total tablets when present", async () => {
      useClusterStore.setState({ isOpen: true });
      render(<ClusterDrawer />);
      await waitFor(() => expect(screen.getByText(/Tablets:/)).toBeInTheDocument());
    });

    it("shows total data used when present", async () => {
      useClusterStore.setState({ isOpen: true });
      render(<ClusterDrawer />);
      await waitFor(() => expect(screen.getByText(/Data Used:/)).toBeInTheDocument());
    });

    it("shows Avg Disk/Cache label for mixed BE+CN cluster", async () => {
      mockGetClusterStatus.mockResolvedValue(
        makeClusterData({
          metrics: {
            fe_total: 1, fe_alive: 1, be_total: 1, be_alive: 1,
            cn_total: 1, cn_alive: 1,
            total_tablets: null, total_data_used: null,
            avg_disk_used_pct: 30.0, avg_cpu_used_pct: null,
            avg_mem_used_pct: null, avg_fe_heap_used_pct: null,
          },
        }),
      );
      useClusterStore.setState({ isOpen: true });
      render(<ClusterDrawer />);
      await waitFor(() => expect(screen.getByText("Avg Disk/Cache:")).toBeInTheDocument());
    });
  });

  describe("data rendering — banners and alerts", () => {
    it("shows limited mode banner when mode=limited", async () => {
      mockGetClusterStatus.mockResolvedValue(makeClusterData({ mode: "limited" }));
      useClusterStore.setState({ isOpen: true });
      render(<ClusterDrawer />);
      await waitFor(() => expect(screen.getByText("Limited view")).toBeInTheDocument());
    });

    it("shows metrics warning banner when present", async () => {
      mockGetClusterStatus.mockResolvedValue(
        makeClusterData({ metrics_warning: "Could not reach FE /metrics endpoint" }),
      );
      useClusterStore.setState({ isOpen: true });
      render(<ClusterDrawer />);
      await waitFor(() =>
        expect(screen.getByText("Could not reach FE /metrics endpoint")).toBeInTheDocument(),
      );
    });

    it("shows Alerts section when has_errors is true", async () => {
      mockGetClusterStatus.mockResolvedValue(
        makeClusterData({
          has_errors: true,
          frontends: [makeFENode({ alive: false, err_msg: null })],
        }),
      );
      useClusterStore.setState({ isOpen: true });
      render(<ClusterDrawer />);
      await waitFor(() => expect(screen.getByText("Alerts")).toBeInTheDocument());
    });

    it("alert shows err_msg text when node has an error message", async () => {
      mockGetClusterStatus.mockResolvedValue(
        makeClusterData({
          has_errors: true,
          frontends: [makeFENode({ err_msg: "Heartbeat timeout" })],
        }),
      );
      useClusterStore.setState({ isOpen: true });
      render(<ClusterDrawer />);
      await waitFor(() => expect(screen.getByText("Heartbeat timeout")).toBeInTheDocument());
    });
  });

  describe("data rendering — section headers", () => {
    it("shows Frontend Nodes section header", async () => {
      useClusterStore.setState({ isOpen: true });
      render(<ClusterDrawer />);
      await waitFor(() => expect(screen.getByText("Frontend Nodes")).toBeInTheDocument());
    });

    it("shows Backend Nodes section header for BE-only cluster", async () => {
      useClusterStore.setState({ isOpen: true });
      render(<ClusterDrawer />);
      await waitFor(() => expect(screen.getByText("Backend Nodes")).toBeInTheDocument());
    });

    it("shows Compute Nodes header when only CNs", async () => {
      mockGetClusterStatus.mockResolvedValue(
        makeClusterData({
          backends: [makeBENode({ node_type: "compute" })],
          metrics: {
            fe_total: 1, fe_alive: 1, be_total: 0, be_alive: 0,
            cn_total: 1, cn_alive: 1,
            total_tablets: null, total_data_used: null,
            avg_disk_used_pct: null, avg_cpu_used_pct: null,
            avg_mem_used_pct: null, avg_fe_heap_used_pct: null,
          },
        }),
      );
      useClusterStore.setState({ isOpen: true });
      render(<ClusterDrawer />);
      await waitFor(() => expect(screen.getByText("Compute Nodes")).toBeInTheDocument());
    });

    it("shows Backend & Compute Nodes header for mixed cluster", async () => {
      mockGetClusterStatus.mockResolvedValue(
        makeClusterData({
          backends: [
            makeBENode({ node_type: "backend" }),
            makeBENode({ node_type: "compute", name: "cn-01", ip: "10.0.0.3" }),
          ],
          metrics: {
            fe_total: 1, fe_alive: 1, be_total: 1, be_alive: 1,
            cn_total: 1, cn_alive: 1,
            total_tablets: null, total_data_used: null,
            avg_disk_used_pct: null, avg_cpu_used_pct: null,
            avg_mem_used_pct: null, avg_fe_heap_used_pct: null,
          },
        }),
      );
      useClusterStore.setState({ isOpen: true });
      render(<ClusterDrawer />);
      await waitFor(() =>
        expect(screen.getByText("Backend & Compute Nodes")).toBeInTheDocument(),
      );
    });

    it("shows No nodes reported for empty FE list", async () => {
      mockGetClusterStatus.mockResolvedValue(
        makeClusterData({
          frontends: [],
          metrics: {
            fe_total: 0, fe_alive: 0, be_total: 1, be_alive: 1,
            cn_total: 0, cn_alive: 0,
            total_tablets: null, total_data_used: null,
            avg_disk_used_pct: null, avg_cpu_used_pct: null,
            avg_mem_used_pct: null, avg_fe_heap_used_pct: null,
          },
        }),
      );
      useClusterStore.setState({ isOpen: true });
      render(<ClusterDrawer />);
      await waitFor(() => expect(screen.getByText("No nodes reported")).toBeInTheDocument());
    });
  });

  describe("FE node card", () => {
    it("shows FE node display name", async () => {
      useClusterStore.setState({ isOpen: true });
      render(<ClusterDrawer />);
      await waitFor(() => expect(screen.queryByText("Loading...")).not.toBeInTheDocument());
      expect(screen.getByText("fe-01")).toBeInTheDocument();
    });

    it("shows LEADER role badge", async () => {
      useClusterStore.setState({ isOpen: true });
      render(<ClusterDrawer />);
      await waitFor(() => expect(screen.getByText("LEADER")).toBeInTheDocument());
    });

    it("shows OBSERVER role badge", async () => {
      mockGetClusterStatus.mockResolvedValue(
        makeClusterData({ frontends: [makeFENode({ role: "OBSERVER" })] }),
      );
      useClusterStore.setState({ isOpen: true });
      render(<ClusterDrawer />);
      await waitFor(() => expect(screen.getByText("OBSERVER")).toBeInTheDocument());
    });

    it("shows FOLLOWER role badge (other role)", async () => {
      mockGetClusterStatus.mockResolvedValue(
        makeClusterData({ frontends: [makeFENode({ role: "FOLLOWER" })] }),
      );
      useClusterStore.setState({ isOpen: true });
      render(<ClusterDrawer />);
      await waitFor(() => expect(screen.getByText("FOLLOWER")).toBeInTheDocument());
    });

    it("shows ALIVE badge for alive FE node", async () => {
      useClusterStore.setState({ isOpen: true });
      render(<ClusterDrawer />);
      await waitFor(() =>
        expect(screen.getAllByText("ALIVE").length).toBeGreaterThan(0),
      );
    });

    it("shows DEAD badge for dead FE node", async () => {
      mockGetClusterStatus.mockResolvedValue(
        makeClusterData({ frontends: [makeFENode({ alive: false })] }),
      );
      useClusterStore.setState({ isOpen: true });
      render(<ClusterDrawer />);
      await waitFor(() => expect(screen.getByText("DEAD")).toBeInTheDocument());
    });

    it("shows Heap metric row when jvm_heap_used_pct is present", async () => {
      useClusterStore.setState({ isOpen: true });
      render(<ClusterDrawer />);
      await waitFor(() => expect(screen.getByText("Heap")).toBeInTheDocument());
    });

    it("shows metrics unavailable message when metrics_error is set", async () => {
      mockGetClusterStatus.mockResolvedValue(
        makeClusterData({
          frontends: [makeFENode({ jvm_heap_used_pct: null, metrics_error: "Connection refused" })],
        }),
      );
      useClusterStore.setState({ isOpen: true });
      render(<ClusterDrawer />);
      await waitFor(() =>
        expect(screen.getByText(/Metrics unavailable.*Connection refused/)).toBeInTheDocument(),
      );
    });

    it("clicking FE node card header toggles expansion", async () => {
      useClusterStore.setState({ isOpen: true });
      render(<ClusterDrawer />);
      await waitFor(() => expect(screen.queryByText("Loading...")).not.toBeInTheDocument());

      screen.getByText("fe-01").click();
      expect(useClusterStore.getState().expandedNodes.has("fe:fe-01")).toBe(true);
    });

    it("expanded FE node shows Version detail", async () => {
      useClusterStore.setState({ isOpen: true, expandedNodes: new Set(["fe:fe-01"]) });
      render(<ClusterDrawer />);
      await waitFor(() => expect(screen.getByText("Version")).toBeInTheDocument());
      expect(screen.getAllByText("3.3.0").length).toBeGreaterThan(0);
    });

    it("expanded FE node shows Journal ID detail", async () => {
      useClusterStore.setState({ isOpen: true, expandedNodes: new Set(["fe:fe-01"]) });
      render(<ClusterDrawer />);
      await waitFor(() => expect(screen.getByText("Journal ID")).toBeInTheDocument());
    });

    it("expanded FE node shows Young GC and Old GC", async () => {
      useClusterStore.setState({ isOpen: true, expandedNodes: new Set(["fe:fe-01"]) });
      render(<ClusterDrawer />);
      await waitFor(() => {
        expect(screen.getByText("Young GC (cumulative)")).toBeInTheDocument();
        expect(screen.getByText("Old GC (cumulative)")).toBeInTheDocument();
      });
    });

    it("expanded FE node shows Query p99", async () => {
      useClusterStore.setState({ isOpen: true, expandedNodes: new Set(["fe:fe-01"]) });
      render(<ClusterDrawer />);
      await waitFor(() => expect(screen.getByText("Query p99")).toBeInTheDocument());
    });

    it("expanded FE node shows err_msg when present", async () => {
      mockGetClusterStatus.mockResolvedValue(
        makeClusterData({ frontends: [makeFENode({ err_msg: "Journal replay failed" })] }),
      );
      useClusterStore.setState({ isOpen: true, expandedNodes: new Set(["fe:fe-01"]) });
      render(<ClusterDrawer />);
      await waitFor(() =>
        expect(screen.getByText("Journal replay failed")).toBeInTheDocument(),
      );
    });
  });

  describe("BE node card", () => {
    it("shows BE node display name", async () => {
      useClusterStore.setState({ isOpen: true });
      render(<ClusterDrawer />);
      await waitFor(() => expect(screen.getByText("be-01")).toBeInTheDocument());
    });

    it("shows BE type badge", async () => {
      useClusterStore.setState({ isOpen: true });
      render(<ClusterDrawer />);
      await waitFor(() => expect(screen.getByText("BE")).toBeInTheDocument());
    });

    it("shows CN type badge for compute node", async () => {
      mockGetClusterStatus.mockResolvedValue(
        makeClusterData({ backends: [makeBENode({ node_type: "compute" })] }),
      );
      useClusterStore.setState({ isOpen: true });
      render(<ClusterDrawer />);
      await waitFor(() => expect(screen.getByText("CN")).toBeInTheDocument());
    });

    it("shows tablet count", async () => {
      useClusterStore.setState({ isOpen: true });
      render(<ClusterDrawer />);
      await waitFor(() => expect(screen.getByText(/1,000 tablets/)).toBeInTheDocument());
    });

    it("shows Disk metric row for BE", async () => {
      useClusterStore.setState({ isOpen: true });
      render(<ClusterDrawer />);
      await waitFor(() => expect(screen.getByText("Disk")).toBeInTheDocument());
    });

    it("shows Disk Cache label for compute node", async () => {
      mockGetClusterStatus.mockResolvedValue(
        makeClusterData({
          backends: [makeBENode({ node_type: "compute", used_pct: 30.0 })],
        }),
      );
      useClusterStore.setState({ isOpen: true });
      render(<ClusterDrawer />);
      await waitFor(() => expect(screen.getByText("Disk Cache")).toBeInTheDocument());
    });

    it("shows CPU metric row for CN with cpu_used_pct", async () => {
      mockGetClusterStatus.mockResolvedValue(
        makeClusterData({
          backends: [makeBENode({ node_type: "compute", cpu_used_pct: 42.0 })],
        }),
      );
      useClusterStore.setState({ isOpen: true });
      render(<ClusterDrawer />);
      await waitFor(() => expect(screen.getByText("CPU")).toBeInTheDocument());
    });

    it("shows Memory metric row", async () => {
      useClusterStore.setState({ isOpen: true });
      render(<ClusterDrawer />);
      await waitFor(() => expect(screen.getByText("Memory")).toBeInTheDocument());
    });

    it("clicking BE node header toggles expansion", async () => {
      useClusterStore.setState({ isOpen: true });
      render(<ClusterDrawer />);
      await waitFor(() => expect(screen.queryByText("Loading...")).not.toBeInTheDocument());

      screen.getByText("be-01").click();
      expect(useClusterStore.getState().expandedNodes.has("be:be-01")).toBe(true);
    });

    it("expanded BE shows CPU Cores and Running Queries", async () => {
      useClusterStore.setState({ isOpen: true, expandedNodes: new Set(["be:be-01"]) });
      render(<ClusterDrawer />);
      await waitFor(() => {
        expect(screen.getByText("CPU Cores")).toBeInTheDocument();
        expect(screen.getByText("Running Queries")).toBeInTheDocument();
      });
    });

    it("expanded BE shows Last Start detail", async () => {
      useClusterStore.setState({ isOpen: true, expandedNodes: new Set(["be:be-01"]) });
      render(<ClusterDrawer />);
      await waitFor(() => expect(screen.getByText("Last Start")).toBeInTheDocument());
    });

    it("expanded CN shows Warehouse label", async () => {
      mockGetClusterStatus.mockResolvedValue(
        makeClusterData({
          backends: [
            makeBENode({ name: "cn-01", node_type: "compute", warehouse: "default_wh" }),
          ],
        }),
      );
      useClusterStore.setState({ isOpen: true, expandedNodes: new Set(["cn:cn-01"]) });
      render(<ClusterDrawer />);
      await waitFor(() => expect(screen.getByText("Warehouse")).toBeInTheDocument());
      expect(screen.getByText("default_wh")).toBeInTheDocument();
    });

    it("expanded BE shows err_msg when present", async () => {
      mockGetClusterStatus.mockResolvedValue(
        makeClusterData({ backends: [makeBENode({ err_msg: "Disk full" })] }),
      );
      useClusterStore.setState({ isOpen: true, expandedNodes: new Set(["be:be-01"]) });
      render(<ClusterDrawer />);
      await waitFor(() => expect(screen.getByText("Disk full")).toBeInTheDocument());
    });

    it("high disk usage (>85%) renders without error", async () => {
      mockGetClusterStatus.mockResolvedValue(
        makeClusterData({ backends: [makeBENode({ used_pct: 90 })] }),
      );
      useClusterStore.setState({ isOpen: true });
      render(<ClusterDrawer />);
      await waitFor(() => expect(screen.getByText("be-01")).toBeInTheDocument());
    });

    it("mid disk usage (>70%) renders without error", async () => {
      mockGetClusterStatus.mockResolvedValue(
        makeClusterData({ backends: [makeBENode({ used_pct: 75 })] }),
      );
      useClusterStore.setState({ isOpen: true });
      render(<ClusterDrawer />);
      await waitFor(() => expect(screen.getByText("be-01")).toBeInTheDocument());
    });
  });

  describe("refresh button", () => {
    it("refresh button re-fetches data", async () => {
      useClusterStore.setState({ isOpen: true });
      render(<ClusterDrawer />);
      await waitFor(() => expect(screen.queryByText("Loading...")).not.toBeInTheDocument());

      expect(mockGetClusterStatus).toHaveBeenCalledTimes(1);
      screen.getByTitle("Refresh").click();
      expect(mockGetClusterStatus).toHaveBeenCalledTimes(2);
    });

    it("refresh button passes refresh=true to getClusterStatus", async () => {
      useClusterStore.setState({ isOpen: true });
      render(<ClusterDrawer />);
      await waitFor(() => expect(screen.queryByText("Loading...")).not.toBeInTheDocument());

      screen.getByTitle("Refresh").click();
      await waitFor(() => expect(mockGetClusterStatus).toHaveBeenCalledTimes(2));

      // Second call must have refresh=true as its second argument
      expect(mockGetClusterStatus.mock.calls[1][1]).toBe(true);
    });
  });

  describe("CN-only cluster", () => {
    it("renders summary card without crashing and shows CN counts", async () => {
      mockGetClusterStatus.mockResolvedValue(
        makeClusterData({
          backends: [
            makeBENode({ node_type: "compute", name: "cn-01", ip: "10.0.0.3" }),
            makeBENode({ node_type: "compute", name: "cn-02", ip: "10.0.0.4" }),
          ],
          metrics: {
            fe_total: 1, fe_alive: 1, be_total: 0, be_alive: 0,
            cn_total: 2, cn_alive: 2,
            total_tablets: null, total_data_used: null,
            avg_disk_used_pct: null, avg_cpu_used_pct: null,
            avg_mem_used_pct: null, avg_fe_heap_used_pct: null,
          },
        }),
      );
      useClusterStore.setState({ isOpen: true });
      render(<ClusterDrawer />);
      await waitFor(() => expect(screen.queryByText("Loading...")).not.toBeInTheDocument());

      // CN 2/2 alive is shown in summary
      expect(screen.getByText(/2\/2/)).toBeInTheDocument();
      // No BE row since be_total === 0
      expect(screen.queryByText("BE")).not.toBeInTheDocument();
    });
  });

  describe("AbortController on unmount", () => {
    it("calls abort when component unmounts while open", async () => {
      const abortSpy = vi.spyOn(AbortController.prototype, "abort");

      useClusterStore.setState({ isOpen: true });
      const { unmount } = render(<ClusterDrawer />);

      unmount();

      expect(abortSpy).toHaveBeenCalled();
      abortSpy.mockRestore();
    });
  });

  describe("limited-mode FE label", () => {
    it("displays 'FE (connected)' name and shortened host IP in limited mode", async () => {
      mockGetClusterStatus.mockResolvedValue(
        makeClusterData({
          mode: "limited",
          frontends: [
            makeFENode({ name: "FE (connected)", ip: "starrocks.example.com" }),
          ],
          metrics: {
            fe_total: 1, fe_alive: 1, be_total: 0, be_alive: 0,
            cn_total: 0, cn_alive: 0,
            total_tablets: null, total_data_used: null,
            avg_disk_used_pct: null, avg_cpu_used_pct: null,
            avg_mem_used_pct: null, avg_fe_heap_used_pct: null,
          },
        }),
      );
      useClusterStore.setState({ isOpen: true });
      render(<ClusterDrawer />);
      await waitFor(() => expect(screen.queryByText("Loading...")).not.toBeInTheDocument());

      // Node name displayed as-is (no mangling)
      expect(screen.getByText("FE (connected)")).toBeInTheDocument();
      // Shortened IP (first DNS label) shown separately
      expect(screen.getByText("starrocks")).toBeInTheDocument();
    });
  });
});
