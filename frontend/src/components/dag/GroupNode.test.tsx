import { describe, it, expect, vi } from "vitest";
import { render, screen } from "../../test/test-utils";
import GroupNode from "./GroupNode";

// Mock @xyflow/react
vi.mock("@xyflow/react", () => ({
  Handle: ({ type }: { type: string }) => <div data-testid={`handle-${type}`} />,
  Position: { Top: "top", Bottom: "bottom" },
}));

// Mock nodeIcons
vi.mock("./nodeIcons", () => ({
  colorizedSvg: (type: string) => {
    if (type === "unknown") return "";
    return `<svg width="24" height="24" stroke="#000"><circle cx="12" cy="12" r="10"/></svg>`;
  },
  NODE_COLORS: {
    system: "#6b7280",
    catalog: "#3b82f6",
    database: "#22c55e",
    table: "#6366f1",
  },
}));

function makeNodeProps(data: Record<string, unknown>) {
  return {
    id: "group-1",
    data,
    type: "group",
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
    width: 200,
    height: 100,
    // biome-ignore lint: needed for xyflow compat
  } as any;
}

describe("GroupNode", () => {
  it("renders group label text", () => {
    render(<GroupNode {...makeNodeProps({ label: "default_catalog", nodeType: "catalog" })} />);
    expect(screen.getByText("default_catalog")).toBeInTheDocument();
  });

  it("has dashed border style", () => {
    const { container } = render(
      <GroupNode {...makeNodeProps({ label: "test_db", nodeType: "database" })} />,
    );
    // The outer div after handles should have dashed border
    const groupDiv = container.querySelector("div[style]");
    // Find the div with border containing "dashed"
    const allDivs = container.querySelectorAll("div");
    let hasDashed = false;
    allDivs.forEach((div) => {
      if (div.style.border?.includes("dashed")) hasDashed = true;
    });
    expect(hasDashed).toBe(true);
  });

  it("has both source and target handles", () => {
    render(<GroupNode {...makeNodeProps({ label: "group", nodeType: "catalog" })} />);
    expect(screen.getByTestId("handle-target")).toBeInTheDocument();
    expect(screen.getByTestId("handle-source")).toBeInTheDocument();
  });

  it("uses custom dimensions when provided", () => {
    const { container } = render(
      <GroupNode {...makeNodeProps({ label: "wide", nodeType: "catalog", containerW: 400, containerH: 300 })} />,
    );
    const allDivs = container.querySelectorAll("div");
    let found = false;
    allDivs.forEach((div) => {
      if (div.style.width === "400px" && div.style.height === "300px") found = true;
    });
    expect(found).toBe(true);
  });

  it("uses default dimensions when not provided", () => {
    const { container } = render(
      <GroupNode {...makeNodeProps({ label: "default", nodeType: "catalog" })} />,
    );
    const allDivs = container.querySelectorAll("div");
    let found = false;
    allDivs.forEach((div) => {
      if (div.style.width === "200px" && div.style.height === "100px") found = true;
    });
    expect(found).toBe(true);
  });

  it("renders icon SVG content", () => {
    const { container } = render(
      <GroupNode {...makeNodeProps({ label: "system", nodeType: "system" })} />,
    );
    expect(container.querySelector("svg")).not.toBeNull();
  });
});
