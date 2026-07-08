import { useState } from "react";
import type { MyPermissionsResponse } from "../../api/user";
import { C, type SelectedItem } from "../../utils/inventory-helpers";
import { ObjectPrivilegesPane } from "./PermissionMatrix";
import { ObjectDetailsPane, FunctionDetailsPane, DatabaseObjectsPane, CatalogDatabasesPane } from "./panes/objectPanes";
import { RoleMembersPane, RolePrivilegesPane, UserPrivilegesPane, UserRolesPane } from "./panes/entityPanes";
import { TaskPrivilegesPane, PipePrivilegesPane, SysObjectPrivilegesPane, SysObjectInfoPane } from "./panes/systemPanes";

/* ══════════════════════════════════════════════════════════════
   Detail Panel — thin tab router (dispatches kind × tab → panes).
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
              {i > 0 && <span style={{ color: C.borderLight, margin: "0 3px" }}>/</span>}
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
        {isObject && detailTab === "details" && item.tab === "functions" && <FunctionDetailsPane item={item} myData={myData} />}
        {isObject && detailTab === "details" && item.tab !== "functions" && (
          <ObjectDetailsPane catalog={item.catalog!} database={item.database!} name={item.name} />
        )}
        {isCatalog && detailTab === "privileges" && (
          <ObjectPrivilegesPane catalog={item.name} database="" name="" objectType="CATALOG" />
        )}
        {isCatalog && detailTab === "objects" && <CatalogDatabasesPane catalog={item.name} />}
        {isDatabase && detailTab === "privileges" && (
          <ObjectPrivilegesPane catalog={item.catalog!} database={item.name} name="" objectType="DATABASE" />
        )}
        {isDatabase && detailTab === "objects" && <DatabaseObjectsPane catalog={item.catalog!} database={item.name} />}
        {isRole && detailTab === "privileges" && <RolePrivilegesPane roleName={item.name} />}
        {isRole && detailTab === "members" && <RoleMembersPane roleName={item.name} myData={myData} />}
        {isUser && detailTab === "privileges" && <UserPrivilegesPane userName={item.name} />}
        {isUser && detailTab === "members" && <UserRolesPane userName={item.name} />}
        {isSysObject && detailTab === "privileges" && item.tab === "tasks" && <TaskPrivilegesPane />}
        {isSysObject && detailTab === "privileges" && item.tab === "pipes" && <PipePrivilegesPane item={item} />}
        {isSysObject && detailTab === "privileges" && item.tab !== "tasks" && item.tab !== "pipes" && <SysObjectPrivilegesPane item={item} />}
        {isSysObject && detailTab === "info" && <SysObjectInfoPane item={item} myData={myData} />}
      </div>
    </>
  );
}
