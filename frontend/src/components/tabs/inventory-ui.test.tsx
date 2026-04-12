import { describe, it, expect, vi } from "vitest";
import { render, screen } from "../../test/test-utils";
import userEvent from "@testing-library/user-event";
import {
  SearchInput,
  Chip,
  Badge,
  SectionLabel,
  Loader,
  TH,
  SortTH,
  TD,
  MetaItem,
} from "./inventory-ui";

// Mock InlineIcon
vi.mock("../common/InlineIcon", () => ({
  default: ({ type, size }: { type: string; size?: number }) => (
    <span data-testid={`icon-${type}`} data-size={size} />
  ),
}));

// Mock inventory-helpers C and formatSQL
vi.mock("../../utils/inventory-helpers", () => ({
  C: {
    bg: "#0f172a",
    card: "#1e293b",
    border: "#334155",
    borderLight: "#475569",
    text1: "#e2e8f0",
    text2: "#94a3b8",
    text3: "#64748b",
    accent: "#3b82f6",
  },
  formatSQL: (sql: string) => sql,
}));

describe("SearchInput", () => {
  it("renders with placeholder text", () => {
    render(<SearchInput value="" onChange={() => {}} />);
    expect(screen.getByPlaceholderText("Filter by name...")).toBeInTheDocument();
  });

  it("displays current value", () => {
    render(<SearchInput value="test-query" onChange={() => {}} />);
    const input = screen.getByPlaceholderText("Filter by name...") as HTMLInputElement;
    expect(input.value).toBe("test-query");
  });

  it("calls onChange when typing", async () => {
    const user = userEvent.setup();
    const handleChange = vi.fn();
    render(<SearchInput value="" onChange={handleChange} />);
    const input = screen.getByPlaceholderText("Filter by name...");
    await user.type(input, "abc");
    expect(handleChange).toHaveBeenCalledTimes(3);
    expect(handleChange).toHaveBeenLastCalledWith("c");
  });

  it("shows clear button when value is non-empty", () => {
    render(<SearchInput value="something" onChange={() => {}} />);
    // The clear button renders a times character
    expect(screen.getByRole("button")).toBeInTheDocument();
  });

  it("does not show clear button when value is empty", () => {
    render(<SearchInput value="" onChange={() => {}} />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("calls onChange with empty string when clear is clicked", async () => {
    const user = userEvent.setup();
    const handleChange = vi.fn();
    render(<SearchInput value="test" onChange={handleChange} />);
    await user.click(screen.getByRole("button"));
    expect(handleChange).toHaveBeenCalledWith("");
  });
});

describe("Chip", () => {
  it("renders label text", () => {
    render(<Chip label="Tables" active={false} onClick={() => {}} />);
    expect(screen.getByText("Tables")).toBeInTheDocument();
  });

  it("calls onClick when clicked", async () => {
    const user = userEvent.setup();
    const handleClick = vi.fn();
    render(<Chip label="Roles" active={false} onClick={handleClick} />);
    await user.click(screen.getByText("Roles"));
    expect(handleClick).toHaveBeenCalledTimes(1);
  });

  it("renders as a button element", () => {
    render(<Chip label="Views" active={true} onClick={() => {}} />);
    expect(screen.getByRole("button", { name: "Views" })).toBeInTheDocument();
  });
});

describe("Badge", () => {
  it("renders text content", () => {
    render(<Badge text="ADMIN" color="#3b82f6" />);
    expect(screen.getByText("ADMIN")).toBeInTheDocument();
  });

  it("renders as uppercase styled span", () => {
    const { container } = render(<Badge text="builtin" color="#6366f1" />);
    const span = container.querySelector("span");
    expect(span).toBeInTheDocument();
    expect(span?.style.textTransform).toBe("uppercase");
  });
});

describe("SectionLabel", () => {
  it("renders children text", () => {
    render(<SectionLabel>Permissions</SectionLabel>);
    expect(screen.getByText("Permissions")).toBeInTheDocument();
  });
});

describe("Loader", () => {
  it("renders loading text", () => {
    render(<Loader />);
    expect(screen.getByText("Loading...")).toBeInTheDocument();
  });
});

describe("TH", () => {
  it("renders header cell with text", () => {
    render(
      <table><thead><tr><TH>Name</TH></tr></thead></table>,
    );
    expect(screen.getByText("Name")).toBeInTheDocument();
  });

  it("renders as th element", () => {
    render(
      <table><thead><tr><TH>Type</TH></tr></thead></table>,
    );
    const th = screen.getByText("Type").closest("th");
    expect(th).toBeInTheDocument();
  });
});

describe("SortTH", () => {
  it("renders header text", () => {
    render(
      <table><thead><tr><SortTH label="Name" dir="asc" onToggle={() => {}} /></tr></thead></table>,
    );
    expect(screen.getByText("Name")).toBeInTheDocument();
  });

  it("shows ascending arrow when dir is asc", () => {
    render(
      <table><thead><tr><SortTH label="Name" dir="asc" onToggle={() => {}} /></tr></thead></table>,
    );
    expect(screen.getByText("▲")).toBeInTheDocument();
  });

  it("shows descending arrow when dir is desc", () => {
    render(
      <table><thead><tr><SortTH label="Name" dir="desc" onToggle={() => {}} /></tr></thead></table>,
    );
    expect(screen.getByText("▼")).toBeInTheDocument();
  });

  it("calls onToggle when clicked", async () => {
    const user = userEvent.setup();
    const handleToggle = vi.fn();
    render(
      <table><thead><tr><SortTH label="Name" dir="asc" onToggle={handleToggle} /></tr></thead></table>,
    );
    await user.click(screen.getByText("Name"));
    expect(handleToggle).toHaveBeenCalledTimes(1);
  });
});

describe("TD", () => {
  it("renders data cell with text", () => {
    render(
      <table><tbody><tr><TD>Cell Value</TD></tr></tbody></table>,
    );
    expect(screen.getByText("Cell Value")).toBeInTheDocument();
  });

  it("renders as td element", () => {
    render(
      <table><tbody><tr><TD>Data</TD></tr></tbody></table>,
    );
    const td = screen.getByText("Data").closest("td");
    expect(td).toBeInTheDocument();
  });
});

describe("MetaItem", () => {
  it("renders label and plain text value", () => {
    render(
      <table><tbody><tr><MetaItem label="Engine" value="OLAP" /></tr></tbody></table>,
    );
    expect(screen.getByText("Engine")).toBeInTheDocument();
    expect(screen.getByText("OLAP")).toBeInTheDocument();
  });

  it("renders creator format with name and badge", () => {
    render(
      <table><tbody><tr><MetaItem label="Creator" value="__CREATOR__root__system" /></tr></tbody></table>,
    );
    expect(screen.getByText("Creator")).toBeInTheDocument();
    expect(screen.getByText("root")).toBeInTheDocument();
    expect(screen.getByText("system")).toBeInTheDocument();
    expect(screen.getByTestId("icon-system")).toBeInTheDocument();
  });

  it("renders creator format with user kind", () => {
    render(
      <table><tbody><tr><MetaItem label="Creator" value="__CREATOR__john__user" /></tr></tbody></table>,
    );
    expect(screen.getByText("john")).toBeInTheDocument();
    expect(screen.getByText("user")).toBeInTheDocument();
    expect(screen.getByTestId("icon-user")).toBeInTheDocument();
  });

  it("renders SQL-like value as pre element", () => {
    const { container } = render(
      <table><tbody><tr><MetaItem label="DDL" value="CREATE TABLE test (id INT)" /></tr></tbody></table>,
    );
    const pre = container.querySelector("pre");
    expect(pre).toBeInTheDocument();
    expect(pre?.textContent).toBe("CREATE TABLE test (id INT)");
  });
});
