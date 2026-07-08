import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, render, screen, act } from "@testing-library/react";
import { createElement } from "react";
import { usePolling, useTickerNow } from "./usePolling";
import Header from "../components/layout/Header";

/* Header is rendered below as a live migration check of its usePolling site. */
const mockGetClusterStatus = vi.fn();
vi.mock("../api/cluster", () => ({
  getClusterStatus: (...args: unknown[]) => mockGetClusterStatus(...args),
}));
vi.mock("../components/dag/nodeIcons", () => ({
  APP_LOGO_SVG: '<svg width="24" height="24"></svg>',
}));

/** Override document.hidden (jsdom default is false); removed in afterEach. */
function setDocumentHidden(hidden: boolean) {
  Object.defineProperty(document, "hidden", { configurable: true, get: () => hidden });
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  Reflect.deleteProperty(document, "hidden");
  vi.useRealTimers();
});

describe("usePolling", () => {
  it("does not call fn before the first interval by default", () => {
    const fn = vi.fn();
    const useTest = () => usePolling(fn, 1000);
    renderHook(useTest);

    expect(fn).not.toHaveBeenCalled();
    vi.advanceTimersByTime(999);
    expect(fn).not.toHaveBeenCalled();
  });

  it("calls fn once per elapsed interval", () => {
    const fn = vi.fn();
    const useTest = () => usePolling(fn, 1000);
    renderHook(useTest);

    vi.advanceTimersByTime(1000);
    expect(fn).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(2000);
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("immediate: true calls fn on mount, before the first tick", () => {
    const fn = vi.fn();
    const useTest = () => usePolling(fn, 1000, { immediate: true });
    renderHook(useTest);

    expect(fn).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1000);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("skips ticks while document.hidden, resumes when visible", () => {
    setDocumentHidden(true);
    const fn = vi.fn();
    const useTest = () => usePolling(fn, 1000);
    renderHook(useTest);

    vi.advanceTimersByTime(3000);
    expect(fn).not.toHaveBeenCalled();

    setDocumentHidden(false);
    vi.advanceTimersByTime(1000);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("immediate call is not hidden-guarded (ticks stay guarded)", () => {
    setDocumentHidden(true);
    const fn = vi.fn();
    const useTest = () => usePolling(fn, 1000, { immediate: true });
    renderHook(useTest);

    expect(fn).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(3000);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("enabled: false suppresses immediate and ticks; toggling restarts/stops", () => {
    const fn = vi.fn();
    const useTest = ({ enabled }: { enabled: boolean }) =>
      usePolling(fn, 1000, { enabled, immediate: true });
    const { rerender } = renderHook(useTest, { initialProps: { enabled: false } });

    vi.advanceTimersByTime(3000);
    expect(fn).not.toHaveBeenCalled();

    rerender({ enabled: true });
    expect(fn).toHaveBeenCalledTimes(1); // immediate on start
    vi.advanceTimersByTime(1000);
    expect(fn).toHaveBeenCalledTimes(2);

    rerender({ enabled: false });
    vi.advanceTimersByTime(5000);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("restarts the timer when intervalMs changes", () => {
    const fn = vi.fn();
    const useTest = ({ ms }: { ms: number }) => usePolling(fn, ms);
    const { rerender } = renderHook(useTest, { initialProps: { ms: 1000 } });

    vi.advanceTimersByTime(900);
    rerender({ ms: 5000 }); // old 1000ms timer cancelled, fresh 5000ms timer
    vi.advanceTimersByTime(4999);
    expect(fn).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("intervalMs <= 0 schedules no interval (immediate still fires)", () => {
    const fn = vi.fn();
    const useTest = () => usePolling(fn, 0, { immediate: true });
    renderHook(useTest);

    expect(fn).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(60_000);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("uses the latest fn without restarting the timer", () => {
    const fnA = vi.fn();
    const fnB = vi.fn();
    const useTest = ({ f }: { f: () => void }) => usePolling(f, 1000);
    const { rerender } = renderHook(useTest, { initialProps: { f: fnA } });

    vi.advanceTimersByTime(500);
    rerender({ f: fnB });
    vi.advanceTimersByTime(500); // tick lands at t=1000 — timer was not reset
    expect(fnA).not.toHaveBeenCalled();
    expect(fnB).toHaveBeenCalledTimes(1);
  });

  it("stops polling on unmount", () => {
    const fn = vi.fn();
    const useTest = () => usePolling(fn, 1000);
    const { unmount } = renderHook(useTest);

    vi.advanceTimersByTime(1000);
    expect(fn).toHaveBeenCalledTimes(1);

    unmount();
    vi.advanceTimersByTime(5000);
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

describe("useTickerNow", () => {
  it("returns Date.now() and advances once per tick", () => {
    vi.setSystemTime(1_000_000);
    const { result } = renderHook(useTickerNow);

    expect(result.current).toBe(1_000_000);
    act(() => { vi.advanceTimersByTime(1000); });
    expect(result.current).toBe(1_001_000);
    act(() => { vi.advanceTimersByTime(1000); });
    expect(result.current).toBe(1_002_000);
  });

  it("supports a custom interval", () => {
    vi.setSystemTime(5_000);
    const useTest = () => useTickerNow(250);
    const { result } = renderHook(useTest);

    act(() => { vi.advanceTimersByTime(250); });
    expect(result.current).toBe(5_250);
  });
});

describe("usePolling — Header health-poll site (migration check)", () => {
  it("fetches immediately, shows the badge on has_errors, and re-polls every 60s", async () => {
    mockGetClusterStatus.mockResolvedValue({ has_errors: true });
    render(createElement(Header));

    // immediate call on mount, quiet + non-refresh
    expect(mockGetClusterStatus).toHaveBeenCalledTimes(1);
    expect(mockGetClusterStatus).toHaveBeenCalledWith(undefined, false, true);

    await act(async () => {}); // flush the resolved promise
    expect(screen.getByTestId("cluster-error-badge")).toBeInTheDocument();

    // 60s tick refetches
    act(() => { vi.advanceTimersByTime(60_000); });
    expect(mockGetClusterStatus).toHaveBeenCalledTimes(2);
  });
});
