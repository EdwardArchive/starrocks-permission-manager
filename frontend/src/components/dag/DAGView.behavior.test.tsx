import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, fireEvent } from "@testing-library/react";
import type { Node, Edge, NodeMouseHandler } from "@xyflow/react";
import { render } from "../../test/test-utils";
import { useDagHighlight } from "./useDagHighlight";
import { buildDagLayout } from "./useDagLayoutSync";
import { useNodeContextMenu } from "./useNodeContextMenu";
import DAGView from "./DAGView";
import { useAuthStore } from "../../stores/authStore";
import { useGrantStore } from "../../stores/grantStore";
import { useDagStore } from "../../stores/dagStore";
import type { DAGGraph, UserInfo } from "../../types";

/**
 * File-wide ReactFlow mock: <ReactFlow> captures its props (so component tests
 * can invoke the wired onNodeClick / onPaneClick / onNodeContextMenu handlers)
 * and renders its children. The pure-hook tests below don't touch @xyflow at
 * runtime (they import types only), so the mock is inert for them.
 */
const rf = vi.hoisted(() => ({ props: {} as Record<string, unknown> }));
vi.mock("@xyflow/react", () => ({
  ReactFlow: (props: Record<string, unknown>) => {
    rf.props = props;
    return <div data-testid="reactflow">{props.children as never}</div>;
  },
  Background: () => null,
  MiniMap: () => null,
  Panel: ({ children }: { children?: unknown }) => <div>{children as never}</div>,
  useNodesState: () => [[], vi.fn(), vi.fn()],
  useEdgesState: () => [[], vi.fn(), vi.fn()],
  useReactFlow: () => ({ fitView: vi.fn(), zoomIn: vi.fn(), zoomOut: vi.fn() }),
}));

/* ── fixtures ── */
// Chain a→b→c→d plus a disconnected x→y, to exercise multi-hop BFS both ways.
const CHAIN: DAGGraph = {
  nodes: [
    { id: "a", label: "A", type: "role" },
    { id: "b", label: "B", type: "role" },
    { id: "c", label: "C", type: "role" },
    { id: "d", label: "D", type: "role" },
    { id: "x", label: "X", type: "role" },
    { id: "y", label: "Y", type: "role" },
  ],
  edges: [
    { id: "a-b", source: "a", target: "b", edge_type: "inherit" },
    { id: "b-c", source: "b", target: "c", edge_type: "inherit" },
    { id: "c-d", source: "c", target: "d", edge_type: "inherit" },
    { id: "x-y", source: "x", target: "y", edge_type: "inherit" },
  ],
};

const rfNode = (id: string): Node => ({ id, position: { x: 0, y: 0 }, data: {} });
const rfEdge = (id: string, source: string, target: string): Edge => ({ id, source, target });
const CHAIN_RF_NODES = CHAIN.nodes.map((n) => rfNode(n.id));
const CHAIN_RF_EDGES = CHAIN.edges.map((e) => rfEdge(e.id, e.source, e.target));

describe("useDagHighlight", () => {
  it("no clicked node → nothing dimmed (opacity 1, base strokeWidth)", () => {
    const { result } = renderHook(() => useDagHighlight(CHAIN, null, CHAIN_RF_NODES, CHAIN_RF_EDGES));
    expect(result.current.clickedNodeId).toBeNull();
    expect(result.current.connectedIds.size).toBe(0);
    expect(result.current.filteredNodes.every((n) => n.style?.opacity === 1)).toBe(true);
    expect(result.current.filteredEdges.every((e) => e.style?.opacity === 1 && e.style?.strokeWidth === 2)).toBe(true);
  });

  it("clicking a mid-chain node connects full ancestor + descendant chain (multi-hop)", () => {
    const { result } = renderHook(() => useDagHighlight(CHAIN, null, CHAIN_RF_NODES, CHAIN_RF_EDGES));
    act(() => result.current.setClickedNodeId("c"));
    // ancestors b,a (upward, 2 hops) + descendants d (downward) + self c
    expect(result.current.connectedIds).toEqual(new Set(["a", "b", "c", "d"]));
    // disconnected x/y excluded
    expect(result.current.connectedIds.has("x")).toBe(false);
  });

  it("dims non-connected nodes and edges; highlights connected edges (strokeWidth 3)", () => {
    const { result } = renderHook(() => useDagHighlight(CHAIN, null, CHAIN_RF_NODES, CHAIN_RF_EDGES));
    act(() => result.current.setClickedNodeId("c"));

    const byId = Object.fromEntries(result.current.filteredNodes.map((n) => [n.id, n.style?.opacity]));
    expect(byId["b"]).toBe(1); // connected
    expect(byId["x"]).toBe(0.15); // dimmed

    const edgeById = Object.fromEntries(result.current.filteredEdges.map((e) => [e.id, e.style]));
    expect(edgeById["a-b"]).toMatchObject({ opacity: 1, strokeWidth: 3 }); // both endpoints connected
    expect(edgeById["x-y"]).toMatchObject({ opacity: 0.1 }); // neither connected
  });

  it("syncs clickedNodeId from selectedNode by label+type match", () => {
    const selected = { id: "ignored", label: "C", type: "role" };
    const { result } = renderHook(() => useDagHighlight(CHAIN, selected, CHAIN_RF_NODES, CHAIN_RF_EDGES));
    // effect matched selectedNode → clicked the DAG node with the same label/type
    expect(result.current.clickedNodeId).toBe("c");
    expect(result.current.connectedIds).toEqual(new Set(["a", "b", "c", "d"]));
  });

  it("selectedNode with no matching label leaves clickedNodeId null", () => {
    const selected = { id: "z", label: "ZZZ", type: "role" };
    const { result } = renderHook(() => useDagHighlight(CHAIN, selected, CHAIN_RF_NODES, CHAIN_RF_EDGES));
    expect(result.current.clickedNodeId).toBeNull();
  });
});

describe("buildDagLayout (filter branches)", () => {
  const allVisible: Record<string, boolean> = {
    system: true, catalog: true, database: true, table: true, view: true, mv: true, function: true, user: true, role: true,
  };

  const GRAPH: DAGGraph = {
    nodes: [
      { id: "sys", label: "System", type: "system" },
      { id: "cat", label: "hive", type: "catalog" },
      { id: "db", label: "sales", type: "database" },
      { id: "tbl", label: "orders", type: "table", metadata: { catalog: "hive", database: "sales" } },
      { id: "grp", label: "Tables", type: "table", node_role: "group" },
    ],
    edges: [
      { id: "sys-cat", source: "sys", target: "cat", edge_type: "contains" },
      { id: "cat-db", source: "cat", target: "db", edge_type: "contains" },
      { id: "db-tbl", source: "db", target: "tbl", edge_type: "contains" },
      { id: "grp-tbl", source: "grp", target: "tbl", edge_type: "contains" },
    ],
  };

  const ids = (r: { nodes: Node[] } | null) => (r?.nodes ?? []).map((n) => n.id).sort();

  it("returns null when data is null", () => {
    expect(buildDagLayout(null, "TB", allVisible, false, undefined)).toBeNull();
  });

  it("keeps all nodes when everything visible", () => {
    const r = buildDagLayout(GRAPH, "TB", allVisible, false, undefined);
    expect(ids(r)).toEqual(["cat", "db", "grp", "sys", "tbl"]);
  });

  it("visibleTypes=false for a type removes those nodes", () => {
    const r = buildDagLayout(GRAPH, "TB", { ...allVisible, table: false }, false, undefined);
    // both the table node and the group node (type 'table') drop out
    expect(ids(r)).toEqual(["cat", "db", "sys"]);
  });

  it("groupsOnly keeps structural (system/catalog/database) + group nodes only", () => {
    const r = buildDagLayout(GRAPH, "TB", allVisible, true, undefined);
    // 'tbl' (plain table) removed; 'grp' (node_role group) kept; structural kept
    expect(ids(r)).toEqual(["cat", "db", "grp", "sys"]);
  });

  it("hiddenNodes hides by exact label", () => {
    const r = buildDagLayout(GRAPH, "TB", allVisible, false, new Set(["orders"]));
    expect(ids(r)).not.toContain("tbl");
  });

  it("hiddenNodes hides children by parent database label", () => {
    const r = buildDagLayout(GRAPH, "TB", allVisible, false, new Set(["sales"]));
    // tbl.metadata.database === 'sales' → hidden
    expect(ids(r)).not.toContain("tbl");
  });

  it("hiddenNodes hides children by parent catalog label", () => {
    const r = buildDagLayout(GRAPH, "TB", allVisible, false, new Set(["hive"]));
    // tbl.metadata.catalog === 'hive' → hidden
    expect(ids(r)).not.toContain("tbl");
  });

  it("edges are pruned to visible endpoints", () => {
    const r = buildDagLayout(GRAPH, "TB", { ...allVisible, table: false }, false, undefined);
    const edgeIds = (r?.edges ?? []).map((e) => e.id);
    // db-tbl and grp-tbl reference the removed table/group → gone
    expect(edgeIds).not.toContain("db-tbl");
    expect(edgeIds).not.toContain("grp-tbl");
    expect(edgeIds).toContain("cat-db");
  });

  it("group→child edges are hidden but retained", () => {
    const r = buildDagLayout(GRAPH, "TB", allVisible, false, undefined);
    const grpEdge = (r?.edges ?? []).find((e) => e.id === "grp-tbl");
    expect(grpEdge?.hidden).toBe(true);
  });
});

describe("useNodeContextMenu", () => {
  const MENU_GRAPH: DAGGraph = {
    nodes: [
      { id: "sys1", label: "System", type: "system" },
      { id: "u1", label: "alice", type: "user" },
      { id: "r1", label: "admin_role", type: "role" },
      { id: "cat1", label: "hive", type: "catalog" },
      { id: "tbl1", label: "orders", type: "table", metadata: { catalog: "hive", database: "sales" } },
    ],
    edges: [],
  };

  const admin: UserInfo = {
    username: "root", roles: [], default_role: null, is_user_admin: true, can_manage_grants: true,
  };

  const origOpenWizard = useGrantStore.getState().openWizard;
  let openWizard: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    openWizard = vi.fn();
    useGrantStore.setState({ openWizard: openWizard as unknown as typeof origOpenWizard });
    useAuthStore.setState({ user: admin });
  });

  afterEach(() => {
    useGrantStore.setState({ openWizard: origOpenWizard });
    useAuthStore.setState({ user: null });
  });

  function ctxEvent(clientX = 100, clientY = 50): { evt: React.MouseEvent; preventDefault: ReturnType<typeof vi.fn> } {
    const preventDefault = vi.fn();
    const evt = {
      preventDefault,
      clientX,
      clientY,
      currentTarget: { closest: () => ({ getBoundingClientRect: () => ({ left: 10, top: 5 }) }) },
    } as unknown as React.MouseEvent;
    return { evt, preventDefault };
  }

  it("opens the menu at pointer position (offset by container bounds) for grant admins", () => {
    const { result } = renderHook(() => useNodeContextMenu(MENU_GRAPH));
    const { evt, preventDefault } = ctxEvent(100, 50);
    act(() => (result.current.onNodeContextMenu as NodeMouseHandler)(evt, { id: "u1" } as Node));
    expect(preventDefault).toHaveBeenCalled();
    expect(result.current.ctxMenu).toEqual({ x: 90, y: 45, nodeId: "u1" });
  });

  it("is a no-op when the user cannot manage grants", () => {
    useAuthStore.setState({ user: { ...admin, can_manage_grants: false } });
    const { result } = renderHook(() => useNodeContextMenu(MENU_GRAPH));
    const { evt, preventDefault } = ctxEvent();
    act(() => (result.current.onNodeContextMenu as NodeMouseHandler)(evt, { id: "u1" } as Node));
    expect(preventDefault).not.toHaveBeenCalled();
    expect(result.current.ctxMenu).toBeNull();
  });

  it("handleCtxManage opens the wizard with a grantee prefill for a user node", () => {
    const { result } = renderHook(() => useNodeContextMenu(MENU_GRAPH));
    act(() => result.current.setCtxMenu({ x: 0, y: 0, nodeId: "u1" }));
    act(() => result.current.handleCtxManage());
    expect(openWizard).toHaveBeenCalledWith({ grantee: { name: "alice", type: "USER" } });
    expect(result.current.ctxMenu).toBeNull(); // menu closes
  });

  it("handleCtxManage → ROLE grantee for a role node", () => {
    const { result } = renderHook(() => useNodeContextMenu(MENU_GRAPH));
    act(() => result.current.setCtxMenu({ x: 0, y: 0, nodeId: "r1" }));
    act(() => result.current.handleCtxManage());
    expect(openWizard).toHaveBeenCalledWith({ grantee: { name: "admin_role", type: "ROLE" } });
  });

  it("handleCtxManage → catalog object prefill (db/name null)", () => {
    const { result } = renderHook(() => useNodeContextMenu(MENU_GRAPH));
    act(() => result.current.setCtxMenu({ x: 0, y: 0, nodeId: "cat1" }));
    act(() => result.current.handleCtxManage());
    expect(openWizard).toHaveBeenCalledWith({
      object: { object_type: "CATALOG", catalog: "hive", database: null, name: null },
    });
  });

  it("handleCtxManage → table object prefill uses metadata catalog/database", () => {
    const { result } = renderHook(() => useNodeContextMenu(MENU_GRAPH));
    act(() => result.current.setCtxMenu({ x: 0, y: 0, nodeId: "tbl1" }));
    act(() => result.current.handleCtxManage());
    expect(openWizard).toHaveBeenCalledWith({
      object: { object_type: "TABLE", catalog: "hive", database: "sales", name: "orders" },
    });
  });

  it("handleCtxManage → blank wizard (no prefill) for an unmapped system node", () => {
    const { result } = renderHook(() => useNodeContextMenu(MENU_GRAPH));
    act(() => result.current.setCtxMenu({ x: 0, y: 0, nodeId: "sys1" }));
    act(() => result.current.handleCtxManage());
    expect(openWizard).toHaveBeenCalledWith(); // no args → open blank
    expect(result.current.ctxMenu).toBeNull();
  });

  it("handleCtxManage → early return (no wizard) when the node is not found", () => {
    const { result } = renderHook(() => useNodeContextMenu(MENU_GRAPH));
    act(() => result.current.setCtxMenu({ x: 0, y: 0, nodeId: "missing" }));
    act(() => result.current.handleCtxManage());
    expect(openWizard).not.toHaveBeenCalled();
    expect(result.current.ctxMenu).toBeNull();
  });
});

/* ── DAGView component: verifies the hooks are wired to ReactFlow ── */
describe("DAGView (handler wiring)", () => {
  const DATA: DAGGraph = {
    nodes: [
      { id: "u1", label: "alice", type: "user" },
      { id: "t1", label: "orders", type: "table" },
      { id: "g1", label: "Tables", type: "table", node_role: "group" },
    ],
    edges: [
      { id: "g1-t1", source: "g1", target: "t1", edge_type: "contains" },
    ],
  };

  const origOpenWizard = useGrantStore.getState().openWizard;

  beforeEach(() => {
    useDagStore.setState({ selectedNode: null, panelMode: null, groupChildren: [] });
    useAuthStore.setState({
      user: { username: "root", roles: [], default_role: null, is_user_admin: true, can_manage_grants: true },
    });
  });
  afterEach(() => {
    useAuthStore.setState({ user: null });
    useGrantStore.setState({ openWizard: origOpenWizard });
  });

  it("renders ReactFlow and wires the node/pane handlers", () => {
    const { getByTestId } = render(<DAGView data={DATA} />);
    expect(getByTestId("reactflow")).toBeTruthy();
    expect(typeof rf.props.onNodeClick).toBe("function");
    expect(typeof rf.props.onPaneClick).toBe("function");
  });

  it("node click on a user node selects it and opens the user panel", () => {
    render(<DAGView data={DATA} />);
    act(() => (rf.props.onNodeClick as NodeMouseHandler)({} as never, { id: "u1", data: { nodeType: "user", label: "alice" } } as unknown as Node));
    expect(useDagStore.getState().selectedNode?.id).toBe("u1");
    expect(useDagStore.getState().panelMode).toBe("user");
  });

  it("node click on a plain object opens the object panel", () => {
    render(<DAGView data={DATA} />);
    act(() => (rf.props.onNodeClick as NodeMouseHandler)({} as never, { id: "t1", data: { nodeType: "table", label: "orders" } } as unknown as Node));
    expect(useDagStore.getState().panelMode).toBe("object");
  });

  it("node click on a group node collects children and opens the group panel", () => {
    render(<DAGView data={DATA} />);
    act(() => (rf.props.onNodeClick as NodeMouseHandler)({} as never, { id: "g1", data: { nodeType: "table", nodeRole: "group", label: "Tables" } } as unknown as Node));
    expect(useDagStore.getState().panelMode).toBe("group");
    expect(useDagStore.getState().groupChildren.map((n) => n.id)).toEqual(["t1"]);
  });

  it("node click for an id absent from data is a no-op", () => {
    render(<DAGView data={DATA} />);
    act(() => (rf.props.onNodeClick as NodeMouseHandler)({} as never, { id: "ghost", data: { nodeType: "table", label: "?" } } as unknown as Node));
    expect(useDagStore.getState().panelMode).toBeNull();
  });

  it("right-click opens the context menu; its button triggers the grant wizard", () => {
    const openWizard = vi.fn();
    useGrantStore.setState({ openWizard });
    const { getByTestId, queryByTestId } = render(<DAGView data={DATA} />);

    const evt = {
      preventDefault: vi.fn(),
      clientX: 30,
      clientY: 20,
      currentTarget: { closest: () => ({ getBoundingClientRect: () => ({ left: 0, top: 0 }) }) },
    } as unknown as React.MouseEvent;
    act(() => (rf.props.onNodeContextMenu as NodeMouseHandler)(evt, { id: "u1" } as Node));

    const menu = getByTestId("dag-context-menu");
    expect(menu).toBeTruthy();
    fireEvent.click(menu.querySelector("button")!);
    expect(openWizard).toHaveBeenCalledWith({ grantee: { name: "alice", type: "USER" } });
    // menu closes after choosing
    expect(queryByTestId("dag-context-menu")).toBeNull();
  });

  it("pane click clears the highlight and the context menu", () => {
    const { queryByTestId } = render(<DAGView data={DATA} />);
    const evt = {
      preventDefault: vi.fn(),
      clientX: 10, clientY: 10,
      currentTarget: { closest: () => ({ getBoundingClientRect: () => ({ left: 0, top: 0 }) }) },
    } as unknown as React.MouseEvent;
    act(() => (rf.props.onNodeContextMenu as NodeMouseHandler)(evt, { id: "u1" } as Node));
    expect(queryByTestId("dag-context-menu")).toBeTruthy();
    act(() => (rf.props.onPaneClick as () => void)());
    expect(queryByTestId("dag-context-menu")).toBeNull();
  });

  it("shows the loading state when data is null and no nodes are laid out", () => {
    const { getByText } = render(<DAGView data={null} loading />);
    expect(getByText("Loading DAG...")).toBeTruthy();
  });
});
