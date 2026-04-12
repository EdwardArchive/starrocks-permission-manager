import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

describe("showToast", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // Clean up any existing toast container from prior tests
    const existing = document.getElementById("toast-container");
    if (existing) existing.remove();
    // Reset module state so `container` is re-created
    vi.resetModules();
  });

  afterEach(() => {
    vi.useRealTimers();
    const existing = document.getElementById("toast-container");
    if (existing) existing.remove();
  });

  async function loadShowToast() {
    const mod = await import("./toast");
    return mod.showToast;
  }

  it("creates a toast container in document.body", async () => {
    const showToast = await loadShowToast();
    showToast("Test message");
    const container = document.getElementById("toast-container");
    expect(container).not.toBeNull();
    expect(container?.parentElement).toBe(document.body);
  });

  it("creates a toast element with the message text", async () => {
    const showToast = await loadShowToast();
    showToast("Hello World");
    const container = document.getElementById("toast-container");
    expect(container).not.toBeNull();
    const toast = container!.firstElementChild as HTMLDivElement;
    expect(toast).not.toBeNull();
    expect(toast.textContent).toBe("Hello World");
  });

  it("uses error styling by default", async () => {
    const showToast = await loadShowToast();
    showToast("Error occurred");
    const container = document.getElementById("toast-container");
    expect(container).not.toBeNull();
    const toast = container!.firstElementChild as HTMLDivElement;
    // jsdom converts hex to rgb
    expect(toast.style.background).toBe("rgb(30, 18, 21)");
    expect(toast.style.color).toBe("rgb(252, 165, 165)");
  });

  it("uses warning styling for warning type", async () => {
    const showToast = await loadShowToast();
    showToast("Warning message", "warning");
    const container = document.getElementById("toast-container");
    expect(container).not.toBeNull();
    const toast = container!.firstElementChild as HTMLDivElement;
    expect(toast.style.background).toBe("rgb(30, 26, 18)");
    expect(toast.style.color).toBe("rgb(253, 230, 138)");
  });

  it("uses info styling for info type", async () => {
    const showToast = await loadShowToast();
    showToast("Info message", "info");
    const container = document.getElementById("toast-container");
    expect(container).not.toBeNull();
    const toast = container!.firstElementChild as HTMLDivElement;
    expect(toast.style.background).toBe("rgb(18, 26, 46)");
    expect(toast.style.color).toBe("rgb(147, 197, 253)");
  });

  it("deduplicates: same message+type does not create duplicate", async () => {
    const showToast = await loadShowToast();
    showToast("Duplicate msg", "error");
    showToast("Duplicate msg", "error");
    const container = document.getElementById("toast-container");
    expect(container).not.toBeNull();
    expect(container!.children.length).toBe(1);
  });

  it("allows same message with different types", async () => {
    const showToast = await loadShowToast();
    showToast("Same msg", "error");
    showToast("Same msg", "warning");
    const container = document.getElementById("toast-container");
    expect(container).not.toBeNull();
    expect(container!.children.length).toBe(2);
  });

  it("auto-dismisses after duration", async () => {
    const showToast = await loadShowToast();
    showToast("Auto dismiss", "error", 3000);
    const container = document.getElementById("toast-container");
    expect(container).not.toBeNull();
    expect(container!.children.length).toBe(1);

    // Advance past the dismiss timeout
    vi.advanceTimersByTime(3000);
    // The dismiss function sets opacity and schedules removal after 200ms
    vi.advanceTimersByTime(200);
    expect(container!.children.length).toBe(0);
  });

  it("reuses existing container on multiple calls", async () => {
    const showToast = await loadShowToast();
    showToast("First", "error");
    showToast("Second", "warning");
    const containers = document.querySelectorAll("#toast-container");
    expect(containers.length).toBe(1);
  });

  it("allows creating same toast after previous is dismissed", async () => {
    const showToast = await loadShowToast();
    showToast("Temp msg", "error", 1000);
    const container = document.getElementById("toast-container");
    expect(container).not.toBeNull();

    // Dismiss the first one
    vi.advanceTimersByTime(1000);
    vi.advanceTimersByTime(200);
    expect(container!.children.length).toBe(0);

    // Now we should be able to create same toast again
    showToast("Temp msg", "error", 1000);
    expect(container!.children.length).toBe(1);
  });
});
