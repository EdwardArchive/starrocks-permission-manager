import { describe, it, expect } from "vitest";
import { deriveInstCores, type CpuSampleMap } from "./queryCpu";
import { makeQuery } from "../test/cluster-fixtures";
import type { ClusterQueriesResponse, RunningQueryInfo } from "../types";

function res(queries: RunningQueryInfo[]): ClusterQueriesResponse {
  return { queries, server_now: null, can_kill: false };
}

describe("deriveInstCores", () => {
  it("returns no instantaneous cores on the first sample (no prior)", () => {
    const prev: CpuSampleMap = new Map();
    const { nextSamples, instCores } = deriveInstCores(
      prev,
      res([makeQuery({ query_id: "a", cpu_time_ms: 500 })]),
      1_000,
    );
    expect(instCores.size).toBe(0);
    // but the sample is recorded for the next poll
    expect(nextSamples.get("a")).toEqual({ cpuMs: 500, atMs: 1_000 });
  });

  it("derives cores from the delta vs the previous sample", () => {
    // 1000ms of CPU accrued over 1000ms of wall time = 1.0 cores
    const prev: CpuSampleMap = new Map([["a", { cpuMs: 1_000, atMs: 1_000 }]]);
    const { nextSamples, instCores } = deriveInstCores(
      prev,
      res([makeQuery({ query_id: "a", cpu_time_ms: 2_000 })]),
      2_000,
    );
    expect(instCores.get("a")).toBe(1);
    expect(nextSamples.get("a")).toEqual({ cpuMs: 2_000, atMs: 2_000 });
  });

  it("derives fractional cores", () => {
    // 500ms CPU over 1000ms wall = 0.5 cores
    const prev: CpuSampleMap = new Map([["a", { cpuMs: 1_000, atMs: 1_000 }]]);
    const { instCores } = deriveInstCores(
      prev,
      res([makeQuery({ query_id: "a", cpu_time_ms: 1_500 })]),
      2_000,
    );
    expect(instCores.get("a")).toBe(0.5);
  });

  it("includes a zero-delta query as 0 cores (>= 0 boundary)", () => {
    const prev: CpuSampleMap = new Map([["a", { cpuMs: 1_000, atMs: 1_000 }]]);
    const { instCores } = deriveInstCores(
      prev,
      res([makeQuery({ query_id: "a", cpu_time_ms: 1_000 })]),
      2_000,
    );
    expect(instCores.has("a")).toBe(true);
    expect(instCores.get("a")).toBe(0);
  });

  it("drops a negative delta (counter reset / reused id) but still re-samples", () => {
    const prev: CpuSampleMap = new Map([["a", { cpuMs: 5_000, atMs: 1_000 }]]);
    const { nextSamples, instCores } = deriveInstCores(
      prev,
      res([makeQuery({ query_id: "a", cpu_time_ms: 200 })]),
      2_000,
    );
    expect(instCores.has("a")).toBe(false);
    // the new (lower) cumulative value is still recorded as the next baseline
    expect(nextSamples.get("a")).toEqual({ cpuMs: 200, atMs: 2_000 });
  });

  it("skips derivation when the clock has not advanced (no divide-by-zero)", () => {
    const prev: CpuSampleMap = new Map([["a", { cpuMs: 1_000, atMs: 2_000 }]]);
    const { nextSamples, instCores } = deriveInstCores(
      prev,
      res([makeQuery({ query_id: "a", cpu_time_ms: 2_000 })]),
      2_000, // nowMs == prev.atMs
    );
    expect(instCores.has("a")).toBe(false);
    expect(nextSamples.get("a")).toEqual({ cpuMs: 2_000, atMs: 2_000 });
  });

  it("skips derivation when the clock went backwards", () => {
    const prev: CpuSampleMap = new Map([["a", { cpuMs: 1_000, atMs: 3_000 }]]);
    const { instCores } = deriveInstCores(
      prev,
      res([makeQuery({ query_id: "a", cpu_time_ms: 2_000 })]),
      2_000, // nowMs < prev.atMs
    );
    expect(instCores.has("a")).toBe(false);
  });

  it("ignores queries with a null cpu_time_ms entirely", () => {
    const prev: CpuSampleMap = new Map([["a", { cpuMs: 1_000, atMs: 1_000 }]]);
    const { nextSamples, instCores } = deriveInstCores(
      prev,
      res([makeQuery({ query_id: "a", cpu_time_ms: null })]),
      2_000,
    );
    expect(nextSamples.has("a")).toBe(false);
    expect(instCores.has("a")).toBe(false);
  });

  it("prunes samples for queries no longer present in the response", () => {
    const prev: CpuSampleMap = new Map([
      ["a", { cpuMs: 1_000, atMs: 1_000 }],
      ["gone", { cpuMs: 9_000, atMs: 1_000 }],
    ]);
    const { nextSamples } = deriveInstCores(
      prev,
      res([makeQuery({ query_id: "a", cpu_time_ms: 1_500 })]),
      2_000,
    );
    expect(nextSamples.has("gone")).toBe(false);
    expect(nextSamples.has("a")).toBe(true);
  });

  it("records a brand-new query without deriving cores yet", () => {
    const prev: CpuSampleMap = new Map([["a", { cpuMs: 1_000, atMs: 1_000 }]]);
    const { nextSamples, instCores } = deriveInstCores(
      prev,
      res([
        makeQuery({ query_id: "a", cpu_time_ms: 1_500 }),
        makeQuery({ query_id: "b", cpu_time_ms: 300 }),
      ]),
      2_000,
    );
    expect(instCores.get("a")).toBe(0.5); // existing → derived
    expect(instCores.has("b")).toBe(false); // new → sampled only
    expect(nextSamples.get("b")).toEqual({ cpuMs: 300, atMs: 2_000 });
  });

  it("does not mutate the previous sample map", () => {
    const prev: CpuSampleMap = new Map([["a", { cpuMs: 1_000, atMs: 1_000 }]]);
    deriveInstCores(prev, res([makeQuery({ query_id: "a", cpu_time_ms: 2_000 })]), 2_000);
    expect(prev.size).toBe(1);
    expect(prev.get("a")).toEqual({ cpuMs: 1_000, atMs: 1_000 });
  });

  it("returns empty maps for an empty response", () => {
    const prev: CpuSampleMap = new Map([["a", { cpuMs: 1_000, atMs: 1_000 }]]);
    const { nextSamples, instCores } = deriveInstCores(prev, res([]), 2_000);
    expect(nextSamples.size).toBe(0);
    expect(instCores.size).toBe(0);
  });
});
