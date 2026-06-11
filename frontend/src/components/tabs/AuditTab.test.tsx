import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, userEvent } from "../../test/test-utils";
import AuditTab from "./AuditTab";
import type { AuditEntry } from "../../types";

const getAuditLog = vi.fn();
vi.mock("../../api/admin", () => ({
  getAuditLog: (...args: unknown[]) => getAuditLog(...args),
}));

function entry(overrides: Partial<AuditEntry> = {}): AuditEntry {
  return {
    log_time: "2026-06-11 12:00:00",
    actor: "'root'@'%'",
    action: "GRANT",
    grant_type: "PRIVILEGE",
    sql_text: "GRANT SELECT ON TABLE `sales`.`orders` TO USER 'alice'@'%'",
    result: "ok",
    error_msg: null,
    ...overrides,
  };
}

describe("AuditTab", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getAuditLog.mockResolvedValue([
      entry(),
      entry({ action: "REVOKE", result: "error", error_msg: "Access denied" }),
    ]);
  });

  it("renders audit rows with action and result coloring", async () => {
    render(<AuditTab />);
    const rows = await screen.findAllByTestId("audit-row");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent("GRANT");
    expect(rows[1]).toHaveTextContent("Access denied");
    expect(screen.getByText("2 entries")).toBeInTheDocument();
  });

  it("failures-only toggle hides successful entries client-side", async () => {
    render(<AuditTab />);
    await screen.findAllByTestId("audit-row");
    await userEvent.click(screen.getByTestId("audit-failures-only"));
    const rows = screen.getAllByTestId("audit-row");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toHaveTextContent("REVOKE");
  });

  it("copy button writes the SQL to the clipboard", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    render(<AuditTab />);
    await screen.findAllByTestId("audit-row");
    await userEvent.click(screen.getAllByTestId("audit-copy-sql")[0]);
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining("GRANT SELECT"));
  });

  it("passes the action filter to the API", async () => {
    render(<AuditTab />);
    await screen.findAllByTestId("audit-row");
    await userEvent.selectOptions(screen.getByTestId("audit-action-filter"), "REVOKE");
    await waitFor(() => expect(getAuditLog).toHaveBeenLastCalledWith(200, undefined, "REVOKE"));
  });

  it("shows the setup hint when the audit table is unreadable", async () => {
    getAuditLog.mockRejectedValue(new Error("Insufficient database privileges"));
    render(<AuditTab />);
    expect(await screen.findByText(/Could not load the audit log/)).toBeInTheDocument();
    expect(screen.getByText(/srpm_audit.grant_log/)).toBeInTheDocument();
  });
});
