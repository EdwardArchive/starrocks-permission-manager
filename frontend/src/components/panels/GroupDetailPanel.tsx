import { useState } from "react";
import { useDagStore } from "../../stores/dagStore";
import { NODE_COLORS } from "../dag/nodeIcons";
import InlineIcon from "../common/InlineIcon";

const PAGE_SIZE = 20;

export default function GroupDetailPanel() {
  const { selectedNode, groupChildren, setSelectedNode, setPanelMode } = useDagStore();
  const [page, setPage] = useState(0);

  if (!selectedNode) return null;

  const color = selectedNode.color || NODE_COLORS[selectedNode.type] || "#94a3b8";
  const total = groupChildren.length;
  const totalPages = Math.ceil(total / PAGE_SIZE);
  const pageItems = groupChildren.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  const clickChild = (child: typeof groupChildren[0]) => {
    setSelectedNode(child);
    setPanelMode(child.type === "user" ? "user" : "object");
  };

  return (
    <div>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
        <InlineIcon type={selectedNode.type} size={20} />
        <h3 style={{ fontSize: 15, fontWeight: 600, margin: 0 }}>{selectedNode.label}</h3>
      </div>
      <span style={{
        display: "inline-block", padding: "4px 10px", borderRadius: 6,
        fontSize: 12, fontWeight: 500, marginBottom: 12,
        background: `${color}20`, color,
      }}>
        {selectedNode.type.toUpperCase()} Group
      </span>
      <p style={{ fontSize: 13, fontWeight: 600, color: "#94a3b8", marginBottom: 12 }}>
        {total} Objects
        {totalPages > 1 && <span style={{ fontWeight: 400 }}> (page {page + 1}/{totalPages})</span>}
      </p>

      {/* Object list */}
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {pageItems.map((child) => (
          <button
            key={child.id}
            onClick={() => clickChild(child)}
            style={{
              display: "flex", alignItems: "center", gap: 10,
              padding: "10px 12px", borderRadius: 8, cursor: "pointer",
              border: "1px solid #475569", background: "#0f172a",
              width: "100%", textAlign: "left", fontFamily: "inherit",
              transition: "border-color 0.15s",
            }}
            onMouseEnter={(e) => (e.currentTarget.style.borderColor = "#3b82f6")}
            onMouseLeave={(e) => (e.currentTarget.style.borderColor = "#475569")}
          >
            <InlineIcon type={child.type} size={16} />
            <span style={{
              flex: 1, fontSize: 13, fontWeight: 500, color: "#e2e8f0",
              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
            }}>
              {child.label}
            </span>
            <span style={{ color: "#94a3b8", fontSize: 14, flexShrink: 0 }}>▸</span>
          </button>
        ))}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, marginTop: 14 }}>
          <PagerBtn label="◀" disabled={page === 0} onClick={() => setPage(page - 1)} />
          <span style={{ fontSize: 12, color: "#94a3b8" }}>{page + 1} / {totalPages}</span>
          <PagerBtn label="▶" disabled={page >= totalPages - 1} onClick={() => setPage(page + 1)} />
        </div>
      )}
    </div>
  );
}

function PagerBtn({ label, disabled, onClick }: { label: string; disabled: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        padding: "4px 10px", borderRadius: 6, fontSize: 12, cursor: disabled ? "default" : "pointer",
        border: "1px solid #475569", background: "#1e293b", fontFamily: "inherit",
        color: disabled ? "#334155" : "#94a3b8", opacity: disabled ? 0.5 : 1,
      }}
    >
      {label}
    </button>
  );
}
