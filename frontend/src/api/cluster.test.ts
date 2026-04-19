import { describe, it, expect, vi, beforeEach } from "vitest";

const mockApiFetch = vi.fn();

vi.mock("./client", () => ({
  apiFetch: (...args: unknown[]) => mockApiFetch(...args),
}));

import { getClusterStatus } from "./cluster";

beforeEach(() => {
  mockApiFetch.mockReset();
  mockApiFetch.mockResolvedValue({});
});

describe("cluster API", () => {
  it("getClusterStatus calls /cluster/status", async () => {
    await getClusterStatus();
    expect(mockApiFetch).toHaveBeenCalledWith("/cluster/status", expect.any(Object));
  });

  it("getClusterStatus forwards AbortSignal", async () => {
    const controller = new AbortController();
    await getClusterStatus(controller.signal);
    expect(mockApiFetch).toHaveBeenCalledWith("/cluster/status", {
      signal: controller.signal,
    });
  });

  it("getClusterStatus works without AbortSignal", async () => {
    await getClusterStatus();
    const [, opts] = mockApiFetch.mock.calls[0] as [string, { signal?: AbortSignal }];
    expect(opts.signal).toBeUndefined();
  });

  it("getClusterStatus returns the API response", async () => {
    const mockResponse = {
      frontends: [],
      backends: [],
      metrics: {
        fe_total: 0,
        fe_alive: 0,
        be_total: 0,
        be_alive: 0,
        cn_total: 0,
        cn_alive: 0,
        total_tablets: null,
        total_data_used: null,
        avg_disk_used_pct: null,
        avg_cpu_used_pct: null,
        avg_mem_used_pct: null,
        avg_fe_heap_used_pct: null,
      },
      has_errors: false,
      mode: "full" as const,
      metrics_warning: null,
    };
    mockApiFetch.mockResolvedValue(mockResponse);
    const result = await getClusterStatus();
    expect(result).toEqual(mockResponse);
  });

  it("getClusterStatus propagates errors from apiFetch", async () => {
    mockApiFetch.mockRejectedValue(new Error("403: cluster_admin role required"));
    await expect(getClusterStatus()).rejects.toThrow("403: cluster_admin role required");
  });
});
