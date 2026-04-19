import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "../../test/test-utils";
import userEvent from "@testing-library/user-event";
import Header from "./Header";
import { useClusterStore } from "../../stores/clusterStore";

// Mock nodeIcons to avoid SVG ?raw imports
vi.mock("../dag/nodeIcons", () => ({
  APP_LOGO_SVG: '<svg width="24" height="24"><circle cx="12" cy="12" r="10"/></svg>',
  NODE_SVG_RAW: {},
  NODE_COLORS: {},
  colorizedSvg: () => "",
}));

// Mock colors
vi.mock("../../utils/colors", () => ({
  C: {
    card: "#1e293b",
    borderLight: "#475569",
    text1: "#e2e8f0",
    text2: "#94a3b8",
  },
}));

const mockLogout = vi.fn();

vi.mock("../../stores/authStore", () => ({
  useAuthStore: vi.fn(() => ({
    user: { username: "admin", roles: ["root"], default_role: "root", is_user_admin: true },
    connectionInfo: { host: "10.0.0.1", port: 9030 },
    logout: mockLogout,
  })),
}));

beforeEach(() => {
  vi.clearAllMocks();
  // Reset cluster store state before each test
  useClusterStore.setState({ isOpen: false });
});

describe("Header", () => {
  it("renders app title", () => {
    render(<Header />);
    expect(screen.getByText("StarRocks Permission Manager")).toBeInTheDocument();
  });

  it("renders username from store", () => {
    render(<Header />);
    expect(screen.getByText("admin")).toBeInTheDocument();
  });

  it("renders connection info (host:port)", () => {
    render(<Header />);
    expect(screen.getByText(/@10\.0\.0\.1:9030/)).toBeInTheDocument();
  });

  it("renders logout button", () => {
    render(<Header />);
    expect(screen.getByText("Logout")).toBeInTheDocument();
  });

  it("logout button calls store.logout()", async () => {
    const user = userEvent.setup();
    render(<Header />);
    await user.click(screen.getByText("Logout"));
    expect(mockLogout).toHaveBeenCalledTimes(1);
  });

  it("renders when connectionInfo is null", async () => {
    // Re-mock with null connectionInfo
    const { useAuthStore } = await import("../../stores/authStore");
    (useAuthStore as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      user: { username: "viewer", roles: [], default_role: null, is_user_admin: false },
      connectionInfo: null,
      logout: mockLogout,
    });

    render(<Header />);
    expect(screen.getByText("viewer")).toBeInTheDocument();
    // No @host:port text
    expect(screen.queryByText(/@/)).not.toBeInTheDocument();
  });

  it("renders cluster status icon button", () => {
    render(<Header />);
    const btn = screen.getByTestId("cluster-status-btn");
    expect(btn).toBeInTheDocument();
    expect(btn).toHaveAttribute("aria-label", "Cluster Status");
  });

  it("clicking cluster status button toggles drawer open", async () => {
    const user = userEvent.setup();
    render(<Header />);
    expect(useClusterStore.getState().isOpen).toBe(false);
    await user.click(screen.getByTestId("cluster-status-btn"));
    expect(useClusterStore.getState().isOpen).toBe(true);
  });
});
