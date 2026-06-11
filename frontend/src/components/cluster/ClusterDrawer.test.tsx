import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, act } from "../../test/test-utils";
import ClusterDrawer from "./ClusterDrawer";
import { useClusterStore } from "../../stores/clusterStore";
import { useDagStore } from "../../stores/dagStore";
import { makeFENode, makeBENode, makeClusterData, makeQuery } from "../../test/cluster-fixtures";
import type { ClusterStatusResponse } from "../../types";

/* ── Mocks ── */

const mockGetClusterStatus = vi.fn();
const mockGetClusterQueries = vi.fn();
vi.mock("../../api/cluster", () => ({
  getClusterStatus: (...args: unknown[]) => mockGetClusterStatus(...args),
  getClusterQueries: (...args: unknown[]) => mockGetClusterQueries(...args),
}));

vi.mock("../dag/nodeIcons", () => ({
  colorizedSvg: (type: string) => `<svg width="24" height="24"><circle data-type="${type}"/></svg>`,
  NODE_SVG_RAW: {}, NODE_COLORS: {}, APP_LOGO_SVG: '<svg width="24" height="24"></svg>',
}));

beforeEach(() => {
  vi.clearAllMocks();
  mockGetClusterStatus.mockResolvedValue(makeClusterData());
  mockGetClusterQueries.mockResolvedValue({ queries: [], server_now: null, can_kill: false });
  useClusterStore.setState({ isOpen: false, expandedNodes: new Set<string>(), focus: null });
  useDagStore.setState({ activeTab: "obj" });
});

describe("ClusterDrawer (quick glance)", () => {
  describe("structural rendering", () => {
    it("renders Cluster Status title and buttons", () => {
      render(<ClusterDrawer />);
      expect(screen.getByText("Cluster Status")).toBeInTheDocument();
      expect(screen.getByTitle("Refresh")).toBeInTheDocument();
      expect(screen.getByTitle("Close")).toBeInTheDocument();
    });

    it("does not fetch when closed", () => {
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

    it("ESC key closes when open", async () => {
      useClusterStore.setState({ isOpen: true });
      render(<ClusterDrawer />);
      await act(async () => {
        document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      });
      expect(useClusterStore.getState().isOpen).toBe(false);
    });

    it("backdrop click closes", async () => {
      useClusterStore.setState({ isOpen: true });
      const { container } = render(<ClusterDrawer />);
      await waitFor(() => expect(screen.queryByText("Loading...")).not.toBeInTheDocument());
      (container.firstElementChild as HTMLElement)?.click();
      expect(useClusterStore.getState().isOpen).toBe(false);
    });
  });

  describe("loading / error", () => {
    it("shows loading indicator on open", async () => {
      let resolve!: (d: ClusterStatusResponse) => void;
      mockGetClusterStatus.mockReturnValue(new Promise<ClusterStatusResponse>((r) => { resolve = r; }));
      useClusterStore.setState({ isOpen: true });
      render(<ClusterDrawer />);
      expect(screen.getByText("Loading...")).toBeInTheDocument();
      await act(async () => { resolve(makeClusterData()); });
    });

    it("shows error message on fetch failure", async () => {
      mockGetClusterStatus.mockRejectedValue(new Error("Network error"));
      useClusterStore.setState({ isOpen: true });
      render(<ClusterDrawer />);
      await waitFor(() => expect(screen.getByText(/Failed to load cluster status/)).toBeInTheDocument());
    });

    it("Retry re-fetches", async () => {
      mockGetClusterStatus.mockRejectedValue(new Error("Network error"));
      useClusterStore.setState({ isOpen: true });
      render(<ClusterDrawer />);
      await waitFor(() => expect(screen.getByText("Retry")).toBeInTheDocument());
      mockGetClusterStatus.mockResolvedValue(makeClusterData());
      screen.getByText("Retry").click();
      await waitFor(() => expect(screen.queryByText("Retry")).not.toBeInTheDocument());
    });
  });

  describe("gauges (KPI band)", () => {
    it("renders Frontends / Compute KPI tiles", async () => {
      mockGetClusterStatus.mockResolvedValue(
        makeClusterData({
          backends: [makeBENode({ node_type: "compute", name: "cn-01" })],
          metrics: {
            fe_total: 2, fe_alive: 2, be_total: 0, be_alive: 0, cn_total: 3, cn_alive: 3,
            total_tablets: null, total_data_used: null, avg_disk_used_pct: null,
            avg_cpu_used_pct: 12, avg_mem_used_pct: null, avg_fe_heap_used_pct: null,
          },
        }),
      );
      useClusterStore.setState({ isOpen: true });
      render(<ClusterDrawer />);
      await waitFor(() => expect(screen.getByText("Frontends")).toBeInTheDocument());
      expect(screen.getByText("Compute")).toBeInTheDocument();
      expect(screen.getByText("Avg CPU")).toBeInTheDocument();
    });

    it("clicking a KPI jumps to the tab and focuses the section", async () => {
      useClusterStore.setState({ isOpen: true });
      render(<ClusterDrawer />);
      await waitFor(() => expect(screen.getByText("Frontends")).toBeInTheDocument());
      act(() => { screen.getByText("Frontends").click(); });
      expect(useDagStore.getState().activeTab).toBe("cluster");
      expect(useClusterStore.getState().focus).toMatchObject({ kind: "section", id: "frontends" });
      expect(useClusterStore.getState().isOpen).toBe(false);
    });
  });

  describe("alerts jump to node", () => {
    it("clicking an alert focuses that node in the tab", async () => {
      mockGetClusterStatus.mockResolvedValue(
        makeClusterData({ has_errors: true, frontends: [makeFENode({ name: "fe-bad", alive: false })] }),
      );
      useClusterStore.setState({ isOpen: true });
      render(<ClusterDrawer />);
      await waitFor(() => expect(screen.getByText("Alerts")).toBeInTheDocument());
      act(() => { screen.getByText("fe-bad").click(); });
      expect(useDagStore.getState().activeTab).toBe("cluster");
      expect(useClusterStore.getState().focus).toMatchObject({ kind: "node", id: "fe:fe-bad" });
    });
  });

  describe("running queries preview", () => {
    it("shows top running queries and jumps on click", async () => {
      mockGetClusterQueries.mockResolvedValue({
        queries: [
          makeQuery({ query_id: "a", user: "alice", exec_time_ms: 5000, exec_time_display: "5.0 s" }),
          makeQuery({ query_id: "b", user: "bob", exec_time_ms: 9000, exec_time_display: "9.0 s" }),
        ],
        server_now: null, can_kill: false,
      });
      useClusterStore.setState({ isOpen: true });
      render(<ClusterDrawer />);
      await waitFor(() => expect(screen.getByTestId("drawer-queries-preview")).toBeInTheDocument());
      // both users shown, slowest first
      expect(screen.getByText("bob")).toBeInTheDocument();
      expect(screen.getByText("alice")).toBeInTheDocument();

      act(() => { screen.getByTestId("drawer-queries-preview").click(); });
      expect(useDagStore.getState().activeTab).toBe("cluster");
      expect(useClusterStore.getState().focus).toMatchObject({ kind: "section", id: "queries" });
    });

    it("shows a permission hint when queries are unavailable (403)", async () => {
      mockGetClusterQueries.mockRejectedValue(new Error("denied"));
      useClusterStore.setState({ isOpen: true });
      render(<ClusterDrawer />);
      await waitFor(() => expect(screen.getByText("Requires cluster_admin")).toBeInTheDocument());
    });
  });

  describe("Cluster Monitor link", () => {
    it("Open Cluster Monitor switches tab and closes", async () => {
      useClusterStore.setState({ isOpen: true });
      render(<ClusterDrawer />);
      await waitFor(() => expect(screen.getByTestId("open-cluster-tab-btn")).toBeInTheDocument());
      act(() => { screen.getByTestId("open-cluster-tab-btn").click(); });
      expect(useDagStore.getState().activeTab).toBe("cluster");
      expect(useClusterStore.getState().isOpen).toBe(false);
    });
  });
});
