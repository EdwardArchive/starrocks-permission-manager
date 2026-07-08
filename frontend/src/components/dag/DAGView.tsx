import { useCallback } from "react";
import {
  ReactFlow,
  Background,
  MiniMap,
  Panel,
  type NodeMouseHandler,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import CustomNode from "./CustomNode";
import GroupNode from "./GroupNode";
import DagControls from "./DagControls";
import { useDagLayoutSync } from "./useDagLayoutSync";
import { useDagHighlight } from "./useDagHighlight";
import { useNodeContextMenu } from "./useNodeContextMenu";
import { useShallow } from "zustand/react/shallow";
import { C } from "../../utils/colors";
import { useDagStore } from "../../stores/dagStore";
import type { DAGGraph } from "../../types";

const nodeTypes = { custom: CustomNode, group: GroupNode };

interface Props {
  data: DAGGraph | null;
  direction?: "TB" | "LR";
  loading?: boolean;
  hiddenNodes?: Set<string>;
}

export default function DAGView({ data, direction = "TB", loading, hiddenNodes }: Props) {
  const { selectedNode, setSelectedNode, setPanelMode, setGroupChildren, visibleTypes, groupsOnly } = useDagStore(
    useShallow((s) => ({
      selectedNode: s.selectedNode,
      setSelectedNode: s.setSelectedNode,
      setPanelMode: s.setPanelMode,
      setGroupChildren: s.setGroupChildren,
      visibleTypes: s.visibleTypes,
      groupsOnly: s.groupsOnly,
    })),
  );

  const { nodes, edges, onNodesChange, onEdgesChange, handleRelayout } = useDagLayoutSync({
    data, direction, visibleTypes, groupsOnly, hiddenNodes,
  });
  const { setClickedNodeId, filteredNodes, filteredEdges } = useDagHighlight(data, selectedNode, nodes, edges);
  const { ctxMenu, setCtxMenu, onNodeContextMenu, handleCtxManage } = useNodeContextMenu(data);

  // Node click → highlight + open the matching detail panel
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
    [data, setClickedNodeId, setSelectedNode, setPanelMode, setGroupChildren]
  );

  // Click on background → clear highlight + close context menu
  const onPaneClick = useCallback(() => {
    setClickedNodeId(null);
    setCtxMenu(null);
  }, [setClickedNodeId, setCtxMenu]);

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
        onlyRenderVisibleElements
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
