import { useState } from "react";
import { C } from "../../utils/colors";

export default function ExportPngBtn() {
  const [exporting, setExporting] = useState(false);
  const handleExport = async () => {
    const el = document.querySelector(".react-flow") as HTMLElement | null;
    if (!el) return;
    setExporting(true);
    try {
      const { toPng } = await import("html-to-image");
      const dataUrl = await toPng(el, {
        backgroundColor: C.bg,
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
        padding: "6px 12px", background: C.card, border: `1px solid ${C.borderLight}`,
        borderRadius: 6, fontSize: 12, color: C.text2, cursor: exporting ? "wait" : "pointer", fontFamily: "inherit",
        display: "flex", alignItems: "center", gap: 4,
        opacity: exporting ? 0.6 : 1,
      }}
      onMouseEnter={(e) => { if (!exporting) { e.currentTarget.style.borderColor = C.accent; e.currentTarget.style.color = C.accent; } }}
      onMouseLeave={(e) => { e.currentTarget.style.borderColor = C.borderLight; e.currentTarget.style.color = C.text2; }}
    >
      {exporting ? "Exporting..." : "PNG"}
    </button>
  );
}
