import { describe, it, expect, vi } from "vitest";
import { render } from "../../test/test-utils";
import PermissionDetailTab from "./PermissionDetailTab";

vi.mock("../../api/admin", () => ({
  getInheritanceDag: vi.fn(() => Promise.resolve({ nodes: [], edges: [] })),
  getUserEffectivePrivileges: vi.fn(() => Promise.resolve([])),
  getRolePrivileges: vi.fn(() => Promise.resolve([])),
  searchUsersRoles: vi.fn(() => Promise.resolve([])),
}));
vi.mock("../dag/DAGView", () => ({ default: () => <div data-testid="dagview" /> }));
vi.mock("../common/ExportPngBtn", () => ({ default: () => <div /> }));
vi.mock("../common/GrantTreeView", () => ({ default: () => <div /> }));
vi.mock("../common/InlineIcon", () => ({ default: ({ type }: { type: string }) => <span data-testid={`icon-${type}`} /> }));

vi.mock("../../stores/dagStore", () => ({
  useDagStore: vi.fn((sel) => sel({ selectedNode: null })),
}));

describe("PermissionDetailTab", () => {
  it("mounts and runs the selectedNode selector", () => {
    const { container } = render(<PermissionDetailTab />);
    expect(container.firstChild).toBeTruthy();
  });
});
