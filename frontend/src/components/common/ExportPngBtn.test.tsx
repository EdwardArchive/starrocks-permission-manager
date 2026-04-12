import { describe, it, expect, vi } from "vitest";
import { render, screen } from "../../test/test-utils";
import userEvent from "@testing-library/user-event";
import ExportPngBtn from "./ExportPngBtn";

// Mock colors
vi.mock("../../utils/colors", () => ({
  C: {
    bg: "#0f172a",
    card: "#1e293b",
    borderLight: "#475569",
    text2: "#94a3b8",
    accent: "#3b82f6",
  },
}));

describe("ExportPngBtn", () => {
  it("renders PNG button text", () => {
    render(<ExportPngBtn />);
    expect(screen.getByText("PNG")).toBeInTheDocument();
  });

  it("renders as a button element", () => {
    render(<ExportPngBtn />);
    expect(screen.getByRole("button")).toBeInTheDocument();
  });

  it("is not disabled by default", () => {
    render(<ExportPngBtn />);
    const btn = screen.getByRole("button");
    expect(btn).not.toBeDisabled();
  });

  it("does nothing when no .react-flow element exists", async () => {
    const user = userEvent.setup();
    render(<ExportPngBtn />);
    // No .react-flow element in the DOM, so clicking should not crash
    await user.click(screen.getByRole("button"));
    // Button text should still be "PNG" (not "Exporting...")
    expect(screen.getByText("PNG")).toBeInTheDocument();
  });
});
