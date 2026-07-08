import { describe, it, expect, vi } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useAsyncData } from "./useAsyncData";

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

describe("useAsyncData", () => {
  it("starts loading and delivers data on resolve", async () => {
    const fetcher = vi.fn(() => Promise.resolve("hello"));
    const { result } = renderHook(() => useAsyncData(fetcher, ["a"]));

    expect(result.current).toEqual({ data: null, loading: true, error: null });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data).toBe("hello");
    expect(result.current.error).toBeNull();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("captures errors: data null, loading false, error set", async () => {
    const boom = new Error("boom");
    const fetcher = vi.fn(() => Promise.reject(boom));
    const { result } = renderHook(() => useAsyncData(fetcher, ["a"]));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data).toBeNull();
    expect(result.current.error).toBe(boom);
  });

  it("resets to loading in the same render and refetches when deps change", async () => {
    const fetcher = vi.fn((id: string) => Promise.resolve(`data-${id}`));
    const { result, rerender } = renderHook(
      ({ id }) => useAsyncData(() => fetcher(id), [id]),
      { initialProps: { id: "a" } },
    );

    await waitFor(() => expect(result.current.data).toBe("data-a"));

    rerender({ id: "b" });
    // Invalidated during render: loading immediately, no stale data (default mode)
    expect(result.current.loading).toBe(true);
    expect(result.current.data).toBeNull();

    await waitFor(() => expect(result.current.data).toBe("data-b"));
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("keepPreviousData keeps old data (loading true) during refetch", async () => {
    const d1 = deferred<string>();
    const d2 = deferred<string>();
    const fetchers = [() => d1.promise, () => d2.promise];
    let call = 0;
    const { result, rerender } = renderHook(
      ({ id }) => useAsyncData(() => fetchers[call++](), [id], { keepPreviousData: true }),
      { initialProps: { id: "a" } },
    );

    await act(async () => { d1.resolve("first"); });
    expect(result.current.data).toBe("first");

    rerender({ id: "b" });
    expect(result.current.loading).toBe(true);
    expect(result.current.data).toBe("first"); // previous data retained
    expect(result.current.error).toBeNull();

    await act(async () => { d2.resolve("second"); });
    expect(result.current).toEqual({ data: "second", loading: false, error: null });
  });

  it("drops stale responses when deps change mid-flight", async () => {
    const dA = deferred<string>();
    const dB = deferred<string>();
    const byId: Record<string, Promise<string>> = { a: dA.promise, b: dB.promise };
    const { result, rerender } = renderHook(
      ({ id }) => useAsyncData(() => byId[id], [id]),
      { initialProps: { id: "a" } },
    );

    rerender({ id: "b" }); // a still in flight
    await act(async () => { dB.resolve("B"); });
    expect(result.current.data).toBe("B");

    await act(async () => { dA.resolve("A"); }); // stale settle → dropped
    expect(result.current.data).toBe("B");
    expect(result.current.loading).toBe(false);
  });

  it("does not apply results after unmount", async () => {
    const d = deferred<string>();
    const { result, unmount } = renderHook(() => useAsyncData(() => d.promise, ["a"]));
    expect(result.current.loading).toBe(true);

    unmount();
    await act(async () => { d.resolve("late"); }); // must not throw / setState
    expect(result.current.data).toBeNull();
  });

  it("enabled:false stays idle, then fetches when enabled flips true", async () => {
    const fetcher = vi.fn(() => Promise.resolve(42));
    const { result, rerender } = renderHook(
      ({ enabled }) => useAsyncData(fetcher, ["k"], { enabled }),
      { initialProps: { enabled: false } },
    );

    expect(result.current).toEqual({ data: null, loading: false, error: null });
    expect(fetcher).not.toHaveBeenCalled();

    rerender({ enabled: true });
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.data).toBe(42));
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("clears a previous error while refetching after deps change", async () => {
    const fetcher = vi.fn((id: string) =>
      id === "bad" ? Promise.reject(new Error("nope")) : Promise.resolve(`ok-${id}`));
    const { result, rerender } = renderHook(
      ({ id }) => useAsyncData(() => fetcher(id), [id]),
      { initialProps: { id: "bad" } },
    );

    await waitFor(() => expect(result.current.error).toBeTruthy());

    rerender({ id: "good" });
    expect(result.current.error).toBeNull(); // invalidation clears the error
    expect(result.current.loading).toBe(true);

    await waitFor(() => expect(result.current.data).toBe("ok-good"));
    expect(result.current.error).toBeNull();
  });

  it("keepPreviousData: an errored refetch still nulls data", async () => {
    const fetcher = vi.fn((id: string) =>
      id === "bad" ? Promise.reject(new Error("nope")) : Promise.resolve(`ok-${id}`));
    const { result, rerender } = renderHook(
      ({ id }) => useAsyncData(() => fetcher(id), [id], { keepPreviousData: true }),
      { initialProps: { id: "good" } },
    );

    await waitFor(() => expect(result.current.data).toBe("ok-good"));

    rerender({ id: "bad" });
    expect(result.current.data).toBe("ok-good"); // retained while in flight

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data).toBeNull(); // settled error clears data
    expect(result.current.error).toBeTruthy();
  });
});
