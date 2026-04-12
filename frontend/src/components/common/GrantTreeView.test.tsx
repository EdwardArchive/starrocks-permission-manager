import { describe, it, expect, vi } from "vitest";
import { render, screen } from "../../test/test-utils";
import GrantTreeView from "./GrantTreeView";
import type { GrantDisplayGroup } from "../../utils/grantDisplay";

// Mock InlineIcon which imports SVG via ?raw
vi.mock("./InlineIcon", () => ({
  default: ({ type, size }: { type: string; size?: number }) => (
    <span data-testid={`icon-${type}`} data-size={size} />
  ),
}));

// Mock colors
vi.mock("../../utils/colors", () => ({
  C: {
    text1: "#e2e8f0",
    text2: "#94a3b8",
    text3: "#64748b",
  },
}));

// Mock privColors
vi.mock("../../utils/privColors", () => ({
  getPrivColor: (priv: string) => {
    if (priv === "SELECT") return { bg: "rgba(34,197,94,0.18)", fg: "#4ade80" };
    if (priv === "INSERT") return { bg: "rgba(59,130,246,0.18)", fg: "#60a5fa" };
    return { bg: "rgba(139,92,246,0.15)", fg: "#a78bfa" };
  },
}));

const sampleGroups: GrantDisplayGroup[] = [
  {
    scope: "TABLE",
    icon: "table",
    items: [
      { displayName: "orders", context: "default_catalog.analytics_db", privs: ["SELECT", "INSERT"] },
      { displayName: "products", context: "default_catalog.analytics_db", privs: ["SELECT"] },
    ],
  },
  {
    scope: "DATABASE",
    icon: "database",
    items: [
      { displayName: "analytics_db", context: "implicit access", privs: ["USAGE (implicit)"] },
    ],
  },
];

describe("GrantTreeView", () => {
  it("renders title when provided", () => {
    render(<GrantTreeView groups={sampleGroups} title="Effective Privileges" />);
    expect(screen.getByText(/Effective Privileges/)).toBeInTheDocument();
  });

  it("renders title with total grant count", () => {
    render(<GrantTreeView groups={sampleGroups} title="Privileges" totalGrants={5} />);
    expect(screen.getByText("Privileges (5 grants)")).toBeInTheDocument();
  });

  it("does not render title when not provided", () => {
    render(<GrantTreeView groups={sampleGroups} />);
    // No title rendered — only scope content
    expect(screen.queryByText(/grants\)/)).not.toBeInTheDocument();
  });

  it("renders scope group headers with icons", () => {
    render(<GrantTreeView groups={sampleGroups} />);
    expect(screen.getByText("TABLE")).toBeInTheDocument();
    expect(screen.getByText("DATABASE")).toBeInTheDocument();
    expect(screen.getByTestId("icon-table")).toBeInTheDocument();
    expect(screen.getByTestId("icon-database")).toBeInTheDocument();
  });

  it("renders item count per scope", () => {
    render(<GrantTreeView groups={sampleGroups} />);
    expect(screen.getByText("(2)")).toBeInTheDocument(); // TABLE has 2 items
    expect(screen.getByText("(1)")).toBeInTheDocument(); // DATABASE has 1 item
  });

  it("renders privilege tags for items", () => {
    render(<GrantTreeView groups={sampleGroups} />);
    // SELECT appears twice (in orders and products), INSERT once
    const selectTags = screen.getAllByText("SELECT");
    expect(selectTags.length).toBe(2);
    expect(screen.getByText("INSERT")).toBeInTheDocument();
    expect(screen.getByText("USAGE (implicit)")).toBeInTheDocument();
  });

  it("renders display names for items", () => {
    render(<GrantTreeView groups={sampleGroups} />);
    expect(screen.getByText("orders")).toBeInTheDocument();
    expect(screen.getByText("products")).toBeInTheDocument();
    expect(screen.getByText("analytics_db")).toBeInTheDocument();
  });

  it("renders context for items", () => {
    render(<GrantTreeView groups={sampleGroups} />);
    const contexts = screen.getAllByText("default_catalog.analytics_db");
    expect(contexts.length).toBe(2);
    expect(screen.getByText("implicit access")).toBeInTheDocument();
  });

  it("renders 'Inherited from' badges when sourceRoles provided", () => {
    render(<GrantTreeView groups={sampleGroups} sourceRoles={["db_admin", "analyst"]} />);
    expect(screen.getByText("Inherited from")).toBeInTheDocument();
    expect(screen.getByText("db_admin")).toBeInTheDocument();
    expect(screen.getByText("analyst")).toBeInTheDocument();
  });

  it("does not render 'Inherited from' when sourceRoles is empty", () => {
    render(<GrantTreeView groups={sampleGroups} sourceRoles={[]} />);
    expect(screen.queryByText("Inherited from")).not.toBeInTheDocument();
  });

  it("renders 'No grants found' for empty groups", () => {
    render(<GrantTreeView groups={[]} />);
    expect(screen.getByText("No grants found")).toBeInTheDocument();
  });

  it("does not render 'No grants found' when groups are present", () => {
    render(<GrantTreeView groups={sampleGroups} />);
    expect(screen.queryByText("No grants found")).not.toBeInTheDocument();
  });
});
