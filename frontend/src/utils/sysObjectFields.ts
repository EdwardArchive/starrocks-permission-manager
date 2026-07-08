/**
 * Build the [label, value] detail rows for a StarRocks system object, keyed by its type.
 *
 * Extracted verbatim from InventoryDetailPanel's SysObjectInfoPane so the per-type
 * field mapping is unit-testable in isolation. Zero-value numeric limits are omitted
 * (matching the UI's "hide zero-value fields" behavior). The special
 * `__CREATOR__name__system|user` sentinel for TASK creators is rendered by MetaItem.
 */

export function buildSysObjectFields(obj: Record<string, string>): [string, string][] {
  const fields: [string, string][] = [["Name", obj.name], ["Type", obj.type]];

  switch (obj.type) {
    case "RESOURCE_GROUP":
      if (obj.cpu_weight && obj.cpu_weight !== "0") fields.push(["CPU Weight", obj.cpu_weight]);
      if (obj.exclusive_cpu_cores && obj.exclusive_cpu_cores !== "0") fields.push(["Exclusive CPU Cores", obj.exclusive_cpu_cores]);
      if (obj.mem_limit) fields.push(["Memory Limit", obj.mem_limit]);
      if (obj.concurrency_limit && obj.concurrency_limit !== "0") fields.push(["Concurrency Limit", obj.concurrency_limit]);
      if (obj.big_query_cpu_second_limit && obj.big_query_cpu_second_limit !== "0") fields.push(["Big Query CPU Limit", obj.big_query_cpu_second_limit + "s"]);
      if (obj.big_query_scan_rows_limit && obj.big_query_scan_rows_limit !== "0") fields.push(["Big Query Rows Limit", Number(obj.big_query_scan_rows_limit).toLocaleString()]);
      if (obj.big_query_mem_limit && obj.big_query_mem_limit !== "0") fields.push(["Big Query Mem Limit", obj.big_query_mem_limit]);
      if (obj.spill_mem_limit_threshold && obj.spill_mem_limit_threshold !== "0") fields.push(["Spill Threshold", obj.spill_mem_limit_threshold]);
      break;
    case "STORAGE_VOLUME":
      if (obj.sv_type) fields.push(["Storage Type", obj.sv_type]);
      if (obj.location) fields.push(["Location", obj.location]);
      if (obj.is_default) fields.push(["Default", obj.is_default]);
      if (obj.enabled) fields.push(["Enabled", obj.enabled]);
      break;
    case "RESOURCE":
      if (obj.resource_type) fields.push(["Resource Type", obj.resource_type]);
      if (obj.jdbc_uri) fields.push(["JDBC URI", obj.jdbc_uri]);
      if (obj["spark.master"]) fields.push(["Spark Master", obj["spark.master"]]);
      break;
    case "WAREHOUSE":
      if (obj.state) fields.push(["State", obj.state]);
      if (obj.node_count) fields.push(["Node Count", obj.node_count]);
      if (obj.running_sql) fields.push(["Running SQL", obj.running_sql]);
      if (obj.queued_sql) fields.push(["Queued SQL", obj.queued_sql]);
      break;
    case "GLOBAL_FUNCTION":
      if (obj.signature) fields.push(["Signature", obj.signature]);
      if (obj.return_type) fields.push(["Return Type", obj.return_type]);
      if (obj.function_type) fields.push(["Function Type", obj.function_type]);
      break;
    case "PIPE":
      if (obj.database) fields.push(["Database", obj.database]);
      if (obj.state) fields.push(["State", obj.state]);
      if (obj.table_name) fields.push(["Target Table", obj.table_name]);
      if (obj.load_status) fields.push(["Load Status", obj.load_status]);
      break;
    case "TASK":
      if (obj.state) fields.push(["State", obj.state]);
      if (obj.database) fields.push(["Database", obj.database]);
      if (obj.schedule) fields.push(["Schedule", obj.schedule]);
      if (obj.creator) {
        const cm = obj.creator.match(/^'?([^'@]+)'?@/);
        const creatorName = cm ? cm[1] : obj.creator;
        const isSystem = /^(mv-|pipe-)/.test(obj.name);
        fields.push(["Creator", `__CREATOR__${creatorName}__${isSystem ? "system" : "user"}`]);
      }
      if (obj.definition) fields.push(["Definition", obj.definition]);
      break;
  }

  return fields;
}
