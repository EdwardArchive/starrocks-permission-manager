import { useReactFlow } from "@xyflow/react";
import { C } from "../../utils/colors";

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

export default function DagControls({ onRelayout }: { onRelayout: () => void }) {
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
