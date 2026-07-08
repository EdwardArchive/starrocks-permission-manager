/**
 * useDagLayoutSync — owns the ReactFlow node/edge state and keeps it laid out.
 *
 * `buildLayout` filters the source graph by the active type filters
 * (visibleTypes / groupsOnly / hiddenNodes), maps it to ReactFlow nodes/edges,
 * and runs the dagre layout. The effect re-runs (and fit-views) whenever the
 * data or any filter changes; `handleRelayout` re-lays the current graph on
 * demand. Pure extraction from DAGView — behavior identical.
 */
import { useCallback, useEffect } from "react";
import {
  useNodesState,
  useEdgesState,
  useReactFlow,
  type Node,
  type Edge,
} from "@xyflow/react";
import { applyDagreLayout } from "./dagLayout";
import { EDGE_COLORS, NODE_COLORS, ROLE_CATEGORY_COLORS } from "./nodeIcons";
import { C } from "../../utils/colors";
import type { DAGGraph } from "../../types";

interface LayoutInput {
  data: DAGGraph | null;
  direction: "TB" | "LR";
  visibleTypes: Record<string, boolean>;
  groupsOnly: boolean;
  hiddenNodes?: Set<string>;
}

/**
 * Filter + map + dagre-lay a DAG graph. Pure: no React, no store. Exported so
 * the filter branches (visibleTypes / groupsOnly / hiddenNodes) can be unit
 * tested directly without a ReactFlow host.
 */
export function buildDagLayout(
  data: DAGGraph | null,
  direction: "TB" | "LR",
  visibleTypes: Record<string, boolean>,
  groupsOnly: boolean,
  hiddenNodes?: Set<string>,
): { nodes: Node[]; edges: Edge[] } | null {
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
}

export function useDagLayoutSync({ data, direction, visibleTypes, groupsOnly, hiddenNodes }: LayoutInput) {
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);

  // Shared layout builder: filters visible nodes → builds RF nodes/edges → dagre layout
  const buildLayout = useCallback(
    () => buildDagLayout(data, direction, visibleTypes, groupsOnly, hiddenNodes),
    [data, direction, visibleTypes, groupsOnly, hiddenNodes],
  );

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

  const handleRelayout = useCallback(() => {
    const result = buildLayout();
    if (result) {
      setNodes(result.nodes);
      setEdges(result.edges);
    }
  }, [buildLayout, setNodes, setEdges]);

  return { nodes, edges, onNodesChange, onEdgesChange, handleRelayout };
}
