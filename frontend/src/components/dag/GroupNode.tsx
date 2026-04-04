import { Handle, Position, type NodeProps } from "@xyflow/react";
import { NODE_COLORS, colorizedSvg } from "./nodeIcons";

interface GroupData {
  label: string;
  nodeType: string;
  color?: string;
  containerW?: number;
  containerH?: number;
  [key: string]: unknown;
}

export default function GroupNode({ data }: NodeProps) {
  const d = data as GroupData;
  const color = d.color || NODE_COLORS[d.nodeType] || "#6b7280";
  const w = d.containerW || 200;
  const h = d.containerH || 100;
  const svg = colorizedSvg(d.nodeType, color);

  return (
    <>
      <Handle type="target" position={Position.Top} style={{ background: "transparent", border: "none", width: 8, height: 8 }} />
      <div
        style={{
          width: w,
          height: h,
          borderRadius: 12,
          border: `2px dashed ${color}40`,
          background: `${color}0a`,
          position: "relative",
          overflow: "hidden",
        }}
      >
        {/* Group label bar */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 5,
            padding: "5px 10px",
            fontSize: 11,
            fontWeight: 600,
            color: color,
            background: `${color}12`,
            borderBottom: `1px solid ${color}20`,
          }}
        >
          {svg && (
            <span
              style={{ width: 16, height: 16, display: "inline-flex" }}
              dangerouslySetInnerHTML={{
                __html: svg.replace(/width="[^"]*"/, 'width="16"').replace(/height="[^"]*"/, 'height="16"'),
              }}
            />
          )}
          {d.label}
        </div>
      </div>
      <Handle type="source" position={Position.Bottom} style={{ background: "transparent", border: "none", width: 8, height: 8 }} />
    </>
  );
}
