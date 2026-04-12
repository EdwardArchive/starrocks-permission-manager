import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "../../test/test-utils";
import userEvent from "@testing-library/user-event";
import GroupDetailPanel from "./GroupDetailPanel";

// Mock nodeIcons
vi.mock("../dag/nodeIcons", () => ({
  NODE_COLORS: {
    system: "#6b7280",
    catalog: "#3b82f6",
    database: "#22c55e",
    table: "#6366f1",
  },
  colorizedSvg: () => "",
  NODE_SVG_RAW: {},
}));

// Mock InlineIcon
vi.mock("../common/InlineIcon", () => ({
  default: ({ type }: { type: string }) => <span data-testid={`icon-${type}`} />,
}));

// Mock colors
vi.mock("../../utils/colors", () => ({
  C: {
    bg: "#0f172a",
    card: "#1e293b",
    border: "#334155",
    borderLight: "#475569",
    text1: "#e2e8f0",
    text2: "#94a3b8",
    text3: "#64748b",
    accent: "#3b82f6",
  },
}));

const mockSetSelectedNode = vi.fn();
const mockSetPanelMode = vi.fn();

vi.mock("../../stores/dagStore", () => ({
  useDagStore: vi.fn(() => ({
    selectedNode: {
      id: "group-1",
      label: "Tables",
      type: "table",
      color: null,
    },
    groupChildren: [
      { id: "t1", label: "orders", type: "table" },
      { id: "t2", label: "products", type: "table" },
      { id: "t3", label: "users", type: "table" },
    ],
    setSelectedNode: mockSetSelectedNode,
    setPanelMode: mockSetPanelMode,
  })),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GroupDetailPanel", () => {
  it("renders group label", () => {
    render(<GroupDetailPanel />);
    expect(screen.getByText("Tables")).toBeInTheDocument();
  });

  it("renders type badge", () => {
    render(<GroupDetailPanel />);
    expect(screen.getByText("TABLE Group")).toBeInTheDocument();
  });

  it("renders object count", () => {
    render(<GroupDetailPanel />);
    expect(screen.getByText("3 Objects")).toBeInTheDocument();
  });

  it("renders child items", () => {
    render(<GroupDetailPanel />);
    expect(screen.getByText("orders")).toBeInTheDocument();
    expect(screen.getByText("products")).toBeInTheDocument();
    expect(screen.getByText("users")).toBeInTheDocument();
  });

  it("clicking a child calls setSelectedNode and setPanelMode", async () => {
    const user = userEvent.setup();
    render(<GroupDetailPanel />);
    await user.click(screen.getByText("orders"));
    expect(mockSetSelectedNode).toHaveBeenCalledWith({ id: "t1", label: "orders", type: "table" });
    expect(mockSetPanelMode).toHaveBeenCalledWith("object");
  });

  it("renders icons for the group and children", () => {
    render(<GroupDetailPanel />);
    // 1 header icon + 3 child icons = 4 total
    const icons = screen.getAllByTestId("icon-table");
    expect(icons.length).toBe(4);
  });

  it("returns null when selectedNode is null", async () => {
    const { useDagStore } = await import("../../stores/dagStore");
    (useDagStore as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      selectedNode: null,
      groupChildren: [],
      setSelectedNode: mockSetSelectedNode,
      setPanelMode: mockSetPanelMode,
    });

    const { container } = render(<GroupDetailPanel />);
    expect(container.innerHTML).toBe("");
  });
});
