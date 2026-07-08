import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "../../test/test-utils";
import { fireEvent } from "@testing-library/react";
import Sidebar from "./Sidebar";
import { useDagStore } from "../../stores/dagStore";
import { useAuthStore } from "../../stores/authStore";
import type { UserInfo } from "../../types";

/**
 * Real hooks + real stores; only the API layer is mocked. usePermApi is the REAL
 * implementation so the admin/user prefix selection is exercised end to end — we
 * assert on the URL the mocked apiFetch receives.
 */
vi.mock("../../api/user", () => ({
  getCatalogs: vi.fn(() => Promise.resolve([{ name: "hive", catalog_type: "HiveCatalog" }])),
  getDatabases: vi.fn(() => Promise.resolve([{ name: "sales", catalog: "hive" }])),
  getTables: vi.fn(() => Promise.resolve([
    { name: "orders", object_type: "BASE TABLE", catalog: "hive", database: "sales" },
    { name: "orders_mv", object_type: "MATERIALIZED VIEW", catalog: "hive", database: "sales" },
  ])),
}));

const h = vi.hoisted(() => ({
  apiFetch: vi.fn((url: string) => {
    if (url.includes("/roles")) return Promise.resolve([{ name: "analyst", is_builtin: false }, { name: "root", is_builtin: true }]);
    if (url.includes("/search")) return Promise.resolve([{ name: "found_obj", type: "table", catalog: "hive", database: "sales", path: "hive.sales.found_obj" }]);
    return Promise.resolve([]);
  }),
}));
vi.mock("../../api/client", () => ({ apiFetch: (url: string) => h.apiFetch(url) }));
vi.mock("../dag/nodeIcons", () => ({ colorizedSvg: () => "<svg width='16' height='16'></svg>", NODE_COLORS: { role: "#abc" } }));

const nonAdmin: UserInfo = { username: "u", roles: [], default_role: null, is_user_admin: false, can_manage_grants: false };
const admin: UserInfo = { username: "root", roles: [], default_role: null, is_user_admin: true, can_manage_grants: true };

const searchUrls = () => h.apiFetch.mock.calls.map((c) => c[0]).filter((u) => u.includes("/search"));
const roleUrls = () => h.apiFetch.mock.calls.map((c) => c[0]).filter((u) => u.includes("/roles"));

beforeEach(() => {
  h.apiFetch.mockClear();
  useDagStore.setState({ searchQuery: "", activeTab: "obj", activeCatalog: "default_catalog", hiddenNodes: new Set() });
  useAuthStore.setState({ user: nonAdmin });
});
afterEach(() => {
  useAuthStore.setState({ user: null });
});

describe("Sidebar (populated)", () => {
  it("loads catalogs and roles on mount", async () => {
    render(<Sidebar />);
    expect(await screen.findByText("hive")).toBeInTheDocument();
    expect(await screen.findByText("analyst")).toBeInTheDocument();
    // built-in role gets its badge
    expect(screen.getByText("built-in")).toBeInTheDocument();
  });

  it("expands a catalog → databases, then a database → grouped objects", async () => {
    render(<Sidebar />);
    fireEvent.click(await screen.findByText("hive"));
    fireEvent.click(await screen.findByText("sales"));
    // objects are grouped: BASE TABLE → "Tables", MATERIALIZED VIEW → "Materialized Views"
    expect(await screen.findByText("orders")).toBeInTheDocument();
    expect(await screen.findByText("orders_mv")).toBeInTheDocument();
    expect(screen.getByText("Materialized Views")).toBeInTheDocument();
  });

  it("collapsing a catalog hides its databases", async () => {
    render(<Sidebar />);
    const cat = await screen.findByText("hive");
    fireEvent.click(cat);
    expect(await screen.findByText("sales")).toBeInTheDocument();
    fireEvent.click(cat);
    await waitFor(() => expect(screen.queryByText("sales")).toBeNull());
  });

  it("selecting a role updates the DAG store selection", async () => {
    render(<Sidebar />);
    fireEvent.click(await screen.findByText("analyst"));
    await waitFor(() => expect(useDagStore.getState().selectedNode?.label).toBe("analyst"));
    expect(useDagStore.getState().activeTab).toBe("role");
  });
});

describe("Sidebar (search)", () => {
  it("debounces rapid keystrokes into a single request and renders results", async () => {
    render(<Sidebar />);
    const input = await screen.findByPlaceholderText("Search objects, users, roles...");
    // rapid keystrokes within one debounce window → only the final query fires
    fireEvent.change(input, { target: { value: "o" } });   // < 2 chars: idle
    fireEvent.change(input, { target: { value: "or" } });
    fireEvent.change(input, { target: { value: "ord" } });

    expect(await screen.findByText("found_obj")).toBeInTheDocument();
    expect(searchUrls()).toHaveLength(1);
    expect(searchUrls()[0]).toContain("q=ord");
  });

  it("the clear button resets search results", async () => {
    render(<Sidebar />);
    const input = await screen.findByPlaceholderText("Search objects, users, roles...");
    fireEvent.change(input, { target: { value: "ord" } });
    expect(await screen.findByText("found_obj")).toBeInTheDocument();

    fireEvent.click(screen.getByText("×"));
    await waitFor(() => expect(screen.queryByText("found_obj")).toBeNull());
    // back to the catalog tree
    expect(await screen.findByText("Catalogs")).toBeInTheDocument();
  });
});

describe("Sidebar (isAdmin-conditional permApi)", () => {
  it("non-admin loads roles from the /user/* prefix and hides the Users section", async () => {
    useAuthStore.setState({ user: nonAdmin });
    render(<Sidebar />);
    await screen.findByText("analyst");
    expect(roleUrls().some((u) => u.startsWith("/user/roles"))).toBe(true);
    expect(roleUrls().some((u) => u.startsWith("/admin/roles"))).toBe(false);
    expect(screen.queryByText("Users")).toBeNull();
  });

  it("admin loads roles from the /admin/* prefix and shows the Users section", async () => {
    useAuthStore.setState({ user: admin });
    render(<Sidebar />);
    await screen.findByText("analyst");
    expect(roleUrls().some((u) => u.startsWith("/admin/roles"))).toBe(true);
    expect(screen.getByText("Users")).toBeInTheDocument();
  });
});
