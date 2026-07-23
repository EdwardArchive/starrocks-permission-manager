import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import DagControls from "./DagControls";

const zoomIn = vi.fn();
const zoomOut = vi.fn();
const fitView = vi.fn();
vi.mock("@xyflow/react", () => ({
  useReactFlow: () => ({ zoomIn, zoomOut, fitView }),
}));
vi.mock("../../utils/colors", () => ({ C: { card: "#1e293b", border: "#334155", borderLight: "#475569", text1: "#e2e8f0", text2: "#94a3b8" } }));

describe("DagControls", () => {
  it("wires each control button to its React Flow action", () => {
    const onRelayout = vi.fn();
    const { getByTitle } = render(<DagControls onRelayout={onRelayout} />);

    fireEvent.click(getByTitle("Zoom In"));
    expect(zoomIn).toHaveBeenCalled();

    fireEvent.click(getByTitle("Zoom Out"));
    expect(zoomOut).toHaveBeenCalled();

    fireEvent.click(getByTitle("Fit View"));
    expect(fitView).toHaveBeenCalledWith({ padding: 0.1 });

    fireEvent.click(getByTitle("Re-layout"));
    expect(onRelayout).toHaveBeenCalled();
  });

  it("applies hover/leave styling on a button", () => {
    const { getByTitle } = render(<DagControls onRelayout={vi.fn()} />);
    const btn = getByTitle("Zoom In");
    fireEvent.mouseEnter(btn);
    expect(btn.style.background).toBeTruthy();
    fireEvent.mouseLeave(btn);
    expect(btn.style.background).toBe("transparent");
  });
});
