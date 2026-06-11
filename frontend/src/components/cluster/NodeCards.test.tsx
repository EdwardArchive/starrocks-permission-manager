import { describe, it, expect, vi } from "vitest";
import { render, screen } from "../../test/test-utils";
import { FENodeCard, BENodeCard, UtilBar } from "./NodeCards";
import { makeFENode, makeBENode } from "../../test/cluster-fixtures";
import { C } from "../../utils/colors";

const noop = () => {};

describe("FENodeCard", () => {
  it("shows display name and role badge", () => {
    render(<FENodeCard node={makeFENode()} expanded={false} onToggle={noop} />);
    expect(screen.getByText("fe-01")).toBeInTheDocument();
    expect(screen.getByText("LEADER")).toBeInTheDocument();
    expect(screen.getByText("ALIVE")).toBeInTheDocument();
  });

  it("shows DEAD badge for dead node", () => {
    render(<FENodeCard node={makeFENode({ alive: false })} expanded={false} onToggle={noop} />);
    expect(screen.getByText("DEAD")).toBeInTheDocument();
  });

  it("shows Heap metric row when jvm_heap_used_pct is present", () => {
    render(<FENodeCard node={makeFENode()} expanded={false} onToggle={noop} />);
    expect(screen.getByText("Heap")).toBeInTheDocument();
    expect(screen.getByText("45.2%")).toBeInTheDocument();
  });

  it("shows metrics unavailable message when metrics_error is set", () => {
    render(
      <FENodeCard
        node={makeFENode({ jvm_heap_used_pct: null, metrics_error: "timeout: 2s" })}
        expanded={false}
        onToggle={noop}
      />,
    );
    expect(screen.getByText(/Metrics unavailable/)).toBeInTheDocument();
  });

  it("clicking the header calls onToggle", () => {
    const onToggle = vi.fn();
    render(<FENodeCard node={makeFENode()} expanded={false} onToggle={onToggle} />);
    screen.getByText("fe-01").click();
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it("expanded card shows Version, Journal ID, GC, and p99 details", () => {
    render(<FENodeCard node={makeFENode()} expanded={true} onToggle={noop} />);
    expect(screen.getByText("Version")).toBeInTheDocument();
    expect(screen.getByText("3.3.0")).toBeInTheDocument();
    expect(screen.getByText("Journal ID")).toBeInTheDocument();
    expect(screen.getByText(/Young GC/i)).toBeInTheDocument();
    expect(screen.getByText(/Old GC/i)).toBeInTheDocument();
    expect(screen.getByText("Query p99")).toBeInTheDocument();
  });

  it("relative start time uses the skew-corrected now", () => {
    // start_time 2026-04-19 10:00 (cluster zone); reference now = 2 hours later
    const now = new Date(Date.parse("2026-04-19T12:00:00Z"));
    render(<FENodeCard node={makeFENode()} expanded={true} onToggle={noop} now={now} />);
    expect(screen.getByText("2 hours ago")).toBeInTheDocument();
  });

  it("expanded card shows err_msg when present", () => {
    render(
      <FENodeCard node={makeFENode({ err_msg: "Disk full" })} expanded={true} onToggle={noop} />,
    );
    expect(screen.getByText("Disk full")).toBeInTheDocument();
  });
});

describe("BENodeCard", () => {
  it("shows BE type badge and tablet count", () => {
    render(<BENodeCard node={makeBENode()} expanded={false} onToggle={noop} />);
    expect(screen.getByText("BE")).toBeInTheDocument();
    expect(screen.getByText("1,000 tablets")).toBeInTheDocument();
  });

  it("shows CN type badge and Disk Cache label for compute node", () => {
    render(
      <BENodeCard
        node={makeBENode({ node_type: "compute", warehouse: "wh1" })}
        expanded={false}
        onToggle={noop}
      />,
    );
    expect(screen.getByText("CN")).toBeInTheDocument();
    expect(screen.getByText(/Disk Cache/)).toBeInTheDocument();
  });

  it("shows plain Disk label for backend node", () => {
    render(<BENodeCard node={makeBENode()} expanded={false} onToggle={noop} />);
    expect(screen.getByText(/^Disk/)).toBeInTheDocument();
    expect(screen.queryByText(/Disk Cache/)).not.toBeInTheDocument();
  });

  it("shows CPU bar for BE when cpu_used_pct is populated (from /metrics probe)", () => {
    render(
      <BENodeCard node={makeBENode({ cpu_used_pct: 33.3 })} expanded={false} onToggle={noop} />,
    );
    expect(screen.getByText("CPU")).toBeInTheDocument();
    expect(screen.getByText("33.3%")).toBeInTheDocument();
  });

  it("hides CPU bar for BE when cpu_used_pct is null", () => {
    render(<BENodeCard node={makeBENode()} expanded={false} onToggle={noop} />);
    expect(screen.queryByText("CPU")).not.toBeInTheDocument();
  });

  it("expanded compute node shows Warehouse detail", () => {
    render(
      <BENodeCard
        node={makeBENode({ node_type: "compute", warehouse: "default_warehouse" })}
        expanded={true}
        onToggle={noop}
      />,
    );
    expect(screen.getByText("Warehouse")).toBeInTheDocument();
    expect(screen.getByText("default_warehouse")).toBeInTheDocument();
  });

  it("expanded node shows Running Queries count", () => {
    render(<BENodeCard node={makeBENode()} expanded={true} onToggle={noop} />);
    expect(screen.getByText("Running Queries")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
  });
});

describe("UtilBar variants", () => {
  function barColor(container: HTMLElement): string {
    const divs = container.querySelectorAll("div");
    const inner = divs[divs.length - 1] as HTMLElement; // innermost = fill bar
    return inner.style.background;
  }

  it("pressure variant turns red above 85%", () => {
    const { container } = render(<UtilBar pct={99} />);
    expect(barColor(container)).toBe("rgb(239, 68, 68)");
  });

  it("pressure variant is green at low utilization", () => {
    const { container } = render(<UtilBar pct={10} />);
    expect(barColor(container)).not.toBe("rgb(239, 68, 68)");
  });

  it("info variant stays accent-colored even at 99% (full cache is normal)", () => {
    const { container } = render(<UtilBar pct={99} variant="info" />);
    const expected = `rgb(${parseInt(C.accent.slice(1, 3), 16)}, ${parseInt(C.accent.slice(3, 5), 16)}, ${parseInt(C.accent.slice(5, 7), 16)})`;
    expect(barColor(container)).toBe(expected);
  });
});
