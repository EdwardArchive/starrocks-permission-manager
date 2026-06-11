import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, act } from "../../test/test-utils";
import ClusterDrawer from "./ClusterDrawer";
import { useClusterStore } from "../../stores/clusterStore";
import { useDagStore } from "../../stores/dagStore";
import { makeFENode, makeClusterData } from "../../test/cluster-fixtures";
import type { ClusterStatusResponse } from "../../types";

/* ── Mocks ── */

const mockGetClusterStatus = vi.fn();
vi.mock("../../api/cluster", () => ({
  getClusterStatus: (...args: unknown[]) => mockGetClusterStatus(...args),
  getClusterQueries: vi.fn(),
}));

vi.mock("../dag/nodeIcons", () => ({
  colorizedSvg: (type: string) =>
    `<svg width="24" height="24"><circle data-type="${type}"/></svg>`,
  NODE_SVG_RAW: {},
  NODE_COLORS: {},
  APP_LOGO_SVG: '<svg width="24" height="24"></svg>',
}));

/* ── Setup ── */

beforeEach(() => {
  vi.clearAllMocks();
  mockGetClusterStatus.mockResolvedValue(makeClusterData());
  useClusterStore.setState({ isOpen: false, expandedNodes: new Set<string>() });
});

/* ── Tests ── */

describe("ClusterDrawer (quick glance)", () => {
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

  describe("Cluster Monitor tab link", () => {
    it("renders the Open Cluster Monitor button", async () => {
      useClusterStore.setState({ isOpen: true });
      render(<ClusterDrawer />);
      await waitFor(() =>
        expect(screen.getByTestId("open-cluster-tab-btn")).toBeInTheDocument(),
      );
    });

    it("clicking it switches to the cluster tab and closes the drawer", async () => {
      useDagStore.setState({ activeTab: "obj" });
      useClusterStore.setState({ isOpen: true });
      render(<ClusterDrawer />);
      await waitFor(() =>
        expect(screen.getByTestId("open-cluster-tab-btn")).toBeInTheDocument(),
      );

      act(() => { screen.getByTestId("open-cluster-tab-btn").click(); });

      expect(useDagStore.getState().activeTab).toBe("cluster");
      expect(useClusterStore.getState().isOpen).toBe(false);
    });
  });

  describe("quick glance scope", () => {
    it("does not render node cards (they live in the Cluster tab)", async () => {
      useClusterStore.setState({ isOpen: true });
      render(<ClusterDrawer />);
      await waitFor(() => expect(screen.queryByText("Loading...")).not.toBeInTheDocument());

      expect(screen.queryByText("Frontend Nodes")).not.toBeInTheDocument();
      expect(screen.queryByText("Backend Nodes")).not.toBeInTheDocument();
    });
  });
});
