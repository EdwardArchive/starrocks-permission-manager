import { useMemo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { colorizedSvg, NODE_COLORS } from "./nodeIcons";
import { C } from "../../utils/colors";

interface CustomData {
  label: string;
  nodeType: string;
  nodeRole?: string;
  color?: string;
  [key: string]: unknown;
}

// Fixed width for all nodes (text truncated with ellipsis)
const FIXED_W = 168;

export default function CustomNode({ data }: NodeProps) {
  const d = data as CustomData;
  const color = d.color || NODE_COLORS[d.nodeType] || "#6b7280";
  const svgHtml = useMemo(() => {
    const raw = colorizedSvg(d.nodeType, color);
    if (!raw) return "";
    return raw.replace(/width="[^"]*"/, 'width="20"').replace(/height="[^"]*"/, 'height="20"');
  }, [d.nodeType, color]);

  return (
    <>
      <Handle type="target" position={Position.Top} style={{ background: "transparent", border: "none", width: 8, height: 8 }} />
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 6,
          padding: "6px 10px",
          borderRadius: 8,
          border: `2px solid ${color}`,
          background: C.card,
          width: FIXED_W,
          boxShadow: "0 2px 6px rgba(0,0,0,0.3)",
        }}
      >
        {svgHtml && (
          <span
            style={{ flexShrink: 0, width: 20, height: 20, display: "inline-flex", alignItems: "center" }}
            dangerouslySetInnerHTML={{ __html: svgHtml }}
          />
        )}
        <span style={{
          fontSize: 12, fontWeight: 500, color: C.text1,
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          textAlign: "center", flex: 1,
        }}>
          {formatNodeLabel(d.label, d.nodeType)}
        </span>
      </div>
      <Handle type="source" position={Position.Bottom} style={{ background: "transparent", border: "none", width: 8, height: 8 }} />
    </>
  );
}

/** Parse 'name'@'host' → "name" for user nodes in DAG */
function formatNodeLabel(label: string, nodeType: string): string {
  if (nodeType === "user") {
    const m = label.match(/^'?([^'@]+)'?@/);
    if (m) return m[1];
  }
  return label;
}
