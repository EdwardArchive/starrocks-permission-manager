import { describe, it, expect } from "vitest";
import { parseGrantee } from "./granteeName";

describe("parseGrantee", () => {
  it("parses a fully quoted identity with % host", () => {
    expect(parseGrantee("'root'@'%'")).toEqual({ uname: "root", host: "%", hostLabel: "ALL CIDR" });
  });

  it("parses an unquoted identity", () => {
    expect(parseGrantee("root@%")).toEqual({ uname: "root", host: "%", hostLabel: "ALL CIDR" });
  });

  it("parses mixed quoting", () => {
    expect(parseGrantee("'alice'@10.0.0.1")).toEqual({ uname: "alice", host: "10.0.0.1", hostLabel: "10.0.0.1/32" });
    expect(parseGrantee("alice@'10.0.0.1'")).toEqual({ uname: "alice", host: "10.0.0.1", hostLabel: "10.0.0.1/32" });
  });

  it("suffixes bare IP hosts with /32", () => {
    expect(parseGrantee("'app'@'10.0.0.1'")).toEqual({ uname: "app", host: "10.0.0.1", hostLabel: "10.0.0.1/32" });
  });

  it("passes CIDR hosts through unchanged", () => {
    expect(parseGrantee("'app'@'10.0.0.0/24'")).toEqual({ uname: "app", host: "10.0.0.0/24", hostLabel: "10.0.0.0/24" });
  });

  it("treats an empty host as ALL CIDR", () => {
    expect(parseGrantee("'alice'@''")).toEqual({ uname: "alice", host: "", hostLabel: "ALL CIDR" });
    expect(parseGrantee("alice@")).toEqual({ uname: "alice", host: "", hostLabel: "ALL CIDR" });
  });

  it("returns the input unchanged for names without @ (e.g. roles)", () => {
    expect(parseGrantee("db_admin")).toEqual({ uname: "db_admin", host: null, hostLabel: null });
  });

  it("returns the input unchanged for the empty string", () => {
    expect(parseGrantee("")).toEqual({ uname: "", host: null, hostLabel: null });
  });

  it("does not parse names where @ has no username before it", () => {
    expect(parseGrantee("@'%'")).toEqual({ uname: "@'%'", host: null, hostLabel: null });
  });
});
