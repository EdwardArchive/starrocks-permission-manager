import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent } from "@testing-library/react";
import { render, screen, waitFor, act } from "../../test/test-utils";
import QueriesPanel from "./QueriesPanel";
import { ApiError } from "../../api/client";
import { makeQuery } from "../../test/cluster-fixtures";
import type { ClusterQueriesResponse } from "../../types";

/* ── Mocks ── */

const mockGetClusterQueries = vi.fn();
const mockGetClusterQueryHistory = vi.fn();
const mockKillClusterQuery = vi.fn();
vi.mock("../../api/cluster", () => ({
  getClusterStatus: vi.fn(),
  getClusterQueries: (...args: unknown[]) => mockGetClusterQueries(...args),
  getClusterQueryHistory: (...args: unknown[]) => mockGetClusterQueryHistory(...args),
  killClusterQuery: (...args: unknown[]) => mockKillClusterQuery(...args),
}));

function makeResponse(overrides: Partial<ClusterQueriesResponse> = {}): ClusterQueriesResponse {
  return { queries: [makeQuery()], server_now: null, can_kill: false, ...overrides };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetClusterQueries.mockResolvedValue(makeResponse());
  mockGetClusterQueryHistory.mockResolvedValue({ available: true, queries: [], server_now: null, reason: null });
  mockKillClusterQuery.mockResolvedValue({ status: "ok", query_id: "q-001", audit: "ok" });
});

describe("QueriesPanel", () => {
  it("renders the Running / Recent subtabs and a running count", async () => {
    render(<QueriesPanel />);
    await waitFor(() => expect(screen.getByTestId("queries-tab-running")).toBeInTheDocument());
    expect(screen.getByTestId("queries-tab-history")).toBeInTheDocument();
    expect(screen.getByText("1 running")).toBeInTheDocument();
  });

  it("renders a query row with user, db, state, and resource values", async () => {
    render(<QueriesPanel />);
    await waitFor(() => expect(screen.getByTestId("queries-table")).toBeInTheDocument());

    expect(screen.getByText("root")).toBeInTheDocument();
    expect(screen.getByText("sales")).toBeInTheDocument();
    expect(screen.getByText("RUNNING")).toBeInTheDocument();
    expect(screen.getByText("2.126 s")).toBeInTheDocument();
    expect(screen.getByText("459.154 MB")).toBeInTheDocument();
    expect(screen.getByText("13.319 GB")).toBeInTheDocument();
    expect(screen.getByText("1.79B")).toBeInTheDocument(); // formatted scan rows
  });

  it("shows the empty state when no queries are running", async () => {
    mockGetClusterQueries.mockResolvedValue(makeResponse({ queries: [] }));
    render(<QueriesPanel />);
    await waitFor(() =>
      expect(screen.getByText("No queries are currently running")).toBeInTheDocument(),
    );
  });

  it("shows a permission message on 403 instead of the table", async () => {
    mockGetClusterQueries.mockRejectedValue(new ApiError("denied", 403));
    render(<QueriesPanel />);
    await waitFor(() =>
      expect(screen.getByText(/requires the/)).toBeInTheDocument(),
    );
    expect(screen.getByText("cluster_admin")).toBeInTheDocument();
    expect(screen.queryByTestId("queries-table")).not.toBeInTheDocument();
  });

  it("shows a generic error with Retry for non-403 failures", async () => {
    mockGetClusterQueries.mockRejectedValue(new Error("boom"));
    render(<QueriesPanel />);
    await waitFor(() =>
      expect(screen.getByText(/Failed to load running queries/)).toBeInTheDocument(),
    );
  });

  it("sorts by exec time descending by default", async () => {
    mockGetClusterQueries.mockResolvedValue(
      makeResponse({
        queries: [
          makeQuery({ query_id: "fast", user: "user_fast", exec_time_ms: 100, exec_time_display: "0.1 s" }),
          makeQuery({ query_id: "slow", user: "user_slow", exec_time_ms: 9000, exec_time_display: "9.0 s" }),
        ],
      }),
    );
    render(<QueriesPanel />);
    await waitFor(() => expect(screen.getByTestId("queries-table")).toBeInTheDocument());

    const rows = screen.getAllByTestId("query-row");
    expect(rows[0].textContent).toContain("user_slow");
    expect(rows[1].textContent).toContain("user_fast");
  });

  it("clicking the active sort header toggles direction", async () => {
    mockGetClusterQueries.mockResolvedValue(
      makeResponse({
        queries: [
          makeQuery({ query_id: "fast", user: "user_fast", exec_time_ms: 100 }),
          makeQuery({ query_id: "slow", user: "user_slow", exec_time_ms: 9000 }),
        ],
      }),
    );
    render(<QueriesPanel />);
    await waitFor(() => expect(screen.getByTestId("queries-table")).toBeInTheDocument());

    act(() => { screen.getByText("Exec Time").click(); }); // desc → asc

    const rows = screen.getAllByTestId("query-row");
    expect(rows[0].textContent).toContain("user_fast");
  });

  it("clicking another column sorts by it descending", async () => {
    mockGetClusterQueries.mockResolvedValue(
      makeResponse({
        queries: [
          makeQuery({ query_id: "small", user: "user_small", memory_bytes: 10, exec_time_ms: 9000 }),
          makeQuery({ query_id: "big", user: "user_big", memory_bytes: 99999, exec_time_ms: 100 }),
        ],
      }),
    );
    render(<QueriesPanel />);
    await waitFor(() => expect(screen.getByTestId("queries-table")).toBeInTheDocument());

    act(() => { screen.getByText("Memory").click(); });

    const rows = screen.getAllByTestId("query-row");
    expect(rows[0].textContent).toContain("user_big");
  });

  it("clicking a row expands the detail with full SQL and query id", async () => {
    render(<QueriesPanel />);
    await waitFor(() => expect(screen.getByTestId("queries-table")).toBeInTheDocument());

    act(() => { screen.getByTestId("query-row").click(); });

    expect(screen.getByText("Query ID")).toBeInTheDocument();
    expect(screen.getByText("q-001")).toBeInTheDocument();
    expect(screen.getByText("Copy SQL")).toBeInTheDocument();
    // Full SQL rendered in the <pre> block (also present truncated in the row)
    expect(screen.getAllByText("SELECT count(*) FROM sales.orders").length).toBeGreaterThanOrEqual(2);
  });

  it("expanded detail notes when SQL text is unavailable", async () => {
    mockGetClusterQueries.mockResolvedValue(
      makeResponse({ queries: [makeQuery({ sql: null })] }),
    );
    render(<QueriesPanel />);
    await waitFor(() => expect(screen.getByTestId("queries-table")).toBeInTheDocument());

    act(() => { screen.getByTestId("query-row").click(); });

    expect(screen.getByText(/SQL text unavailable/)).toBeInTheDocument();
  });

  it("refresh button forces a refresh fetch", async () => {
    render(<QueriesPanel />);
    await waitFor(() => expect(screen.getByTestId("queries-table")).toBeInTheDocument());

    act(() => { screen.getByTestId("queries-refresh-btn").click(); });

    await waitFor(() => {
      // second call with refresh=true (2nd arg)
      expect(mockGetClusterQueries).toHaveBeenLastCalledWith(expect.anything(), true);
    });
  });
});

describe("QueriesPanel — CPU share column", () => {
  it("shows CPU % relative to totalCores when provided", async () => {
    mockGetClusterQueries.mockResolvedValue(
      makeResponse({ queries: [makeQuery({ cpu_avg_cores: 2.4 })] }),
    );
    render(<QueriesPanel totalCores={48} />);
    await waitFor(() => expect(screen.getByTestId("queries-table")).toBeInTheDocument());
    // 2.4 / 48 = 5.0%
    expect(screen.getByText("5.0%")).toBeInTheDocument();
  });

  it("falls back to a cores multiplier without totalCores", async () => {
    mockGetClusterQueries.mockResolvedValue(
      makeResponse({ queries: [makeQuery({ cpu_avg_cores: 2.4 })] }),
    );
    render(<QueriesPanel />);
    await waitFor(() => expect(screen.getByTestId("queries-table")).toBeInTheDocument());
    expect(screen.getByText("×2.4")).toBeInTheDocument();
  });

  it("sorts by the CPU % column", async () => {
    mockGetClusterQueries.mockResolvedValue(
      makeResponse({
        queries: [
          makeQuery({ query_id: "light", user: "user_light", cpu_avg_cores: 0.3, exec_time_ms: 9000 }),
          makeQuery({ query_id: "heavy", user: "user_heavy", cpu_avg_cores: 8.1, exec_time_ms: 100 }),
        ],
      }),
    );
    render(<QueriesPanel totalCores={48} />);
    await waitFor(() => expect(screen.getByTestId("queries-table")).toBeInTheDocument());

    act(() => { screen.getByText("CPU %").click(); });

    const rows = screen.getAllByTestId("query-row");
    expect(rows[0].textContent).toContain("user_heavy");
  });

  it("shows avg cores in the expanded detail", async () => {
    mockGetClusterQueries.mockResolvedValue(
      makeResponse({ queries: [makeQuery({ cpu_avg_cores: 2.4 })] }),
    );
    render(<QueriesPanel totalCores={48} />);
    await waitFor(() => expect(screen.getByTestId("queries-table")).toBeInTheDocument());

    act(() => { screen.getByTestId("query-row").click(); });

    expect(screen.getByText("Avg CPU (since start)")).toBeInTheDocument();
    expect(screen.getByText("2.4 cores · 5.0% of 48")).toBeInTheDocument();
  });
});

describe("QueriesPanel — filter, refresh control, subtabs, KILL", () => {
  it("filters running rows by the text box (user/db/sql)", async () => {
    mockGetClusterQueries.mockResolvedValue(
      makeResponse({
        queries: [
          makeQuery({ query_id: "a", user: "alice", sql: "SELECT 1" }),
          makeQuery({ query_id: "b", user: "bob", sql: "SELECT 2" }),
        ],
      }),
    );
    render(<QueriesPanel />);
    await waitFor(() => expect(screen.getByTestId("queries-table")).toBeInTheDocument());
    expect(screen.getAllByTestId("query-row")).toHaveLength(2);

    fireEvent.change(screen.getByTestId("queries-filter"), { target: { value: "alice" } });
    expect(screen.getAllByTestId("query-row")).toHaveLength(1);
    expect(screen.getByText("alice")).toBeInTheDocument();
  });

  it("Off interval stops polling but manual refresh still works", async () => {
    render(<QueriesPanel />);
    await waitFor(() => expect(screen.getByTestId("queries-table")).toBeInTheDocument());
    const callsAfterMount = mockGetClusterQueries.mock.calls.length;

    fireEvent.change(screen.getByTestId("refresh-interval"), { target: { value: "0" } });
    act(() => { screen.getByTestId("queries-refresh-btn").click(); });
    await waitFor(() =>
      expect(mockGetClusterQueries.mock.calls.length).toBeGreaterThan(callsAfterMount),
    );
  });

  it("switching to Recent loads history", async () => {
    mockGetClusterQueryHistory.mockResolvedValue({
      available: true,
      queries: [
        { query_id: "h1", timestamp: "2026-06-12 01:00:00", user: "root", database: "db1",
          warehouse: "wh", query_type: "Query", state: "EOF", is_error: false, error_code: null,
          query_time_ms: 1500, scan_rows: 1000, scan_bytes: 2048, mem_cost_bytes: 1048576, cpu_cost_ns: 5e9,
          sql: "SELECT * FROM db1.t" },
      ],
      server_now: null,
      reason: null,
    });
    render(<QueriesPanel />);
    await waitFor(() => expect(screen.getByTestId("queries-table")).toBeInTheDocument());

    act(() => { screen.getByTestId("queries-tab-history").click(); });
    await waitFor(() => expect(screen.getByTestId("history-table")).toBeInTheDocument());
    expect(screen.getByText("SELECT * FROM db1.t")).toBeInTheDocument();
    expect(screen.getByText("1.50 s")).toBeInTheDocument();
  });

  it("Recent shows an unavailable note when the audit table is missing", async () => {
    mockGetClusterQueryHistory.mockResolvedValue({
      available: false, queries: [], server_now: null,
      reason: "Query history requires the StarRocks AuditLoader plugin",
    });
    render(<QueriesPanel />);
    await waitFor(() => expect(screen.getByTestId("queries-table")).toBeInTheDocument());

    act(() => { screen.getByTestId("queries-tab-history").click(); });
    await waitFor(() => expect(screen.getByText(/AuditLoader plugin/)).toBeInTheDocument());
  });

  it("errors-only toggle re-fetches history with the flag", async () => {
    render(<QueriesPanel />);
    await waitFor(() => expect(screen.getByTestId("queries-table")).toBeInTheDocument());
    act(() => { screen.getByTestId("queries-tab-history").click(); });
    await waitFor(() => expect(screen.getByTestId("history-errors-only")).toBeInTheDocument());

    fireEvent.click(screen.getByTestId("history-errors-only"));
    await waitFor(() =>
      expect(mockGetClusterQueryHistory).toHaveBeenLastCalledWith(
        expect.objectContaining({ errorsOnly: true }),
        expect.anything(),
      ),
    );
  });

  it("hides the KILL action when can_kill is false", async () => {
    mockGetClusterQueries.mockResolvedValue(makeResponse({ can_kill: false }));
    render(<QueriesPanel />);
    await waitFor(() => expect(screen.getByTestId("queries-table")).toBeInTheDocument());
    act(() => { screen.getByTestId("query-row").click(); });
    expect(screen.queryByTestId("kill-btn")).not.toBeInTheDocument();
  });

  it("shows KILL for grant-admins and calls the API on confirm", async () => {
    mockGetClusterQueries.mockResolvedValue(makeResponse({ can_kill: true }));
    render(<QueriesPanel />);
    await waitFor(() => expect(screen.getByTestId("queries-table")).toBeInTheDocument());
    act(() => { screen.getByTestId("query-row").click(); });

    expect(screen.getByTestId("kill-btn")).toBeInTheDocument();
    act(() => { screen.getByTestId("kill-btn").click(); });           // step 1: confirm UI
    act(() => { screen.getByTestId("kill-confirm-btn").click(); });   // step 2: execute

    await waitFor(() => expect(mockKillClusterQuery).toHaveBeenCalledWith("q-001"));
  });
});
