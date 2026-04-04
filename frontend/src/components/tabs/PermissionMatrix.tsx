import { useEffect, useState } from "react";
import { getObjectPrivileges } from "../../api/privileges";
import type { PrivilegeGrant } from "../../types";
import InlineIcon from "../common/InlineIcon";
import { C, PRIV_BY_TYPE, PRIV_KEY_MAP, matrixTh } from "../../utils/inventory-helpers";
import { Loader } from "./inventory-ui";

/* ── GranteeName ── */
export function GranteeName({ name, grants }: { name: string; grants: PrivilegeGrant[] }) {
  const isRole = grants[0]?.grantee_type === "ROLE";
  const m = name.match(/^'?([^'@]+)'?@'?([^']*)'?$/);
  if (m) {
    const uname = m[1];
    const host = !m[2] || m[2] === "%" ? "ALL CIDR" : m[2].includes("/") ? m[2] : m[2] + "/32";
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <InlineIcon type="user" size={16} />
        <div style={{ lineHeight: 1.3 }}>
          <div style={{ fontWeight: 600, color: C.text1, fontSize: 12 }}>{uname}</div>
          <div style={{ fontSize: 9, color: C.text3 }}>({host})</div>
        </div>
      </div>
    );
  }
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <InlineIcon type={isRole ? "role" : "user"} size={16} />
      <span style={{ fontWeight: 500, color: C.text1, fontSize: 12 }}>{name}</span>
    </div>
  );
}

/* ── PermissionMatrixView — pure render, no API calls ── */
export function PermissionMatrixView({ grants, objectType, filterGrantees }: {
  grants: PrivilegeGrant[];
  objectType: string;
  filterGrantees?: Set<string>;
}) {
  const privKey = PRIV_KEY_MAP[objectType] || "table";
  const columns = PRIV_BY_TYPE[privKey] || [];

  /* Group grants by grantee */
  const granteeMap: Record<string, PrivilegeGrant[]> = {};
  for (const g of grants) {
    (granteeMap[g.grantee] ??= []).push(g);
  }

  // Detect privileges inherited from 'public' role
  const publicPrivs = new Set(
    (granteeMap["public"] || []).map((g) => g.privilege_type.toUpperCase())
  );

  // Filter out grantees who ONLY have public-inherited privileges
  let filteredGrantees2 = Object.keys(granteeMap).filter((grantee) => {
    if (grantee === "public") return false;
    const gg = granteeMap[grantee];
    return gg.some((g) => !publicPrivs.has(g.privilege_type.toUpperCase()));
  });

  // Apply DAG scope filter if provided
  if (filterGrantees) {
    filteredGrantees2 = filteredGrantees2.filter((g) => filterGrantees.has(g));
  }

  if (filteredGrantees2.length === 0 && publicPrivs.size === 0) {
    return <div style={{ padding: 16, color: C.text3, fontSize: 12, textAlign: "center" }}>No privilege grants found</div>;
  }

  const renderRow = (label: string, privSet: Set<string>, hasAll: boolean, isDirect: boolean, style?: React.CSSProperties) => (
    <tr key={label} style={{ borderBottom: `1px solid ${C.border}22` }}>
      <td style={{ padding: "6px 8px", fontWeight: 500, color: C.text1, whiteSpace: "nowrap", ...style }}>{label}</td>
      {columns.map((col) => {
        const has = hasAll || privSet.has(col.toUpperCase());
        if (!has) return <td key={col} style={{ textAlign: "center", padding: "6px 4px" }}><span style={{ color: C.text3 }}>-</span></td>;
        const badge = isDirect ? "D" : "I";
        const bg = isDirect ? "rgba(34,197,94,0.2)" : "rgba(59,130,246,0.2)";
        const fg = isDirect ? "#4ade80" : "#60a5fa";
        return (
          <td key={col} style={{ textAlign: "center", padding: "6px 4px" }}>
            <span style={{ display: "inline-block", width: 22, height: 18, lineHeight: "18px", borderRadius: 3, fontSize: 10, fontWeight: 700, background: bg, color: fg }}>{badge}</span>
          </td>
        );
      })}
    </tr>
  );

  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
        <thead>
          <tr>
            <th style={matrixTh}>Grantee</th>
            {columns.map((c) => <th key={c} style={{ ...matrixTh, textAlign: "center", minWidth: 44 }}>{c.startsWith("CREATE") ? "CREATE" : c}</th>)}
          </tr>
        </thead>
        <tbody>
          {publicPrivs.size > 0 && (
            <>
              {renderRow("All Roles", publicPrivs, false, false, { color: "#f59e0b", fontStyle: "italic" })}
              {renderRow("All Users", publicPrivs, false, false, { color: "#38bdf8", fontStyle: "italic" })}
            </>
          )}
          {filteredGrantees2.map((grantee) => {
            const gg = granteeMap[grantee];
            const privSet = new Set(gg.map((g) => g.privilege_type.toUpperCase()));
            const hasAll = privSet.has("ALL") || privSet.has("ALL PRIVILEGES");
            return (
              <tr key={grantee} style={{ borderBottom: `1px solid ${C.border}22` }}>
                <td style={{ padding: "6px 8px" }}><GranteeName name={grantee} grants={gg} /></td>
                {columns.map((col) => {
                  const has = hasAll || privSet.has(col.toUpperCase());
                  if (!has) return <td key={col} style={{ textAlign: "center", padding: "6px 4px" }}><span style={{ color: C.text3 }}>-</span></td>;
                  const grant = gg.find((g) => g.privilege_type.toUpperCase() === col.toUpperCase());
                  const isD = grant ? grant.source === "direct" : hasAll;
                  const badge = isD ? "D" : "I";
                  const bg = isD ? "rgba(34,197,94,0.2)" : "rgba(59,130,246,0.2)";
                  const fg = isD ? "#4ade80" : "#60a5fa";
                  return (
                    <td key={col} style={{ textAlign: "center", padding: "6px 4px" }}>
                      <span style={{ display: "inline-block", width: 22, height: 18, lineHeight: "18px", borderRadius: 3, fontSize: 10, fontWeight: 700, background: bg, color: fg }}>{badge}</span>
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/* ── ObjectPrivilegesPane (fetches + renders) ── */
export function ObjectPrivilegesPane({ catalog, database, name, objectType }: {
  catalog: string; database: string; name: string; objectType: string;
}) {
  const [state, setState] = useState<{ grants: PrivilegeGrant[]; loading: boolean }>({ grants: [], loading: true });

  useEffect(() => {
    const ac = new AbortController();
    const catArg = objectType === "CATALOG" ? name : catalog;
    const dbArg = objectType === "DATABASE" ? name : (objectType === "CATALOG" ? undefined : database);
    const objName = (objectType === "DATABASE" || objectType === "CATALOG") ? undefined : (name || undefined);
    getObjectPrivileges(catArg, dbArg, objName, objectType)
      .then((grants) => setState({ grants, loading: false }))
      .catch(() => setState({ grants: [], loading: false }));
    return () => { ac.abort(); };
  }, [catalog, database, name, objectType]);

  if (state.loading) return <Loader />;

  return <PermissionMatrixView grants={state.grants} objectType={objectType} />;
}
