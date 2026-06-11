import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ReactFlow,
  Background,
  MiniMap,
  Panel,
  useNodesState,
  useEdgesState,
  useReactFlow,
  type Node,
  type Edge,
  type NodeMouseHandler,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import CustomNode from "./CustomNode";
import GroupNode from "./GroupNode";
import { applyDagreLayout } from "./dagLayout";
import { EDGE_COLORS, NODE_COLORS, ROLE_CATEGORY_COLORS } from "./nodeIcons";
import { C } from "../../utils/colors";
import { useDagStore } from "../../stores/dagStore";
import { useAuthStore } from "../../stores/authStore";
import { useGrantStore } from "../../stores/grantStore";
import type { DAGGraph } from "../../types";

const nodeTypes = { custom: CustomNode, group: GroupNode };

interface Props {
  data: DAGGraph | null;
  direction?: "TB" | "LR";
  loading?: boolean;
  hiddenNodes?: Set<string>;
}

export default function DAGView({ data, direction = "TB", loading, hiddenNodes }: Props) {
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const { selectedNode, setSelectedNode, setPanelMode, setGroupChildren, visibleTypes, groupsOnly } = useDagStore();

  // Track clicked node ID for highlight
  const [clickedNodeId, setClickedNodeId] = useState<string | null>(null);

  // When selectedNode changes from sidebar, find matching node in DAG and highlight
  useEffect(() => {
    if (!selectedNode || !data) return;
    // Find by label match
    const match = data.nodes.find(
      (n) => n.label === selectedNode.label && n.type === selectedNode.type
    );
    if (match) {
      setClickedNodeId(match.id);
    }
  }, [selectedNode, data]);

  // Connected node IDs for highlight — full chain (ancestors + descendants)
  const connectedIds = useMemo(() => {
    if (!clickedNodeId || !data) return new Set<string>();
    const ids = new Set<string>([clickedNodeId]);

    // Build adjacency: source→targets and target→sources
    const children = new Map<string, string[]>();
    const parents = new Map<string, string[]>();
    data.edges.forEach((e) => {
      children.set(e.source, [...(children.get(e.source) || []), e.target]);
      parents.set(e.target, [...(parents.get(e.target) || []), e.source]);
    });

    // BFS downward (descendants)
    const queue = [clickedNodeId];
    while (queue.length) {
      const node = queue.shift()!;
      for (const child of children.get(node) || []) {
        if (!ids.has(child)) { ids.add(child); queue.push(child); }
      }
    }

    // BFS upward (ancestors)
    const queue2 = [clickedNodeId];
    while (queue2.length) {
      const node = queue2.shift()!;
      for (const parent of parents.get(node) || []) {
        if (!ids.has(parent)) { ids.add(parent); queue2.push(parent); }
      }
    }

    return ids;
  }, [clickedNodeId, data]);

  // Shared layout builder: filters visible nodes → builds RF nodes/edges → dagre layout
  const buildLayout = useCallback(() => {
    if (!data) return null;

    const visibleDataNodes = data.nodes.filter((n) => {
      // Type filter: group nodes follow their type's visibility
      if (!visibleTypes[n.type]) return false;
      // Groups Only: keep structural nodes + group nodes only
      if (groupsOnly && n.node_role !== "group" && !["system", "catalog", "database"].includes(n.type)) return false;
      // hiddenNodes filtering (by label and parent catalog/database)
      if (hiddenNodes && hiddenNodes.size > 0) {
        if (hiddenNodes.has(n.label)) return false;
        const meta = n.metadata || {};
        const db = meta.database as string | undefined;
        const cat = meta.catalog as string | undefined;
        if (db && hiddenNodes.has(db)) return false;
        if (cat && hiddenNodes.has(cat)) return false;
      }
      return true;
    });
    const visibleDataIds = new Set(visibleDataNodes.map((n) => n.id));
    const visibleDataEdges = data.edges.filter((e) => visibleDataIds.has(e.source) && visibleDataIds.has(e.target));

    const rfNodes: Node[] = visibleDataNodes.map((n) => ({
      id: n.id,
      type: "custom",
      position: { x: 0, y: 0 },
      data: {
        label: n.label,
        nodeType: n.type,
        nodeRole: n.node_role,
        color: n.color || (n.type === "role" && n.metadata?.role_category ? ROLE_CATEGORY_COLORS[n.metadata.role_category as string] : undefined) || NODE_COLORS[n.type],
      },
    }));

    const groupNodeIds = new Set(visibleDataNodes.filter((n) => n.node_role === "group").map((n) => n.id));
    const groupChildEdges = new Set(
      visibleDataEdges.filter((e) => groupNodeIds.has(e.source)).map((e) => e.id)
    );

    const rfEdges: Edge[] = visibleDataEdges.map((e) => {
      const isGroupChild = groupChildEdges.has(e.id);
      return {
        id: e.id,
        source: e.source,
        target: e.target,
        type: "default",
        animated: false,
        hidden: isGroupChild,
        style: {
          stroke: EDGE_COLORS[e.edge_type] || C.borderLight,
          strokeWidth: 2,
          strokeDasharray: e.edge_type === "hierarchy" || e.edge_type === "usage" ? "6 4" : undefined,
        },
        markerEnd: isGroupChild ? undefined : { type: "arrowclosed" as const, color: EDGE_COLORS[e.edge_type] || C.borderLight, width: 12, height: 12 },
      };
    });

    return applyDagreLayout(rfNodes, rfEdges, direction);
  }, [data, direction, visibleTypes, groupsOnly, hiddenNodes]);

  const reactFlow = useReactFlow();

  // Run layout on data/filter changes, then fit view
  useEffect(() => {
    const result = buildLayout();
    if (result) {
      setNodes(result.nodes);
      setEdges(result.edges);
      // fitView after React Flow processes the new nodes
      setTimeout(() => reactFlow.fitView({ padding: 0.1, duration: 200 }), 50);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [buildLayout, setNodes, setEdges]);

  // Apply highlight/dim (visibility is already handled in the layout effect)
  const filteredNodes = useMemo(() => {
    return nodes.map((n) => {
      const dimmed = clickedNodeId !== null && !connectedIds.has(n.id);
      return {
        ...n,
        style: { ...n.style, opacity: dimmed ? 0.15 : 1, transition: "opacity 0.2s" },
      };
    });
  }, [nodes, clickedNodeId, connectedIds]);

  const filteredEdges = useMemo(() => {
    return edges.map((e) => {
      const highlighted = connectedIds.has(e.source) && connectedIds.has(e.target);
      const dimmed = clickedNodeId !== null && !highlighted;
      return {
        ...e,
        style: {
          ...e.style,
          strokeWidth: highlighted && clickedNodeId ? 3 : 2,
          opacity: dimmed ? 0.1 : 1,
          transition: "opacity 0.2s",
        },
      };
    });
  }, [edges, clickedNodeId, connectedIds]);

  // Node click
  const onNodeClick: NodeMouseHandler = useCallback(
    (_event, node) => {
      const d = node.data as { nodeType: string; nodeRole?: string; label: string };
      const dagNode = data?.nodes.find((n) => n.id === node.id);
      if (!dagNode) return;

      setClickedNodeId(node.id);
      setSelectedNode(dagNode);

      if (d.nodeRole === "group") {
        const childIds = data?.edges.filter((e) => e.source === node.id).map((e) => e.target) || [];
        const children = data?.nodes.filter((n) => childIds.includes(n.id)) || [];
        setGroupChildren(children);
        setPanelMode("group");
      } else if (d.nodeType === "user") {
        setPanelMode("user");
      } else {
        setPanelMode("object");
      }
    },
    [data, setSelectedNode, setPanelMode, setGroupChildren]
  );

  // Right-click on a node → contextual "Manage privileges" menu (grant-capable admins only)
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; nodeId: string } | null>(null);
  const onNodeContextMenu: NodeMouseHandler = useCallback(
    (event, node) => {
      if (!useAuthStore.getState().user?.can_manage_grants) return;
      event.preventDefault();
      const bounds = (event.currentTarget as HTMLElement).closest(".react-flow")?.getBoundingClientRect();
      setCtxMenu({
        x: event.clientX - (bounds?.left ?? 0),
        y: event.clientY - (bounds?.top ?? 0),
        nodeId: node.id,
      });
    },
    []
  );

  const handleCtxManage = useCallback(() => {
    const dagNode = data?.nodes.find((n) => n.id === ctxMenu?.nodeId);
    setCtxMenu(null);
    if (!dagNode) return;
    const t = dagNode.type.toLowerCase();
    const openWizard = useGrantStore.getState().openWizard;
    if (t === "user" || t === "role") {
      openWizard({ grantee: { name: dagNode.label, type: t === "role" ? "ROLE" : "USER" } });
    } else if (["catalog", "database", "table", "view", "mv", "function"].includes(t)) {
      const meta = (dagNode.metadata ?? {}) as { catalog?: string; database?: string };
      openWizard({
        object: {
          object_type: t === "mv" ? "MATERIALIZED VIEW" : t.toUpperCase(),
          catalog: t === "catalog" ? dagNode.label : (meta.catalog ?? "default_catalog"),
          database: t === "catalog" ? null : t === "database" ? dagNode.label : meta.database,
          name: ["catalog", "database"].includes(t) ? null : dagNode.label,
        },
      });
    } else {
      // group/system nodes — open without prefill rather than doing nothing
      openWizard();
    }
  }, [data, ctxMenu]);

  // Click on background → clear highlight
  const onPaneClick = useCallback(() => {
    setClickedNodeId(null);
    setCtxMenu(null);
  }, []);

  const handleRelayout = useCallback(() => {
    const result = buildLayout();
    if (result) {
      setNodes(result.nodes);
      setEdges(result.edges);
    }
  }, [buildLayout, setNodes, setEdges]);

  if (loading || (!data && nodes.length === 0)) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", color: C.text2, fontSize: 14 }}>
        Loading DAG...
      </div>
    );
  }

  return (
    <div style={{ width: "100%", height: "100%", position: "relative" }}>
      {ctxMenu && (
        <div
          data-testid="dag-context-menu"
          style={{ position: "absolute", left: ctxMenu.x, top: ctxMenu.y, zIndex: 50, background: C.card, border: `1px solid ${C.borderLight}`, borderRadius: 6, boxShadow: "0 6px 16px rgba(0,0,0,0.4)", overflow: "hidden" }}
        >
          <button
            onClick={handleCtxManage}
            style={{ display: "block", padding: "8px 14px", fontSize: 12.5, color: C.text1, background: "transparent", border: "none", cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap" }}
            onMouseEnter={(e) => (e.currentTarget.style.background = C.bg)}
            onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
          >
            ⚙ Manage privileges…
          </button>
        </div>
      )}
      <ReactFlow
        nodes={filteredNodes}
        edges={filteredEdges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        nodeTypes={nodeTypes}
        onNodeClick={onNodeClick}
        onNodeContextMenu={onNodeContextMenu}
        onPaneClick={onPaneClick}
        fitView
        fitViewOptions={{ padding: 0.1 }}
        minZoom={0.1}
        maxZoom={3}
        proOptions={{ hideAttribution: true }}
      >
        <Background color={C.border} gap={24} size={1} />
        <MiniMap
          nodeColor={(n) => {
            const d = n.data as { color?: string };
            return d.color || C.borderLight;
          }}
          maskColor="rgba(15,23,42,0.8)"
          style={{ background: C.card, border: `1px solid ${C.borderLight}`, borderRadius: 8 }}
        />
        <Panel position="bottom-left">
          <DagControls onRelayout={handleRelayout} />
        </Panel>
      </ReactFlow>
    </div>
  );
}

/* ── Custom control bar ── */
const ctrlBar: React.CSSProperties = {
  display: "flex", gap: 2, background: C.card, border: `1px solid ${C.borderLight}`,
  borderRadius: 8, padding: 3,
};
const ctrlBtn: React.CSSProperties = {
  width: 32, height: 32, border: "none", background: "transparent",
  color: C.text2, borderRadius: 6, fontSize: 16, cursor: "pointer",
  display: "flex", alignItems: "center", justifyContent: "center",
  fontFamily: "inherit",
};

function DagControls({ onRelayout }: { onRelayout: () => void }) {
  const { zoomIn, zoomOut, fitView } = useReactFlow();

  const hover = (e: React.MouseEvent) => {
    (e.currentTarget as HTMLElement).style.background = C.border;
    (e.currentTarget as HTMLElement).style.color = C.text1;
  };
  const leave = (e: React.MouseEvent) => {
    (e.currentTarget as HTMLElement).style.background = "transparent";
    (e.currentTarget as HTMLElement).style.color = C.text2;
  };

  return (
    <div style={ctrlBar}>
      <button style={ctrlBtn} title="Zoom In" onClick={() => zoomIn()} onMouseEnter={hover} onMouseLeave={leave}>
        <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
      </button>
      <button style={ctrlBtn} title="Zoom Out" onClick={() => zoomOut()} onMouseEnter={hover} onMouseLeave={leave}>
        <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}><line x1="5" y1="12" x2="19" y2="12"/></svg>
      </button>
      <button style={ctrlBtn} title="Fit View" onClick={() => fitView({ padding: 0.1 })} onMouseEnter={hover} onMouseLeave={leave}>
        <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/></svg>
      </button>
      <div style={{ width: 1, height: 20, background: C.borderLight, alignSelf: "center" }} />
      <button style={ctrlBtn} title="Re-layout" onClick={onRelayout} onMouseEnter={hover} onMouseLeave={leave}>
        <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path d="M1 4v6h6"/><path d="M23 20v-6h-6"/><path d="M20.49 9A9 9 0 0 0 5.64 5.64L1 10m22 4l-4.64 4.36A9 9 0 0 1 3.51 15"/></svg>
      </button>
    </div>
  );
}
