/**
 * useDagHighlight — clicked/selected-node highlight for the DAG.
 *
 * Owns `clickedNodeId`, keeps it in sync with the sidebar's `selectedNode`,
 * derives the connected subgraph (full ancestor + descendant chain via BFS),
 * and decorates the live ReactFlow `nodes`/`edges` with highlight/dim styling.
 *
 * Pure extraction from DAGView — behavior identical. Visibility filtering lives
 * in useDagLayoutSync; this hook only applies opacity/stroke decoration.
 */
import { useEffect, useMemo, useState } from "react";
import type { Node, Edge } from "@xyflow/react";
import type { DAGGraph, DAGNode } from "../../types";

export function useDagHighlight(
  data: DAGGraph | null,
  selectedNode: DAGNode | null,
  nodes: Node[],
  edges: Edge[],
) {
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
      // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional: sync local highlight from the store's selection (same sanctioned pattern as PermissionDetailTab)
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

  return { clickedNodeId, setClickedNodeId, connectedIds, filteredNodes, filteredEdges };
}
