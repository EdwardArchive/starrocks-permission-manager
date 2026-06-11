import { describe, it, expect, vi } from "vitest";
import { render } from "../../test/test-utils";
import DAGView from "./DAGView";

vi.mock("@xyflow/react", () => ({
  ReactFlow: ({ children, onlyRenderVisibleElements }: { children?: unknown; onlyRenderVisibleElements?: boolean }) => (
    <div data-testid="reactflow" data-cull={String(!!onlyRenderVisibleElements)}>
      {children as never}
    </div>
  ),
  Background: () => <div />,
  MiniMap: () => <div />,
  Panel: ({ children }: { children?: unknown }) => <div>{children as never}</div>,
  useNodesState: () => [[], vi.fn(), vi.fn()],
  useEdgesState: () => [[], vi.fn(), vi.fn()],
  useReactFlow: () => ({ fitView: vi.fn() }),
}));
vi.mock("./dagLayout", () => ({ applyDagreLayout: vi.fn(() => []) }));
vi.mock("./nodeIcons", () => ({ EDGE_COLORS: {}, NODE_COLORS: {}, ROLE_CATEGORY_COLORS: {} }));
vi.mock("../../utils/colors", () => ({ C: { border: "#000", borderLight: "#111", bg: "#222", text2: "#333" } }));

vi.mock("../../stores/dagStore", () => {
  const STATE = {
    selectedNode: null,
    setSelectedNode: vi.fn(),
    setPanelMode: vi.fn(),
    setGroupChildren: vi.fn(),
    visibleTypes: new Set<string>(),
    groupsOnly: false,
  };
  return { useDagStore: vi.fn((sel) => sel(STATE)) };
});

// Stable reference so the data-change effect doesn't re-run every render.
const DATA = { nodes: [], edges: [] };

describe("DAGView", () => {
  it("renders ReactFlow with viewport culling (onlyRenderVisibleElements) enabled", () => {
    const { getByTestId } = render(<DAGView data={DATA} />);
    expect(getByTestId("reactflow").getAttribute("data-cull")).toBe("true");
  });
});
