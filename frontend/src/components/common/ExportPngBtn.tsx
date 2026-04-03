import { useState } from "react";

export default function ExportPngBtn() {
  const [exporting, setExporting] = useState(false);
  const handleExport = async () => {
    const el = document.querySelector(".react-flow") as HTMLElement | null;
    if (!el) return;
    setExporting(true);
    try {
      const { toPng } = await import("html-to-image");
      const dataUrl = await toPng(el, {
        backgroundColor: "#0f172a",
        pixelRatio: 2,
        filter: (node) => {
          if (node instanceof HTMLElement) {
            if (node.classList?.contains("react-flow__panel")) return false;
            if (node.classList?.contains("react-flow__controls")) return false;
          }
          return true;
        },
      });
      const link = document.createElement("a");
      link.download = `starrocks-permissions-${Date.now()}.png`;
      link.href = dataUrl;
      link.click();
    } catch (e) {
      console.error("PNG export failed:", e);
    } finally {
      setExporting(false);
    }
  };
  return (
    <button
      onClick={handleExport}
      disabled={exporting}
      style={{
        padding: "6px 12px", background: "#1e293b", border: "1px solid #475569",
        borderRadius: 6, fontSize: 12, color: "#94a3b8", cursor: exporting ? "wait" : "pointer", fontFamily: "inherit",
        display: "flex", alignItems: "center", gap: 4,
        opacity: exporting ? 0.6 : 1,
      }}
      onMouseEnter={(e) => { if (!exporting) { e.currentTarget.style.borderColor = "#3b82f6"; e.currentTarget.style.color = "#3b82f6"; } }}
      onMouseLeave={(e) => { e.currentTarget.style.borderColor = "#475569"; e.currentTarget.style.color = "#94a3b8"; }}
    >
      {exporting ? "Exporting..." : "PNG"}
    </button>
  );
}
