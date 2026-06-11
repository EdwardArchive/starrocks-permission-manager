import { describe, it, expect } from "vitest";
import { sortQueries } from "./querySort";
import { makeQuery } from "../test/cluster-fixtures";

describe("sortQueries", () => {
  const fast = makeQuery({ query_id: "fast", exec_time_ms: 100, memory_bytes: 500 });
  const slow = makeQuery({ query_id: "slow", exec_time_ms: 9000, memory_bytes: 10 });
  const unknown = makeQuery({ query_id: "unknown", exec_time_ms: null, memory_bytes: null });

  it("sorts descending", () => {
    const sorted = sortQueries([fast, slow], "exec_time_ms", "desc");
    expect(sorted.map((q) => q.query_id)).toEqual(["slow", "fast"]);
  });

  it("sorts ascending", () => {
    const sorted = sortQueries([slow, fast], "exec_time_ms", "asc");
    expect(sorted.map((q) => q.query_id)).toEqual(["fast", "slow"]);
  });

  it("sinks null values to the bottom in both directions", () => {
    expect(sortQueries([unknown, fast, slow], "exec_time_ms", "desc").map((q) => q.query_id))
      .toEqual(["slow", "fast", "unknown"]);
    expect(sortQueries([unknown, fast, slow], "exec_time_ms", "asc").map((q) => q.query_id))
      .toEqual(["fast", "slow", "unknown"]);
  });

  it("sorts by other numeric keys", () => {
    const sorted = sortQueries([slow, fast], "memory_bytes", "desc");
    expect(sorted.map((q) => q.query_id)).toEqual(["fast", "slow"]);
  });

  it("does not mutate the input array", () => {
    const input = [fast, slow];
    sortQueries(input, "exec_time_ms", "desc");
    expect(input.map((q) => q.query_id)).toEqual(["fast", "slow"]);
  });
});
