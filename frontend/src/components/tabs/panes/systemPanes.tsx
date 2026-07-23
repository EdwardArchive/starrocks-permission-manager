import { useMemo, useState } from "react";
import { type MyPermissionsResponse, getObjectPrivileges } from "../../../api/user";
import { C, OBJECT_TYPE_MAP, type SelectedItem } from "../../../utils/inventory-helpers";
import { SectionLabel, Loader, MetaItem } from "../inventory-ui";
import { ObjectPrivilegesPane, PermissionMatrixView } from "../PermissionMatrix";
import { useAsyncData } from "../../../hooks/useAsyncData";
import { parseResourceGroupClassifiers } from "../../../utils/resourceGroupClassifiers";
import { buildSysObjectFields } from "../../../utils/sysObjectFields";
import { RequiredPrivilegesTable, type PrivReqRow } from "./RequiredPrivilegesTable";

/* ── Required-privilege reference rows (static, per StarRocks docs) ── */
const TASK_PRIV_ROWS: PrivReqRow[] = [
  { action: "SUBMIT TASK", requirement: "INSERT on target table (+ SELECT for source)" },
  { action: "Schedule Run", requirement: "Re-validated with creator's current privileges" },
  { action: "DROP TASK", requirement: <><span style={{ color: "#f59e0b" }}>&#9888;</span> No privilege restriction — use caution</> },
  { action: "View Tasks", requirement: <>All users via <code style={{ color: C.accent }}>information_schema.tasks</code></> },
];

const PIPE_PRIV_ROWS: PrivReqRow[] = [
  { action: "CREATE PIPE", requirement: <><code style={{ color: C.accent }}>CREATE PIPE</code> on the database + INSERT on target table</> },
  { action: "ALTER / SUSPEND / RESUME", requirement: <>Owner or <code style={{ color: C.accent }}>ALTER</code> privilege on the pipe</> },
  { action: "DROP PIPE", requirement: <>Owner or <code style={{ color: C.accent }}>DROP</code> privilege on the pipe</> },
  { action: "View Pipes", requirement: <>All users via <code style={{ color: C.accent }}>information_schema.pipes</code></> },
];

/* ── Task Privileges (Task is not a grantable object) ── */
export function TaskPrivilegesPane() {
  return (
    <div style={{ padding: 16, fontSize: 12, color: C.text2, lineHeight: 1.8 }}>
      <RequiredPrivilegesTable
        banner="NO DIRECT PRIVILEGES"
        intro={<>Task is not a grantable object in StarRocks.<br /><code style={{ color: C.accent, fontSize: 11 }}>GRANT ... ON TASK</code> does not exist.</>}
        rows={TASK_PRIV_ROWS}
        note="Note: Scheduled tasks run under the creator's privilege context. If privileges are revoked, the task will fail."
      />
    </div>
  );
}

/* ── Pipe Privileges (with context explanation) ── */
export function PipePrivilegesPane({ item }: { item: SelectedItem }) {
  const { data, loading } = useAsyncData(
    () => getObjectPrivileges(undefined, undefined, item.name, "PIPE"),
    [item.name],
    { keepPreviousData: true },
  );
  const grants = data ?? [];

  return (
    <div style={{ padding: 16, fontSize: 12, color: C.text2, lineHeight: 1.8 }}>
      {loading && data == null ? (
        <Loader />
      ) : grants.length > 0 ? (
        <PermissionMatrixView grants={grants} objectType="PIPE" />
      ) : (
        <RequiredPrivilegesTable
          banner="NO PRIVILEGE GRANTS FOUND"
          intro={<>This pipe is visible via <code style={{ color: C.accent, fontSize: 11 }}>information_schema.pipes</code>, but no explicit <code style={{ color: C.accent, fontSize: 11 }}>GRANT ... ON PIPE</code> was found for your roles.</>}
          rows={PIPE_PRIV_ROWS}
          note="Note: Pipes run under the creator's privilege context. The pipe is visible to all users, but only the owner or users with explicit GRANT can manage it."
        />
      )}
    </div>
  );
}

/* ── System Object Privileges ── */
export function SysObjectPrivilegesPane({ item }: { item: SelectedItem }) {
  const objType = OBJECT_TYPE_MAP[item.tab] || item.tab.toUpperCase();
  // System objects (RESOURCE GROUP, WAREHOUSE, STORAGE VOLUME, etc.) are not scoped to catalog/database
  const NON_SCOPED = new Set(["RESOURCE GROUP", "WAREHOUSE", "STORAGE VOLUME", "RESOURCE", "GLOBAL FUNCTION"]);
  const noScope = NON_SCOPED.has(objType);
  return <ObjectPrivilegesPane catalog={noScope ? "" : (item.catalog || "")} database={noScope ? "" : (item.database || "")} name={item.name} objectType={objType} />;
}

/* ── Resource Group: Assigned To (paginated) ── */
const CLF_LABELS: Record<string, string> = {
  user: "User", role: "Role", query_type: "Query Type", source_ip: "Source IP",
  db: "Database", plan_cpu_cost_range: "CPU Cost", plan_mem_cost_range: "Mem Cost",
};
const CLF_PAGE_SIZE = 3;

export function RGAssignedTo({ classifiers, currentUser }: { classifiers: Record<string, string>[]; currentUser: string }) {
  const [page, setPage] = useState(0);
  const totalPages = Math.ceil(classifiers.length / CLF_PAGE_SIZE);
  const slice = classifiers.slice(page * CLF_PAGE_SIZE, (page + 1) * CLF_PAGE_SIZE);

  return (
    <div style={{ marginTop: 16 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <SectionLabel>Assigned To ({classifiers.length})</SectionLabel>
        {totalPages > 1 && (
          <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: C.text3 }}>
            <button onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={page === 0}
              style={{ background: "none", border: "none", cursor: page === 0 ? "default" : "pointer", color: page === 0 ? C.border : C.text2, fontSize: 12, fontFamily: "inherit", padding: "2px 4px" }}>◀</button>
            <span>{page + 1}/{totalPages}</span>
            <button onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))} disabled={page === totalPages - 1}
              style={{ background: "none", border: "none", cursor: page === totalPages - 1 ? "default" : "pointer", color: page === totalPages - 1 ? C.border : C.text2, fontSize: 12, fontFamily: "inherit", padding: "2px 4px" }}>▶</button>
          </div>
        )}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 8 }}>
        {slice.map((clf, idx) => {
          const globalIdx = page * CLF_PAGE_SIZE + idx + 1;
          const isCurrentUser = !!clf.user && currentUser.startsWith(clf.user);
          const entries = Object.entries(clf).filter(([k]) => k !== "id" && k !== "weight");
          return (
            <div key={globalIdx} style={{
              borderRadius: 6, overflow: "hidden",
              border: `1px solid ${isCurrentUser ? C.accent : C.border}`,
              background: isCurrentUser ? `${C.accent}06` : undefined,
            }}>
              <div style={{
                padding: "5px 10px", fontSize: 10, fontWeight: 600, color: isCurrentUser ? C.accent : C.text3,
                borderBottom: `1px solid ${isCurrentUser ? C.accent + "40" : C.border}`,
                background: isCurrentUser ? `${C.accent}10` : `${C.bg}`,
                display: "flex", alignItems: "center", gap: 6,
              }}>
                Rule {globalIdx}
                {isCurrentUser && <span style={{ fontSize: 9, padding: "1px 5px", borderRadius: 3, background: C.accent, color: "#fff" }}>YOU</span>}
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "90px 1fr", gap: "6px 10px", padding: "8px 10px", fontSize: 12 }}>
                {entries.map(([k, v]) => (
                  <MetaItem key={k} label={CLF_LABELS[k] || k} value={v} />
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ── System Object Info ── */
export function SysObjectInfoPane({ item, myData }: { item: SelectedItem; myData: MyPermissionsResponse | null }) {
  const obj = useMemo(() => {
    if (!myData) return null;
    return myData.system_objects?.find((o) => o.name === item.name && o.type === (OBJECT_TYPE_MAP[item.tab] || "").replace(" ", "_")) || null;
  }, [myData, item.name, item.tab]);

  // Parse classifiers for RESOURCE_GROUP (must be before early return to satisfy Rules of Hooks)
  const { classifiers, isSystemDefault } = useMemo(() => {
    if (!obj || obj.type !== "RESOURCE_GROUP") return { classifiers: [], isSystemDefault: false };
    return parseResourceGroupClassifiers(obj.classifiers);
  }, [obj]);

  if (!obj) return <div style={{ padding: 16, color: C.text3, fontSize: 12 }}>No detail available</div>;

  const fields = buildSysObjectFields(obj);
  const currentUser = myData?.username || "";

  return (
    <div>
      <SectionLabel>Details</SectionLabel>
      <div style={{ display: "grid", gridTemplateColumns: "90px 1fr", gap: "10px 10px", fontSize: 12, marginTop: 8 }}>
        {fields.map(([label, value]) => (
          <MetaItem key={label} label={label} value={value} />
        ))}
      </div>
      {obj.type === "RESOURCE_GROUP" && classifiers.length > 0 && (
        <RGAssignedTo classifiers={classifiers} currentUser={currentUser} />
      )}
      {obj.type === "RESOURCE_GROUP" && classifiers.length === 0 && (
        <div style={{ marginTop: 16 }}>
          <SectionLabel>Assigned To</SectionLabel>
          <div style={{ padding: "8px 0", fontSize: 12, color: C.text3 }}>
            {isSystemDefault
              ? "System default — automatically assigned to unmatched queries"
              : "No assignments defined"}
          </div>
        </div>
      )}
    </div>
  );
}
