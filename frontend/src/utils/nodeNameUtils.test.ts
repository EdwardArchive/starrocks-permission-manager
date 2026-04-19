import { describe, it, expect } from "vitest";
import { shortenNodeName } from "./nodeNameUtils";

describe("shortenNodeName", () => {
  it("strips K8s FQDN to first DNS label", () => {
    expect(shortenNodeName("starrocks-oss-cn-1.starrocks-oss-cn-search.starrocks-oss.svc.cluster.local"))
      .toBe("starrocks-oss-cn-1");
    expect(shortenNodeName("starrocks-oss-fe-0.ns.svc.cluster.local"))
      .toBe("starrocks-oss-fe-0");
  });

  it("strips _<port>_<timestamp> suffix from FE names", () => {
    expect(shortenNodeName("starrocks-oss-fe-0_9010_1775306864789"))
      .toBe("starrocks-oss-fe-0");
    expect(shortenNodeName("fe-01_9010_1234567890"))
      .toBe("fe-01");
  });

  it("handles FQDN that also has suffix (strips dot first, then suffix)", () => {
    expect(shortenNodeName("starrocks-oss-fe-0_9010_1775306864789.ns.svc.cluster.local"))
      .toBe("starrocks-oss-fe-0");
  });

  it("leaves IPv4 addresses unchanged", () => {
    expect(shortenNodeName("10.100.1.2")).toBe("10.100.1.2");
    expect(shortenNodeName("192.168.0.1")).toBe("192.168.0.1");
  });

  it("leaves plain short names unchanged", () => {
    expect(shortenNodeName("fe-01")).toBe("fe-01");
    expect(shortenNodeName("20001")).toBe("20001");
    expect(shortenNodeName("starrocks-oss-cn-0")).toBe("starrocks-oss-cn-0");
  });

  it("returns empty string unchanged", () => {
    expect(shortenNodeName("")).toBe("");
  });
});
