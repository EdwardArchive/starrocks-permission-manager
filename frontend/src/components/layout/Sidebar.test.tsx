import { describe, it, expect, vi } from "vitest";
import { render } from "../../test/test-utils";
import Sidebar from "./Sidebar";

vi.mock("../../api/user", () => ({
  getCatalogs: vi.fn(() => Promise.resolve([])),
  getDatabases: vi.fn(() => Promise.resolve([])),
  getTables: vi.fn(() => Promise.resolve([])),
}));
// getRoles/searchAll now resolve through usePermApi(); one stable api object keeps
// the effects' [permApi] dep identity constant (mirrors the real singleton).
vi.mock("../../api/permApi", () => {
  const api = {
    getRoles: vi.fn(() => Promise.resolve([])),
    searchAll: vi.fn(() => Promise.resolve([])),
  };
  return { usePermApi: () => api };
});
vi.mock("../dag/nodeIcons", () => ({ colorizedSvg: () => "", NODE_COLORS: {} }));
vi.mock("../../utils/colors", () => ({ C: { bg: "#0f172a", card: "#1e293b", border: "#334155", borderLight: "#475569", text1: "#e2e8f0", text2: "#94a3b8", text3: "#64748b", accent: "#3b82f6" } }));

vi.mock("../../stores/authStore", () => {
  const AUTH = { user: { username: "test", is_admin: false } };
  return { useAuthStore: vi.fn(() => AUTH) };
});

vi.mock("../../stores/dagStore", () => {
  const STATE = {
    activeTab: "object",
    searchQuery: "",
    setSearchQuery: vi.fn(),
    setSelectedNode: vi.fn(),
    setPanelMode: vi.fn(),
    activeCatalog: "default_catalog",
    setActiveCatalog: vi.fn(),
    setActiveTab: vi.fn(),
    hiddenNodes: new Set<string>(),
    toggleNodeVisibility: vi.fn(),
  };
  return { useDagStore: vi.fn((sel) => sel(STATE)) };
});

describe("Sidebar", () => {
  it("mounts and runs the scoped store selector", () => {
    const { container } = render(<Sidebar />);
    expect(container.firstChild).toBeTruthy();
  });
});
