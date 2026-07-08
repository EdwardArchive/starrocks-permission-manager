import { describe, it, expect } from "vitest";
import { buildSysObjectFields } from "./sysObjectFields";

describe("buildSysObjectFields", () => {
  it("always leads with Name and Type", () => {
    expect(buildSysObjectFields({ name: "foo", type: "UNKNOWN_TYPE" })).toEqual([
      ["Name", "foo"],
      ["Type", "UNKNOWN_TYPE"],
    ]);
  });

  it("RESOURCE_GROUP: includes all non-zero limits, formats rows count and CPU seconds", () => {
    const fields = buildSysObjectFields({
      name: "rg", type: "RESOURCE_GROUP",
      cpu_weight: "10", exclusive_cpu_cores: "4", mem_limit: "20%",
      concurrency_limit: "15", big_query_cpu_second_limit: "100",
      big_query_scan_rows_limit: "1000000", big_query_mem_limit: "2G",
      spill_mem_limit_threshold: "0.8",
    });
    expect(fields).toContainEqual(["CPU Weight", "10"]);
    expect(fields).toContainEqual(["Exclusive CPU Cores", "4"]);
    expect(fields).toContainEqual(["Memory Limit", "20%"]);
    expect(fields).toContainEqual(["Concurrency Limit", "15"]);
    expect(fields).toContainEqual(["Big Query CPU Limit", "100s"]);
    expect(fields).toContainEqual(["Big Query Rows Limit", (1000000).toLocaleString()]);
    expect(fields).toContainEqual(["Big Query Mem Limit", "2G"]);
    expect(fields).toContainEqual(["Spill Threshold", "0.8"]);
  });

  it("RESOURCE_GROUP: omits zero-value and missing limits", () => {
    const fields = buildSysObjectFields({
      name: "rg", type: "RESOURCE_GROUP",
      cpu_weight: "10", mem_limit: "20%", concurrency_limit: "0",
      exclusive_cpu_cores: "0", big_query_cpu_second_limit: "0",
      big_query_scan_rows_limit: "0", big_query_mem_limit: "0",
      spill_mem_limit_threshold: "0",
    });
    const labels = fields.map(([l]) => l);
    expect(labels).toContain("CPU Weight");
    expect(labels).toContain("Memory Limit");
    expect(labels).not.toContain("Concurrency Limit");
    expect(labels).not.toContain("Exclusive CPU Cores");
    expect(labels).not.toContain("Big Query CPU Limit");
    expect(labels).not.toContain("Spill Threshold");
  });

  it("STORAGE_VOLUME: maps storage fields", () => {
    const fields = buildSysObjectFields({
      name: "sv", type: "STORAGE_VOLUME",
      sv_type: "S3", location: "s3://bucket", is_default: "true", enabled: "true",
    });
    expect(fields).toContainEqual(["Storage Type", "S3"]);
    expect(fields).toContainEqual(["Location", "s3://bucket"]);
    expect(fields).toContainEqual(["Default", "true"]);
    expect(fields).toContainEqual(["Enabled", "true"]);
  });

  it("RESOURCE: maps resource fields including dotted spark.master key", () => {
    const fields = buildSysObjectFields({
      name: "res", type: "RESOURCE",
      resource_type: "spark", jdbc_uri: "jdbc:mysql://h", "spark.master": "yarn",
    });
    expect(fields).toContainEqual(["Resource Type", "spark"]);
    expect(fields).toContainEqual(["JDBC URI", "jdbc:mysql://h"]);
    expect(fields).toContainEqual(["Spark Master", "yarn"]);
  });

  it("WAREHOUSE: maps warehouse fields", () => {
    const fields = buildSysObjectFields({
      name: "wh", type: "WAREHOUSE",
      state: "RUNNING", node_count: "3", running_sql: "2", queued_sql: "1",
    });
    expect(fields).toContainEqual(["State", "RUNNING"]);
    expect(fields).toContainEqual(["Node Count", "3"]);
    expect(fields).toContainEqual(["Running SQL", "2"]);
    expect(fields).toContainEqual(["Queued SQL", "1"]);
  });

  it("GLOBAL_FUNCTION: maps function fields", () => {
    const fields = buildSysObjectFields({
      name: "gf", type: "GLOBAL_FUNCTION",
      signature: "gf(INT)", return_type: "INT", function_type: "SCALAR",
    });
    expect(fields).toContainEqual(["Signature", "gf(INT)"]);
    expect(fields).toContainEqual(["Return Type", "INT"]);
    expect(fields).toContainEqual(["Function Type", "SCALAR"]);
  });

  it("PIPE: maps pipe fields", () => {
    const fields = buildSysObjectFields({
      name: "p", type: "PIPE",
      database: "db1", state: "RUNNING", table_name: "t1", load_status: "{}",
    });
    expect(fields).toContainEqual(["Database", "db1"]);
    expect(fields).toContainEqual(["State", "RUNNING"]);
    expect(fields).toContainEqual(["Target Table", "t1"]);
    expect(fields).toContainEqual(["Load Status", "{}"]);
  });

  it("TASK: parses a quoted user@host creator into the user sentinel", () => {
    const fields = buildSysObjectFields({
      name: "my_task", type: "TASK",
      state: "ACTIVE", database: "db1", schedule: "EVERY 1 DAY",
      creator: "'alice'@'%'", definition: "INSERT INTO t SELECT 1",
    });
    expect(fields).toContainEqual(["State", "ACTIVE"]);
    expect(fields).toContainEqual(["Database", "db1"]);
    expect(fields).toContainEqual(["Schedule", "EVERY 1 DAY"]);
    expect(fields).toContainEqual(["Creator", "__CREATOR__alice__user"]);
    expect(fields).toContainEqual(["Definition", "INSERT INTO t SELECT 1"]);
  });

  it("TASK: flags system-generated tasks (mv-/pipe- prefix) as system creator", () => {
    const fields = buildSysObjectFields({
      name: "mv-123", type: "TASK", creator: "bob@host",
    });
    expect(fields).toContainEqual(["Creator", "__CREATOR__bob__system"]);
  });

  it("TASK: falls back to raw creator string when it does not match user@host", () => {
    const fields = buildSysObjectFields({
      name: "t", type: "TASK", creator: "system",
    });
    expect(fields).toContainEqual(["Creator", "__CREATOR__system__user"]);
  });

  it("omits optional fields that are absent", () => {
    const fields = buildSysObjectFields({ name: "p", type: "PIPE" });
    expect(fields).toEqual([["Name", "p"], ["Type", "PIPE"]]);
  });

  it("omits every optional field when absent, for all system-object types", () => {
    for (const type of ["RESOURCE_GROUP", "STORAGE_VOLUME", "RESOURCE", "WAREHOUSE", "GLOBAL_FUNCTION", "PIPE", "TASK"]) {
      expect(buildSysObjectFields({ name: "x", type })).toEqual([["Name", "x"], ["Type", type]]);
    }
  });

  it("RESOURCE_GROUP: hides cpu_weight '0' and blank mem_limit", () => {
    const labels = buildSysObjectFields({ name: "rg", type: "RESOURCE_GROUP", cpu_weight: "0", mem_limit: "" }).map(([l]) => l);
    expect(labels).not.toContain("CPU Weight");
    expect(labels).not.toContain("Memory Limit");
  });
});
