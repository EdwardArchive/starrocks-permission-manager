import { useEffect, useMemo, useState } from "react";
import { type MyPermissionsResponse, getRolePrivileges, getUserEffectivePrivileges } from "../../../api/user";
import InlineIcon from "../../common/InlineIcon";
import GrantTreeView from "../../common/GrantTreeView";
import { buildGrantDisplay, extractSourceRoles } from "../../../utils/grantDisplay";
import { C } from "../../../utils/inventory-helpers";
import { SectionLabel, Loader } from "../inventory-ui";
import { useAsyncData } from "../../../hooks/useAsyncData";

/* ── Role Members ── */
export function RoleMembersPane({ roleName, myData }: { roleName: string; myData: MyPermissionsResponse | null }) {
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
    import("../../../api/user").then(({ getInheritanceDag }) =>
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
export function RolePrivilegesPane({ roleName }: { roleName: string }) {
  const { data, loading } = useAsyncData(() => getRolePrivileges(roleName), [roleName], { keepPreviousData: true });

  if (loading && data == null) return <Loader />;

  const grants = data ?? [];
  const groups = buildGrantDisplay(grants);
  const sourceRoles = extractSourceRoles(grants);

  return <GrantTreeView groups={groups} title="Role Privileges" totalGrants={grants.length} sourceRoles={sourceRoles} />;
}

/* ── User Privileges ── */
export function UserPrivilegesPane({ userName }: { userName: string }) {
  const { data, loading } = useAsyncData(() => getUserEffectivePrivileges(userName), [userName], { keepPreviousData: true });

  if (loading && data == null) return <Loader />;

  const grants = data ?? [];
  const groups = buildGrantDisplay(grants);
  const sourceRoles = extractSourceRoles(grants);

  return <GrantTreeView groups={groups} title="Effective Privileges" totalGrants={grants.length} sourceRoles={sourceRoles} />;
}

/* ── User Roles ── */
export function UserRolesPane({ userName }: { userName: string }) {
  const { data, loading } = useAsyncData(() => getUserEffectivePrivileges(userName), [userName], { keepPreviousData: true });

  if (loading && data == null) return <Loader />;

  const roles = [...new Set((data ?? []).filter((g) => g.source !== "direct").map((g) => g.source))];

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
