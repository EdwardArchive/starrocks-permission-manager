import { describe, it, expect, vi } from "vitest";
import { render } from "../../test/test-utils";
import UserDetailPanel from "./UserDetailPanel";

vi.mock("../../api/user", () => ({
  getUserEffectivePrivileges: vi.fn(() => Promise.resolve([])),
}));
vi.mock("../common/GrantTreeView", () => ({ default: () => <div data-testid="grant-tree" /> }));
vi.mock("../common/InlineIcon", () => ({ default: ({ type }: { type: string }) => <span data-testid={`icon-${type}`} /> }));

vi.mock("../../stores/dagStore", () => {
  const STATE = { selectedNode: { id: "u1", label: "analyst_kim", type: "user" } };
  return { useDagStore: vi.fn((sel) => sel(STATE)) };
});

describe("UserDetailPanel", () => {
  it("renders the selected user via the selector subscription", () => {
    const { container } = render(<UserDetailPanel />);
    expect(container.textContent).toContain("analyst_kim");
  });
});
