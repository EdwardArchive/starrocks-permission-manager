import { describe, it, expect, vi } from "vitest";
import { render } from "../../test/test-utils";
import ObjectDetailPanel from "./ObjectDetailPanel";

vi.mock("../../api/user", () => ({
  getObjectPrivileges: vi.fn(() => Promise.resolve([])),
  getRolePrivileges: vi.fn(() => Promise.resolve([])),
  getTableDetail: vi.fn(() => Promise.resolve(null)),
}));
vi.mock("../common/GrantTreeView", () => ({ default: () => <div data-testid="grant-tree" /> }));
vi.mock("../tabs/PermissionMatrix", () => ({ PermissionMatrixView: () => <div /> }));

vi.mock("../../stores/dagStore", () => {
  // Stable reference across renders, or useEffect([selectedNode]) loops forever.
  const STATE = {
    selectedNode: {
      id: "n1",
      label: "user_events",
      type: "table",
      metadata: { catalog: "default_catalog", database: "analytics_db" },
    },
  };
  return { useDagStore: vi.fn((sel) => sel(STATE)) };
});

describe("ObjectDetailPanel", () => {
  it("renders the selected object via the selector subscription", () => {
    const { container } = render(<ObjectDetailPanel />);
    expect(container.textContent).toContain("user_events");
  });
});
