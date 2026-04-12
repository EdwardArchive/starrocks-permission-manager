import { describe, it, expect, vi } from "vitest";
import { render, screen } from "../../test/test-utils";
import CustomNode from "./CustomNode";

// Mock @xyflow/react
vi.mock("@xyflow/react", () => ({
  Handle: ({ type }: { type: string }) => <div data-testid={`handle-${type}`} />,
  Position: { Top: "top", Bottom: "bottom" },
}));

// Mock nodeIcons
vi.mock("./nodeIcons", () => ({
  colorizedSvg: (type: string, color?: string) => {
    if (type === "unknown") return "";
    return `<svg width="24" height="24" stroke="${color || "#000"}"><circle cx="12" cy="12" r="10"/></svg>`;
  },
  NODE_COLORS: {
    system: "#6b7280",
    catalog: "#3b82f6",
    database: "#22c55e",
    table: "#6366f1",
    user: "#0ea5e9",
    role: "#f97316",
  },
}));

// Mock colors
vi.mock("../../utils/colors", () => ({
  C: {
    card: "#1e293b",
    text1: "#e2e8f0",
  },
}));

function makeNodeProps(data: Record<string, unknown>) {
  return {
    id: "node-1",
    data,
    type: "custom",
    selected: false,
    isConnectable: true,
    zIndex: 0,
    positionAbsoluteX: 0,
    positionAbsoluteY: 0,
    dragging: false,
    dragHandle: undefined,
    sourcePosition: undefined,
    targetPosition: undefined,
    parentId: undefined,
    width: 168,
    height: 40,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

describe("CustomNode", () => {
  it("renders node label text", () => {
    render(<CustomNode {...makeNodeProps({ label: "analytics_db", nodeType: "database" })} />);
    expect(screen.getByText("analytics_db")).toBeInTheDocument();
  });

  it("renders with icon for known node type", () => {
    const { container } = render(
      <CustomNode {...makeNodeProps({ label: "orders", nodeType: "table" })} />,
    );
    // The SVG is injected via dangerouslySetInnerHTML
    // Check that the node renders svg content
    expect(container.querySelector("svg")).not.toBeNull();
  });

  it("has both source and target handles", () => {
    render(<CustomNode {...makeNodeProps({ label: "test", nodeType: "table" })} />);
    expect(screen.getByTestId("handle-target")).toBeInTheDocument();
    expect(screen.getByTestId("handle-source")).toBeInTheDocument();
  });

  it("formats user node label by stripping quotes and host", () => {
    render(<CustomNode {...makeNodeProps({ label: "'admin'@'%'", nodeType: "user" })} />);
    expect(screen.getByText("admin")).toBeInTheDocument();
    expect(screen.queryByText("'admin'@'%'")).not.toBeInTheDocument();
  });

  it("uses custom color when provided in data", () => {
    const { container } = render(
      <CustomNode {...makeNodeProps({ label: "custom", nodeType: "table", color: "#ff0000" })} />,
    );
    // jsdom converts hex to rgb; border: "2px solid #ff0000" becomes individual border properties
    const allDivs = container.querySelectorAll("div");
    let hasColor = false;
    allDivs.forEach((div) => {
      // Check the computed borderColor (jsdom converts to rgb)
      if (div.style.borderColor === "rgb(255, 0, 0)" || div.style.borderColor === "#ff0000") {
        hasColor = true;
      }
    });
    expect(hasColor).toBe(true);
  });

  it("renders label without formatting for non-user types", () => {
    render(<CustomNode {...makeNodeProps({ label: "my_table", nodeType: "table" })} />);
    expect(screen.getByText("my_table")).toBeInTheDocument();
  });
});
