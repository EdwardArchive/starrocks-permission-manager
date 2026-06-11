import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, act } from "../../test/test-utils";
import ClusterTab from "./ClusterTab";
import { useClusterStore } from "../../stores/clusterStore";
import { makeFENode, makeBENode, makeClusterData } from "../../test/cluster-fixtures";

/* ── Mocks ── */

const mockGetClusterStatus = vi.fn();
const mockGetClusterQueries = vi.fn();
vi.mock("../../api/cluster", () => ({
  getClusterStatus: (...args: unknown[]) => mockGetClusterStatus(...args),
  getClusterQueries: (...args: unknown[]) => mockGetClusterQueries(...args),
}));

vi.mock("../dag/nodeIcons", () => ({
  colorizedSvg: (type: string) =>
    `<svg width="24" height="24"><circle data-type="${type}"/></svg>`,
  NODE_SVG_RAW: {},
  NODE_COLORS: {},
  APP_LOGO_SVG: '<svg width="24" height="24"></svg>',
}));

beforeEach(() => {
  vi.clearAllMocks();
  mockGetClusterStatus.mockResolvedValue(makeClusterData());
  mockGetClusterQueries.mockResolvedValue({ queries: [], server_now: null });
  useClusterStore.setState({ isOpen: false, expandedNodes: new Set<string>() });
});

describe("ClusterTab", () => {
  it("renders the Cluster Monitor title and fetches on mount", async () => {
    render(<ClusterTab />);
    expect(screen.getByText("Cluster Monitor")).toBeInTheDocument();
    await waitFor(() => expect(mockGetClusterStatus).toHaveBeenCalled());
  });

  it("renders summary, node sections, and the queries panel", async () => {
    render(<ClusterTab />);
    await waitFor(() => expect(screen.getByText("Frontend Nodes")).toBeInTheDocument());

    expect(screen.getByText("Backend Nodes")).toBeInTheDocument();
    expect(screen.getByText("fe-01")).toBeInTheDocument();
    expect(screen.getByText("be-01")).toBeInTheDocument();
    expect(screen.getByTestId("queries-panel")).toBeInTheDocument();
  });

  it("shows Compute Nodes header when only CNs exist", async () => {
    mockGetClusterStatus.mockResolvedValue(
      makeClusterData({
        backends: [makeBENode({ node_type: "compute", name: "cn-01" })],
        metrics: {
          fe_total: 1, fe_alive: 1, be_total: 0, be_alive: 0,
          cn_total: 1, cn_alive: 1,
          total_tablets: null, total_data_used: null,
          avg_disk_used_pct: null, avg_cpu_used_pct: null,
          avg_mem_used_pct: null, avg_fe_heap_used_pct: null,
        },
      }),
    );
    render(<ClusterTab />);
    await waitFor(() => expect(screen.getByText("Compute Nodes")).toBeInTheDocument());
  });

  it("shows mixed header for BE+CN clusters", async () => {
    mockGetClusterStatus.mockResolvedValue(
      makeClusterData({
        backends: [makeBENode(), makeBENode({ node_type: "compute", name: "cn-01", ip: "10.0.0.9" })],
        metrics: {
          fe_total: 1, fe_alive: 1, be_total: 1, be_alive: 1,
          cn_total: 1, cn_alive: 1,
          total_tablets: null, total_data_used: null,
          avg_disk_used_pct: null, avg_cpu_used_pct: null,
          avg_mem_used_pct: null, avg_fe_heap_used_pct: null,
        },
      }),
    );
    render(<ClusterTab />);
    await waitFor(() => expect(screen.getByText("Backend & Compute Nodes")).toBeInTheDocument());
  });

  it("toggles node expansion via the shared cluster store", async () => {
    render(<ClusterTab />);
    await waitFor(() => expect(screen.getByText("fe-01")).toBeInTheDocument());

    act(() => { screen.getByText("fe-01").click(); });

    expect(useClusterStore.getState().expandedNodes.has("fe:fe-01")).toBe(true);
    expect(screen.getByText("Journal ID")).toBeInTheDocument();
  });

  it("shows limited-mode banner for non-cluster_admin users", async () => {
    mockGetClusterStatus.mockResolvedValue(makeClusterData({ mode: "limited" }));
    render(<ClusterTab />);
    await waitFor(() => expect(screen.getByText("Limited view")).toBeInTheDocument());
  });

  it("shows alerts when the cluster has errors", async () => {
    mockGetClusterStatus.mockResolvedValue(
      makeClusterData({
        has_errors: true,
        frontends: [makeFENode({ alive: false })],
      }),
    );
    render(<ClusterTab />);
    await waitFor(() => expect(screen.getByText("Alerts")).toBeInTheDocument());
  });

  it("shows error state with Retry on fetch failure", async () => {
    mockGetClusterStatus.mockRejectedValue(new Error("boom"));
    render(<ClusterTab />);
    await waitFor(() =>
      expect(screen.getByText(/Failed to load cluster status/)).toBeInTheDocument(),
    );

    mockGetClusterStatus.mockResolvedValue(makeClusterData());
    act(() => { screen.getByText("Retry").click(); });
    await waitFor(() => expect(screen.getByText("Frontend Nodes")).toBeInTheDocument());
  });
});
