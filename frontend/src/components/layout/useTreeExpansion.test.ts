import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useTreeExpansion } from "./useTreeExpansion";
import { getDatabases, getTables } from "../../api/user";

vi.mock("../../api/user", () => ({
  getDatabases: vi.fn(),
  getTables: vi.fn(),
}));

const mockGetDatabases = vi.mocked(getDatabases);
const mockGetTables = vi.mocked(getTables);

beforeEach(() => {
  vi.clearAllMocks();
  mockGetDatabases.mockResolvedValue([]);
  mockGetTables.mockResolvedValue([]);
});

describe("useTreeExpansion", () => {
  it("starts with everything collapsed and empty", () => {
    const { result } = renderHook(() => useTreeExpansion());
    expect(result.current.expandedCats.size).toBe(0);
    expect(result.current.expandedDbs.size).toBe(0);
    expect(result.current.dbMap).toEqual({});
    expect(result.current.objMap).toEqual({});
  });

  it("expands a catalog and lazy-loads its databases", async () => {
    mockGetDatabases.mockResolvedValue([{ name: "sales", catalog: "hive" }]);
    const { result } = renderHook(() => useTreeExpansion());
    await act(async () => { await result.current.toggleCat("hive"); });
    expect(mockGetDatabases).toHaveBeenCalledExactlyOnceWith("hive");
    expect(result.current.expandedCats.has("hive")).toBe(true);
    expect(result.current.dbMap["hive"]).toEqual([{ name: "sales", catalog: "hive" }]);
  });

  it("collapse then re-expand reuses cached databases (no refetch)", async () => {
    const { result } = renderHook(() => useTreeExpansion());
    await act(async () => { await result.current.toggleCat("hive"); }); // expand + fetch
    await act(async () => { await result.current.toggleCat("hive"); }); // collapse
    expect(result.current.expandedCats.has("hive")).toBe(false);
    await act(async () => { await result.current.toggleCat("hive"); }); // re-expand (cached)
    expect(result.current.expandedCats.has("hive")).toBe(true);
    expect(mockGetDatabases).toHaveBeenCalledTimes(1);
  });

  it("expands a database and lazy-loads objects keyed by catalog.db", async () => {
    mockGetTables.mockResolvedValue([{ name: "orders", object_type: "BASE TABLE", catalog: "hive", database: "sales" }]);
    const { result } = renderHook(() => useTreeExpansion());
    await act(async () => { await result.current.toggleDb("hive", "sales"); });
    expect(mockGetTables).toHaveBeenCalledExactlyOnceWith("hive", "sales");
    expect(result.current.expandedDbs.has("hive.sales")).toBe(true);
    expect(result.current.objMap["hive.sales"]).toHaveLength(1);
  });

  it("keeps catalog and database expansion sets independent", async () => {
    const { result } = renderHook(() => useTreeExpansion());
    await act(async () => { await result.current.toggleCat("hive"); });
    await act(async () => { await result.current.toggleDb("hive", "sales"); });
    expect(result.current.expandedCats.has("hive")).toBe(true);
    expect(result.current.expandedDbs.has("hive.sales")).toBe(true);
    // collapsing the catalog leaves the db set untouched
    await act(async () => { await result.current.toggleCat("hive"); });
    expect(result.current.expandedCats.has("hive")).toBe(false);
    expect(result.current.expandedDbs.has("hive.sales")).toBe(true);
  });

  it("a failed database fetch stores an empty list but still expands", async () => {
    mockGetDatabases.mockRejectedValue(new Error("denied"));
    const { result } = renderHook(() => useTreeExpansion());
    await act(async () => { await result.current.toggleCat("hive"); });
    expect(result.current.dbMap["hive"]).toEqual([]);
    expect(result.current.expandedCats.has("hive")).toBe(true);
  });
});
