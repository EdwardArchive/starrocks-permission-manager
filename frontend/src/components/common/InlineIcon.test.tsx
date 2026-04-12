import { describe, it, expect, vi } from "vitest";
import { render } from "../../test/test-utils";
import InlineIcon from "./InlineIcon";

// Mock nodeIcons
vi.mock("../dag/nodeIcons", () => ({
  colorizedSvg: (type: string) => {
    if (type === "unknown") return "";
    return `<svg width="24" height="24"><circle cx="12" cy="12" r="10" stroke="${type}"/></svg>`;
  },
}));

describe("InlineIcon", () => {
  it("renders SVG content for known type", () => {
    const { container } = render(<InlineIcon type="table" />);
    expect(container.querySelector("svg")).not.toBeNull();
  });

  it("returns null for unknown type (empty SVG)", () => {
    const { container } = render(<InlineIcon type="unknown" />);
    expect(container.querySelector("span")).toBeNull();
  });

  it("applies custom size to SVG", () => {
    const { container } = render(<InlineIcon type="database" size={20} />);
    const span = container.querySelector("span");
    expect(span).not.toBeNull();
    expect(span?.style.width).toBe("20px");
    expect(span?.style.height).toBe("20px");
  });

  it("uses default size of 14", () => {
    const { container } = render(<InlineIcon type="catalog" />);
    const span = container.querySelector("span");
    expect(span).not.toBeNull();
    expect(span?.style.width).toBe("14px");
    expect(span?.style.height).toBe("14px");
  });

  it("replaces width/height in the SVG string", () => {
    const { container } = render(<InlineIcon type="table" size={16} />);
    const svg = container.querySelector("svg");
    expect(svg).not.toBeNull();
    expect(svg?.getAttribute("width")).toBe("16");
    expect(svg?.getAttribute("height")).toBe("16");
  });
});
