import { useEffect, useMemo, useState } from "react";
import { type MyPermissionsResponse, getDatabases, getTableDetail, getTables } from "../../api/user";
import { getRolePrivileges, getUserEffectivePrivileges } from "../../api/admin";
import type { PrivilegeGrant, TableDetail, ObjectItem } from "../../types";
import InlineIcon from "../common/InlineIcon";
import GrantTreeView from "../common/GrantTreeView";
import { buildGrantDisplay, extractSourceRoles } from "../../utils/grantDisplay";
import {
  C, OBJECT_TYPE_MAP, formatBytes,
  type SelectedItem,
} from "../../utils/inventory-helpers";
import { SectionLabel, Loader, TH, TD, MetaItem } from "./inventory-ui";
import { ObjectPrivilegesPane } from "./PermissionMatrix";

/* ══════════════════════════════════════════════════════════════
   Detail Panel
   ══════════════════════════════════════════════════════════════ */

export default function DetailPanel({ item, onClose, myData }: { item: SelectedItem; onClose: () => void; myData: MyPermissionsResponse | null }) {
  const [detailTab, setDetailTab] = useState<string>("privileges");


  const isObject = ["tables", "views", "mvs", "functions"].includes(item.tab);
  const isDatabase = item.tab === "databases";
  const isCatalog = item.tab === "catalogs";
  const isRole = item.tab === "roles";
  const isUser = item.tab === "users";
  const isSysObject = ["warehouses", "rgroups", "svolumes", "resources", "gfunctions", "pipes", "tasks"].includes(item.tab);

  const tabs = (isRole || isUser)
    ? [{ key: "privileges", label: "Privileges" }, { key: "members", label: isUser ? "Roles" : "Members" }]
    : isSysObject
      ? [{ key: "privileges", label: "Privileges" }, { key: "info", label: "Info" }]
    : (isDatabase || isCatalog)
      ? [{ key: "privileges", label: "Privileges" }, { key: "objects", label: "Objects" }]
      : [{ key: "privileges", label: "Privileges" }, { key: "details", label: "Details" }];

  const iconType = isUser ? "user" : isRole ? "role" : isCatalog ? "catalog" : isDatabase ? "database" : isSysObject ? "system"
    : item.objectType === "VIEW" ? "view"
    : item.objectType === "MATERIALIZED VIEW" ? "mv"
    : item.objectType === "FUNCTION" ? "function" : "table";

  const pathParts = [item.catalog, item.database, item.name].filter(Boolean);

  return (
    <>
      {/* Header */}
      <div style={{ padding: "16px 20px", borderBottom: `1px solid ${C.border}`, flexShrink: 0 }}>
        {/* Path */}
        <div style={{ fontSize: 12, color: C.text2, marginBottom: 10, wordBreak: "break-all", lineHeight: 1.6 }}>
          {pathParts.map((p, i) => (
            <span key={i}>
              {i > 0 && <span style={{ color: "#475569", margin: "0 3px" }}>/</span>}
              <span style={i === pathParts.length - 1 ? { color: C.text1, fontWeight: 500 } : undefined}>{p}</span>
            </span>
          ))}
        </div>
        {/* Type badge + close */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <span style={{ display: "inline-block", padding: "4px 10px", borderRadius: 6, fontSize: 12, fontWeight: 500, background: `${C.accent}20`, color: C.accent }}>
            {item.objectType ?? iconType.toUpperCase()}
          </span>
          <button onClick={onClose} style={{ width: 28, height: 28, background: "none", border: "none", color: C.text2, cursor: "pointer", fontSize: 18, borderRadius: 6, display: "flex", alignItems: "center", justifyContent: "center" }}>&times;</button>
        </div>
      </div>

      {/* Tab switcher */}
      <div style={{ display: "flex", gap: 0, borderBottom: `1px solid ${C.border}`, flexShrink: 0, padding: "0 20px" }}>
        {tabs.map(({ key, label }) => (
          <button key={key} onClick={() => setDetailTab(key)} style={{
            padding: "10px 16px", fontSize: 13, fontWeight: 500, cursor: "pointer",
            background: "none", border: "none", fontFamily: "inherit", textTransform: "capitalize" as const,
            color: detailTab === key ? C.accent : C.text2,
            borderBottom: detailTab === key ? `2px solid ${C.accent}` : "2px solid transparent",
          }}>{label}</button>
        ))}
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflowY: "auto", padding: "16px 20px" }}>
        {isObject && detailTab === "privileges" && (
          <ObjectPrivilegesPane catalog={item.catalog!} database={item.database!} name={item.name} objectType={item.objectType!} />
        )}
        {isObject && detailTab === "details" && item.tab === "functions" && (
          <FunctionDetailsPane item={item} myData={myData} />
        )}
        {isObject && detailTab === "details" && item.tab !== "functions" && (
          <ObjectDetailsPane catalog={item.catalog!} database={item.database!} name={item.name} />
        )}
        {isCatalog && detailTab === "privileges" && (
          <ObjectPrivilegesPane catalog={item.name} database="" name="" objectType="CATALOG" />
        )}
        {isCatalog && detailTab === "objects" && (
          <CatalogDatabasesPane catalog={item.name} />
        )}
        {isDatabase && detailTab === "privileges" && (
          <ObjectPrivilegesPane catalog={item.catalog!} database={item.name} name="" objectType="DATABASE" />
        )}
        {isDatabase && detailTab === "objects" && (
          <DatabaseObjectsPane catalog={item.catalog!} database={item.name} />
        )}
        {isRole && detailTab === "privileges" && (
          <RolePrivilegesPane roleName={item.name} />
        )}
        {isRole && detailTab === "members" && (
          <RoleMembersPane roleName={item.name} myData={myData} />
        )}
        {isUser && detailTab === "privileges" && (
          <UserPrivilegesPane userName={item.name} />
        )}
        {isUser && detailTab === "members" && (
          <UserRolesPane userName={item.name} />
        )}
        {isSysObject && detailTab === "privileges" && item.tab === "tasks" && (
          <div style={{ padding: 16, fontSize: 12, color: C.text2, lineHeight: 1.8 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 14, padding: "8px 12px", background: "rgba(59,130,246,0.06)", borderLeft: "2px solid #3b82f6", borderRadius: "0 4px 4px 0" }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: C.text1 }}>NO DIRECT PRIVILEGES</span>
            </div>
            <p style={{ marginBottom: 10, color: C.text2 }}>
              Task is not a grantable object in StarRocks.<br />
              <code style={{ color: C.accent, fontSize: 11 }}>GRANT ... ON TASK</code> does not exist.
            </p>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, marginBottom: 12 }}>
              <thead>
                <tr style={{ borderBottom: `1px solid ${C.border}` }}>
                  <th style={{ textAlign: "left", padding: "6px 8px", color: C.text3, fontSize: 10, textTransform: "uppercase" }}>Action</th>
                  <th style={{ textAlign: "left", padding: "6px 8px", color: C.text3, fontSize: 10, textTransform: "uppercase" }}>Required Privilege</th>
                </tr>
              </thead>
              <tbody>
                <tr style={{ borderBottom: `1px solid ${C.border}22` }}>
                  <td style={{ padding: "6px 8px", color: C.text1, fontWeight: 500 }}>SUBMIT TASK</td>
                  <td style={{ padding: "6px 8px" }}>INSERT on target table (+ SELECT for source)</td>
                </tr>
                <tr style={{ borderBottom: `1px solid ${C.border}22` }}>
                  <td style={{ padding: "6px 8px", color: C.text1, fontWeight: 500 }}>Schedule Run</td>
                  <td style={{ padding: "6px 8px" }}>Re-validated with creator&apos;s current privileges</td>
                </tr>
                <tr style={{ borderBottom: `1px solid ${C.border}22` }}>
                  <td style={{ padding: "6px 8px", color: C.text1, fontWeight: 500 }}>DROP TASK</td>
                  <td style={{ padding: "6px 8px" }}><span style={{ color: "#f59e0b" }}>&#9888;</span> No privilege restriction — use caution</td>
                </tr>
                <tr style={{ borderBottom: `1px solid ${C.border}22` }}>
                  <td style={{ padding: "6px 8px", color: C.text1, fontWeight: 500 }}>View Tasks</td>
                  <td style={{ padding: "6px 8px" }}>All users via <code style={{ color: C.accent }}>information_schema.tasks</code></td>
                </tr>
              </tbody>
            </table>
            <p style={{ fontSize: 11, color: C.text3, fontStyle: "italic" }}>
              Note: Scheduled tasks run under the creator&apos;s privilege context. If privileges are revoked, the task will fail.
            </p>
          </div>
        )}
        {isSysObject && detailTab === "privileges" && item.tab !== "tasks" && (
          <SysObjectPrivilegesPane item={item} />
        )}
        {isSysObject && detailTab === "info" && (
          <SysObjectInfoPane item={item} myData={myData} />
        )}
      </div>
    </>
  );
}

/* ── Object Details ── */
function ObjectDetailsPane({ catalog, database, name }: { catalog: string; database: string; name: string }) {
  const [state, setState] = useState<{ detail: TableDetail | null; loading: boolean }>({ detail: null, loading: true });

  useEffect(() => {
    const ac = new AbortController();
    getTableDetail(catalog, database, name)
      .then((detail) => setState({ detail, loading: false }))
      .catch(() => setState({ detail: null, loading: false }));
    return () => { ac.abort(); };
  }, [catalog, database, name]);

  if (state.loading) return <Loader />;
  if (!state.detail) return <div style={{ padding: 16, color: C.text3, fontSize: 12 }}>Unable to load details</div>;

  const d = state.detail;
  const distInfo = d.distribution_type
    ? `${d.distribution_type}(${(d.bucket_keys || []).join(", ")}) × ${d.bucket_count ?? "?"} buckets`
    : null;
  const partInfo = d.partition_method
    ? `${d.partition_method}(${d.partition_key || "?"}) — ${d.partition_count ?? "?"} partitions`
    : null;

  return (
    <div>
      {/* General Info */}
      <div style={{ marginBottom: 20 }}>
        <SectionLabel>General</SectionLabel>
        <div style={{ display: "grid", gridTemplateColumns: "90px 1fr", gap: "10px 10px", marginTop: 8, fontSize: 12 }}>
          {d.table_type && <MetaItem label="Type" value={d.table_type} />}
          {d.engine && <MetaItem label="Engine" value={d.engine} />}
          {d.key_type && <MetaItem label="Key Type" value={d.key_type} />}
          {d.comment && <MetaItem label="Comment" value={d.comment} />}
        </div>
      </div>

      {/* Statistics */}
      <div style={{ marginBottom: 20 }}>
        <SectionLabel>Statistics</SectionLabel>
        <div style={{ display: "grid", gridTemplateColumns: "90px 1fr", gap: "10px 10px", marginTop: 8, fontSize: 12 }}>
          {d.row_count != null && <MetaItem label="Row Count" value={d.row_count.toLocaleString()} />}
          {d.data_size != null && <MetaItem label="Data Size" value={formatBytes(d.data_size)} />}
          {d.create_time && <MetaItem label="Created" value={d.create_time} />}
          {d.update_time && <MetaItem label="Last Updated" value={d.update_time} />}
        </div>
      </div>

      {/* Storage (StarRocks internal only) */}
      {(distInfo || partInfo || d.replication_num != null || d.compression) && (
        <div style={{ marginBottom: 20 }}>
          <SectionLabel>Storage</SectionLabel>
          <div style={{ display: "grid", gridTemplateColumns: "90px 1fr", gap: "10px 10px", marginTop: 8, fontSize: 12 }}>
            {distInfo && <MetaItem label="Distribution" value={distInfo} />}
            {partInfo && <MetaItem label="Partition" value={partInfo} />}
            {d.replication_num != null && <MetaItem label="Replicas" value={String(d.replication_num)} />}
            {d.storage_medium && <MetaItem label="Medium" value={d.storage_medium} />}
            {d.compression && <MetaItem label="Compression" value={d.compression} />}
          </div>
        </div>
      )}

      {/* Columns */}
      <div style={{ marginBottom: 20 }}>
        <SectionLabel>Columns ({d.columns.length})</SectionLabel>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, marginTop: 8 }}>
          <thead>
            <tr><TH>Name</TH><TH>Type</TH><TH>Key</TH><TH>Nullable</TH><TH>Default</TH></tr>
          </thead>
          <tbody>
            {d.columns.map((col) => (
              <tr key={col.name} style={{ borderBottom: `1px solid ${C.border}22` }}>
                <TD><span style={{ color: C.text1, fontWeight: 500 }}>{col.name}</span></TD>
                <TD><span style={{ color: C.text1 }}>{col.column_type}</span></TD>
                <TD><span style={{ color: col.column_key ? C.accent : C.text3, fontWeight: 700 }}>{col.column_key || "-"}</span></TD>
                <TD><span style={{ color: col.is_nullable === "YES" ? C.text1 : "#f59e0b" }}>{col.is_nullable}</span></TD>
                <TD><span style={{ color: C.text2 }}>{col.column_default ?? "-"}</span></TD>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* DDL */}
      {d.ddl && (
        <div>
          <SectionLabel>DDL</SectionLabel>
          <pre style={{ marginTop: 8, padding: 12, background: C.bg, borderRadius: 6, border: `1px solid ${C.border}`, fontSize: 11, color: C.text2, whiteSpace: "pre-wrap", wordBreak: "break-all", maxHeight: 240, overflowY: "auto", lineHeight: 1.5 }}>
            {d.ddl}
          </pre>
        </div>
      )}
    </div>
  );
}

/* ── Function Details ── */
function FunctionDetailsPane({ item, myData }: { item: SelectedItem; myData: MyPermissionsResponse | null }) {
  const fn = useMemo(() => {
    if (!myData) return null;
    return myData.accessible_objects.find((o) => o.name === item.name && o.type === "FUNCTION" && o.database === item.database) || null;
  }, [myData, item.name, item.database]);

  if (!fn) return <div style={{ padding: 16, color: C.text3, fontSize: 12 }}>No detail available</div>;

  return (
    <div>
      <SectionLabel>Function Info</SectionLabel>
      <div style={{ display: "grid", gridTemplateColumns: "90px 1fr", gap: "10px 10px", fontSize: 12, marginTop: 8 }}>
        <MetaItem label="Name" value={fn.name} />
        <MetaItem label="Database" value={fn.database} />
        {fn.signature && <MetaItem label="Signature" value={fn.signature} />}
        {fn.return_type && <MetaItem label="Return Type" value={fn.return_type} />}
        {fn.function_type && <MetaItem label="Function Type" value={fn.function_type} />}
        {fn.properties && <MetaItem label="Properties" value={fn.properties} />}
      </div>
    </div>
  );
}

/* ── Database Objects ── */
function DatabaseObjectsPane({ catalog, database }: { catalog: string; database: string }) {
  const [state, setState] = useState<{ objects: ObjectItem[]; loading: boolean }>({ objects: [], loading: true });

  useEffect(() => {
    const ac = new AbortController();
    getTables(catalog, database)
      .then((objects) => setState({ objects, loading: false }))
      .catch(() => setState({ objects: [], loading: false }));
    return () => { ac.abort(); };
  }, [catalog, database]);

  if (state.loading) return <Loader />;
  if (state.objects.length === 0) return <div style={{ padding: 16, color: C.text3, fontSize: 12, textAlign: "center" }}>No objects found</div>;

  return (
    <div>
      <SectionLabel>Objects ({state.objects.length})</SectionLabel>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11, marginTop: 8 }}>
        <thead>
          <tr><TH>Name</TH><TH>Type</TH></tr>
        </thead>
        <tbody>
          {state.objects.map((obj) => (
            <tr key={obj.name} style={{ borderBottom: `1px solid ${C.border}22` }}>
              <TD><span style={{ fontWeight: 500, color: C.text1 }}>{obj.name}</span></TD>
              <TD><span style={{ color: C.text2, fontSize: 10 }}>{obj.object_type}</span></TD>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ── Catalog Databases ── */
function CatalogDatabasesPane({ catalog }: { catalog: string }) {
  const [state, setState] = useState<{ dbs: { name: string }[]; loading: boolean }>({ dbs: [], loading: true });

  useEffect(() => {
    getDatabases(catalog)
      .then((dbs) => setState({ dbs: dbs.map((d) => ({ name: d.name })), loading: false }))
      .catch(() => setState({ dbs: [], loading: false }));
  }, [catalog]);

  if (state.loading) return <Loader />;
  if (state.dbs.length === 0) return <div style={{ padding: 16, color: C.text3, fontSize: 12, textAlign: "center" }}>No databases found</div>;

  return (
    <div>
      <SectionLabel>Databases ({state.dbs.length})</SectionLabel>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11, marginTop: 8 }}>
        <thead><tr><TH>Database</TH></tr></thead>
        <tbody>
          {state.dbs.map((db) => (
            <tr key={db.name} style={{ borderBottom: `1px solid ${C.border}22` }}>
              <TD><div style={{ display: "flex", alignItems: "center", gap: 6 }}><InlineIcon type="database" size={14} /><span style={{ fontWeight: 500, color: C.text1 }}>{db.name}</span></div></TD>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ── Role Members ── */
function RoleMembersPane({ roleName, myData }: { roleName: string; myData: MyPermissionsResponse | null }) {
  const derived = useMemo(() => {
    if (!myData) return null;
    const childRoles: string[] = [];
    for (const [rName, rInfo] of Object.entries(myData.role_tree)) {
      if (rName !== roleName && rInfo.parent_roles.includes(roleName)) {
        childRoles.push(rName);
      }
    }
    const allRolesInChain = new Set([roleName, ...childRoles]);
    const users: string[] = [];
    if (myData.direct_roles.some((r) => allRolesInChain.has(r))) {
      users.push(myData.username);
    }
    return { childRoles, users };
  }, [roleName, myData]);

  const [apiState, setApiState] = useState<{ childRoles: string[]; users: string[]; loading: boolean }>({ childRoles: [], users: [], loading: true });

  useEffect(() => {
    import("../../api/admin").then(({ getInheritanceDag }) =>
      getInheritanceDag(roleName, "role")
        .then((dag) => {
          const childRoleIds = new Set(
            dag.edges.filter((e) => e.source === `r_${roleName}` && e.edge_type === "inheritance").map((e) => e.target)
          );
          const children = dag.nodes.filter((n) => childRoleIds.has(n.id)).map((n) => n.label);
          const roleIds = new Set([`r_${roleName}`, ...childRoleIds]);
          const users = dag.nodes
            .filter((n) => n.type === "user" && dag.edges.some((e) => roleIds.has(e.source) && e.target === n.id))
            .map((n) => n.label);
          setApiState({ childRoles: children, users, loading: false });
        })
        .catch(() => setApiState({ childRoles: [], users: [], loading: false }))
    );
  }, [roleName]);

  const { childRoles, users } = apiState.loading
    ? (derived || { childRoles: [], users: [] })
    : (apiState.childRoles.length + apiState.users.length >= (derived?.childRoles.length ?? 0) + (derived?.users.length ?? 0))
      ? apiState
      : (derived || apiState);

  if (childRoles.length === 0 && users.length === 0 && apiState.loading) return <Loader />;
  if (childRoles.length === 0 && users.length === 0) return <div style={{ padding: 16, color: C.text3, fontSize: 12, textAlign: "center" }}>No members found</div>;

  return (
    <div>
      {childRoles.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <SectionLabel>Child Roles ({childRoles.length})</SectionLabel>
          {childRoles.map((r) => (
            <div key={r} style={{ display: "flex", alignItems: "center", gap: 6, padding: "5px 0", borderBottom: `1px solid ${C.border}15`, fontSize: 12 }}>
              <InlineIcon type="role" size={14} />
              <span style={{ color: C.text1, fontWeight: 500 }}>{r}</span>
            </div>
          ))}
        </div>
      )}
      {users.length > 0 && (
        <div>
          <SectionLabel>Assigned Users ({users.length})</SectionLabel>
          {users.map((u) => (
            <div key={u} style={{ display: "flex", alignItems: "center", gap: 6, padding: "5px 0", borderBottom: `1px solid ${C.border}15`, fontSize: 12 }}>
              <InlineIcon type="user" size={14} />
              <span style={{ color: C.text1, fontWeight: 500 }}>{u}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ── Role Privileges ── */
function RolePrivilegesPane({ roleName }: { roleName: string }) {
  const [state, setState] = useState<{ grants: PrivilegeGrant[]; loading: boolean }>({ grants: [], loading: true });

  useEffect(() => {
    const ac = new AbortController();
    getRolePrivileges(roleName, ac.signal)
      .then((grants) => setState({ grants, loading: false }))
      .catch(() => setState({ grants: [], loading: false }));
    return () => { ac.abort(); };
  }, [roleName]);

  if (state.loading) return <Loader />;

  const groups = buildGrantDisplay(state.grants);
  const sourceRoles = extractSourceRoles(state.grants);

  return <GrantTreeView groups={groups} title="Role Privileges" totalGrants={state.grants.length} sourceRoles={sourceRoles} />;
}

/* ── User Privileges ── */
function UserPrivilegesPane({ userName }: { userName: string }) {
  const [state, setState] = useState<{ grants: PrivilegeGrant[]; loading: boolean }>({ grants: [], loading: true });

  useEffect(() => {
    getUserEffectivePrivileges(userName)
      .then((grants) => setState({ grants, loading: false }))
      .catch(() => setState({ grants: [], loading: false }));
  }, [userName]);

  if (state.loading) return <Loader />;

  const groups = buildGrantDisplay(state.grants);
  const sourceRoles = extractSourceRoles(state.grants);

  return <GrantTreeView groups={groups} title="Effective Privileges" totalGrants={state.grants.length} sourceRoles={sourceRoles} />;
}

/* ── User Roles ── */
function UserRolesPane({ userName }: { userName: string }) {
  const [state, setState] = useState<{ grants: PrivilegeGrant[]; loading: boolean }>({ grants: [], loading: true });

  useEffect(() => {
    getUserEffectivePrivileges(userName)
      .then((grants) => setState({ grants, loading: false }))
      .catch(() => setState({ grants: [], loading: false }));
  }, [userName]);

  if (state.loading) return <Loader />;

  const roles = [...new Set(state.grants.filter((g) => g.source !== "direct").map((g) => g.source))];

  return (
    <div>
      <SectionLabel>Assigned Roles ({roles.length})</SectionLabel>
      {roles.length === 0 ? (
        <div style={{ padding: 16, color: C.text3, fontSize: 12, textAlign: "center" }}>No roles assigned</div>
      ) : (
        roles.map((r) => (
          <div key={r} style={{ display: "flex", alignItems: "center", gap: 6, padding: "5px 0", borderBottom: `1px solid ${C.border}15`, fontSize: 12 }}>
            <InlineIcon type="role" size={14} />
            <span style={{ color: C.text1, fontWeight: 500 }}>{r}</span>
          </div>
        ))
      )}
    </div>
  );
}

/* ── System Object Privileges ── */
function SysObjectPrivilegesPane({ item }: { item: SelectedItem }) {
  const objType = OBJECT_TYPE_MAP[item.tab] || item.tab.toUpperCase();
  // System objects (RESOURCE GROUP, WAREHOUSE, STORAGE VOLUME, etc.) are not scoped to catalog/database
  const NON_SCOPED = new Set(["RESOURCE GROUP", "WAREHOUSE", "STORAGE VOLUME", "RESOURCE", "GLOBAL FUNCTION"]);
  const noScope = NON_SCOPED.has(objType);
  return <ObjectPrivilegesPane catalog={noScope ? "" : (item.catalog || "")} database={noScope ? "" : (item.database || "")} name={item.name} objectType={objType} />;
}

/* ── System Object Info ── */
function SysObjectInfoPane({ item, myData }: { item: SelectedItem; myData: MyPermissionsResponse | null }) {
  const obj = useMemo(() => {
    if (!myData) return null;
    return myData.system_objects?.find((o) => o.name === item.name && o.type === (OBJECT_TYPE_MAP[item.tab] || "").replace(" ", "_")) || null;
  }, [myData, item.name, item.tab]);

  if (!obj) return <div style={{ padding: 16, color: C.text3, fontSize: 12 }}>No detail available</div>;

  const fields: [string, string][] = [["Name", obj.name], ["Type", obj.type]];

  switch (obj.type) {
    case "RESOURCE_GROUP":
      if (obj.cpu_weight) fields.push(["CPU Weight", obj.cpu_weight]);
      if (obj.mem_limit) fields.push(["Memory Limit", obj.mem_limit]);
      if (obj.concurrency_limit) fields.push(["Concurrency Limit", obj.concurrency_limit]);
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

  return (
    <div>
      <SectionLabel>Details</SectionLabel>
      <div style={{ display: "grid", gridTemplateColumns: "90px 1fr", gap: "10px 10px", fontSize: 12, marginTop: 8 }}>
        {fields.map(([label, value]) => (
          <MetaItem key={label} label={label} value={value} />
        ))}
      </div>
    </div>
  );
}
