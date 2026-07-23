import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useServerSearch } from "./useServerSearch";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

const flush = async (ms: number) => {
  await act(async () => { await vi.advanceTimersByTimeAsync(ms); });
};

describe("useServerSearch", () => {
  it("stays idle below minLength and never calls the searcher", async () => {
    const searcher = vi.fn(() => Promise.resolve(["x"]));
    const { result } = renderHook(() => useServerSearch("a", searcher));
    expect(result.current.results).toBeNull();
    expect(result.current.searching).toBe(false);
    await flush(500);
    expect(searcher).not.toHaveBeenCalled();
  });

  it("flips searching immediately, then delivers results after the debounce", async () => {
    const searcher = vi.fn((q: string) => Promise.resolve([q]));
    const { result } = renderHook(() => useServerSearch("abc", searcher));
    expect(result.current.searching).toBe(true);
    expect(searcher).not.toHaveBeenCalled(); // still within the debounce window
    await flush(300);
    expect(searcher).toHaveBeenCalledExactlyOnceWith("abc");
    expect(result.current.results).toEqual(["abc"]);
    expect(result.current.searching).toBe(false);
  });

  it("trims the query before gating and searching", async () => {
    const searcher = vi.fn((q: string) => Promise.resolve([q]));
    renderHook(() => useServerSearch("  ab  ", searcher));
    await flush(300);
    expect(searcher).toHaveBeenCalledWith("ab");
  });

  it("collapses rapid keystrokes into a single request (cancel-on-supersede)", async () => {
    const searcher = vi.fn((q: string) => Promise.resolve([q]));
    const { rerender } = renderHook(({ q }) => useServerSearch(q, searcher), { initialProps: { q: "ab" } });
    // Each keystroke lands within the debounce window; cleanup cancels the prior timer.
    await act(async () => { await vi.advanceTimersByTimeAsync(100); });
    rerender({ q: "abc" });
    await act(async () => { await vi.advanceTimersByTimeAsync(100); });
    rerender({ q: "abcd" });
    await flush(300);
    expect(searcher).toHaveBeenCalledExactlyOnceWith("abcd");
  });

  it("maps a failed search to an empty result set", async () => {
    const searcher = vi.fn(() => Promise.reject(new Error("boom")));
    const { result } = renderHook(() => useServerSearch("abc", searcher));
    await flush(300);
    expect(result.current.results).toEqual([]);
    expect(result.current.searching).toBe(false);
  });

  it("keeps previous results visible while the next search is in flight", async () => {
    const searcher = vi.fn((q: string) => Promise.resolve([q]));
    const { result, rerender } = renderHook(({ q }) => useServerSearch(q, searcher), { initialProps: { q: "ab" } });
    await flush(300);
    expect(result.current.results).toEqual(["ab"]);

    rerender({ q: "abc" });
    expect(result.current.searching).toBe(true);
    expect(result.current.results).toEqual(["ab"]); // retained during refetch
    await flush(300);
    expect(result.current.results).toEqual(["abc"]);
  });

  it("reset() returns to idle synchronously", async () => {
    const searcher = vi.fn((q: string) => Promise.resolve([q]));
    const { result } = renderHook(() => useServerSearch("abc", searcher));
    await flush(300);
    expect(result.current.results).toEqual(["abc"]);
    act(() => result.current.reset());
    expect(result.current.results).toBeNull();
    expect(result.current.searching).toBe(false);
  });

  it("dropping below minLength clears results back to idle", async () => {
    const searcher = vi.fn((q: string) => Promise.resolve([q]));
    const { result, rerender } = renderHook(({ q }) => useServerSearch(q, searcher), { initialProps: { q: "abc" } });
    await flush(300);
    expect(result.current.results).toEqual(["abc"]);
    rerender({ q: "a" });
    expect(result.current.results).toBeNull();
    expect(result.current.searching).toBe(false);
  });

  it("honors custom minLength and delayMs", async () => {
    const searcher = vi.fn((q: string) => Promise.resolve([q]));
    const { result } = renderHook(() => useServerSearch("a", searcher, { minLength: 1, delayMs: 100 }));
    expect(result.current.searching).toBe(true);
    await flush(100);
    expect(searcher).toHaveBeenCalledWith("a");
  });

  it("uses the latest searcher without restarting the debounce timer", async () => {
    const s1 = vi.fn(() => Promise.resolve(["one"]));
    const s2 = vi.fn(() => Promise.resolve(["two"]));
    const { result, rerender } = renderHook(({ s }) => useServerSearch("abc", s), { initialProps: { s: s1 } });
    // Swap the searcher mid-debounce; query is unchanged so the timer is NOT reset.
    await act(async () => { await vi.advanceTimersByTimeAsync(150); });
    rerender({ s: s2 });
    await flush(150);
    expect(s1).not.toHaveBeenCalled();
    expect(s2).toHaveBeenCalledTimes(1);
    expect(result.current.results).toEqual(["two"]);
  });

  it("cancels the pending request on unmount", async () => {
    const searcher = vi.fn((q: string) => Promise.resolve([q]));
    const { unmount } = renderHook(() => useServerSearch("abc", searcher));
    unmount();
    await flush(300);
    expect(searcher).not.toHaveBeenCalled();
  });
});
