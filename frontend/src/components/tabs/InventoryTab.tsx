import { useEffect, useMemo, useState, useCallback } from "react";
import {
  getMyPermissions,
  type MyPermissionsResponse,
} from "../../api/privileges";
import { useAuthStore } from "../../stores/authStore";
import { getRoles } from "../../api/dag";
import {
  C, SUB_TAB_META, OBJECT_TYPE_MAP, formatBytes,
  type SubTab, type AllTab, type RoleRow, type SelectedItem,
} from "../../utils/inventory-helpers";
import { SearchInput, Chip, Badge, SortTH, TH, TD } from "./inventory-ui";
import DetailPanel from "./InventoryDetailPanel";

/* ── Component ── */
export default function InventoryTab() {
  const isAdmin = useAuthStore((s) => s.user?.is_user_admin ?? false);
  const [state, setState] = useState<{ data: MyPermissionsResponse | null; loading: boolean; error: boolean }>({
    data: null, loading: true, error: false,
  });
  // Admin: full role + user lists from separate APIs
  const [allRoles, setAllRoles] = useState<{ name: string; is_builtin: boolean }[]>([]);
  const [allUsers, setAllUsers] = useState<string[]>([]);

  // Pagination
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(25);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  const [subTab, setSubTab] = useState<AllTab>("roles");
  const [filter, setFilter] = useState("");
  const [selected, setSelected] = useState<SelectedItem | null>(null);

  /* Load data on mount */
  useEffect(() => {
    const ac = new AbortController();
    getMyPermissions(ac.signal)
      .then((data) => setState({ data, loading: false, error: false }))
      .catch((e) => {
        if (e instanceof DOMException && e.name === "AbortError") return;
        setState({ data: null, loading: false, error: true });
      });
    return () => { ac.abort(); };
  }, []);

  /* Admin: load all roles + users */
  useEffect(() => {
    if (!isAdmin) return;
    getRoles().then(setAllRoles).catch(() => {});
    import("../../api/dag").then(({ getRoleHierarchy }) =>
      getRoleHierarchy().then((dag) => {
        const users = dag.nodes.filter((n) => n.type === "user").map((n) => n.label);
        setAllUsers(users);
      }).catch(() => {})
    );
  }, [isAdmin]);

  const { data, loading, error } = state;

  /* Derive lists */
  const tables = useMemo(() => data?.accessible_objects.filter((o) => o.type === "BASE TABLE") ?? [], [data]);
  const views = useMemo(() => data?.accessible_objects.filter((o) => o.type === "VIEW") ?? [], [data]);
  const mvs = useMemo(() => data?.accessible_objects.filter((o) => o.type === "MATERIALIZED VIEW") ?? [], [data]);
  const funcs = useMemo(() => data?.accessible_objects.filter((o) => o.type === "FUNCTION") ?? [], [data]);
  const catalogs = useMemo(() => data?.accessible_catalogs ?? [], [data]);
  const databases = useMemo(() => data?.accessible_databases ?? [], [data]);

  const roles: RoleRow[] = useMemo(() => {
    if (isAdmin && allRoles.length > 0) {
      return allRoles.map((r) => ({ name: r.name, kind: r.is_builtin ? "builtin" : "custom", source: "-", grantsCount: 0 }));
    }
    if (!data) return [];
    const rows: RoleRow[] = [];
    const directSet = new Set(data.direct_roles);
    for (const r of data.direct_roles) {
      rows.push({ name: r, kind: "direct", source: "-", grantsCount: data.role_tree[r]?.grants.length ?? 0 });
    }
    for (const [rName, rInfo] of Object.entries(data.role_tree)) {
      if (!directSet.has(rName)) {
        const source = Object.entries(data.role_tree).find(([, v]) => v.parent_roles.includes(rName))?.[0] ?? "-";
        rows.push({ name: rName, kind: "inherited", source, grantsCount: rInfo.grants.length });
      }
    }
    return rows;
  }, [isAdmin, allRoles, data]);

  const users = useMemo(() => {
    if (isAdmin && allUsers.length > 0) return allUsers.map((u) => ({ name: u }));
    return [];
  }, [isAdmin, allUsers]);

  // System objects
  const gfunctions = useMemo(() => data?.system_objects?.filter((o) => o.type === "GLOBAL_FUNCTION") ?? [], [data]);
  const pipes = useMemo(() => data?.system_objects?.filter((o) => o.type === "PIPE") ?? [], [data]);
  const tasks = useMemo(() => data?.system_objects?.filter((o) => o.type === "TASK") ?? [], [data]);
  const warehouses = useMemo(() => data?.system_objects?.filter((o) => o.type === "WAREHOUSE") ?? [], [data]);
  const rgroups = useMemo(() => data?.system_objects?.filter((o) => o.type === "RESOURCE_GROUP") ?? [], [data]);
  const svolumes = useMemo(() => data?.system_objects?.filter((o) => o.type === "STORAGE_VOLUME") ?? [], [data]);
  const resources = useMemo(() => data?.system_objects?.filter((o) => o.type === "RESOURCE") ?? [], [data]);

  const counts: Record<SubTab, number> = useMemo(() => ({
    roles: roles.length, users: users.length, catalogs: catalogs.length, databases: databases.length,
    tables: tables.length, mvs: mvs.length, views: views.length, functions: funcs.length,
    gfunctions: gfunctions.length, pipes: pipes.length, tasks: tasks.length,
    warehouses: warehouses.length, rgroups: rgroups.length, svolumes: svolumes.length, resources: resources.length,
  }), [roles, users, catalogs, databases, tables, mvs, views, funcs, gfunctions, pipes, tasks, warehouses, rgroups, svolumes, resources]);

  /* Filtered list for current sub-tab */
  const lf = filter.toLowerCase();
  const filteredList = useMemo(() => {
    const byName = (items: { name: string }[]) => items.filter((i) => !lf || i.name.toLowerCase().includes(lf));
    const byNameDb = (items: { name: string; database: string }[]) =>
      items.filter((i) => !lf || i.name.toLowerCase().includes(lf) || i.database.toLowerCase().includes(lf));
    let list: { name: string }[];
    switch (subTab) {
      case "tables": list = byNameDb(tables); break;
      case "views": list = byNameDb(views); break;
      case "mvs": list = byNameDb(mvs); break;
      case "functions": list = byNameDb(funcs); break;
      case "catalogs": list = byName(catalogs); break;
      case "databases": list = byName(databases); break;
      case "roles": list = roles.filter((r) => !lf || r.name.toLowerCase().includes(lf)); break;
      case "users": list = users.filter((u) => !lf || u.name.toLowerCase().includes(lf)); break;
      case "gfunctions": list = byName(gfunctions as { name: string }[]); break;
      case "pipes": list = byName(pipes as { name: string }[]); break;
      case "tasks": list = byName(tasks as { name: string }[]); break;
      case "warehouses": list = byName(warehouses as { name: string }[]); break;
      case "rgroups": list = byName(rgroups as { name: string }[]); break;
      case "svolumes": list = byName(svolumes as { name: string }[]); break;
      case "resources": list = byName(resources as { name: string }[]); break;
      default: list = []; break;
    }
    const sorted = [...list].sort((a, b) => {
      const cmp = a.name.localeCompare(b.name);
      return sortDir === "asc" ? cmp : -cmp;
    });
    return sorted;
  }, [subTab, lf, sortDir, tables, views, mvs, funcs, catalogs, databases, roles, users, gfunctions, pipes, tasks, warehouses, rgroups, svolumes, resources]);

  const handleRowClick = useCallback((row: Record<string, unknown>) => {
    const objType = OBJECT_TYPE_MAP[subTab as SubTab] || "TABLE";
    setSelected({
      tab: subTab as SubTab,
      name: row.name as string,
      database: (row.database as string) || undefined,
      catalog: (row.catalog as string) || "default_catalog",
      objectType: objType,
    });
  }, [subTab]);

  if (loading || error || !data) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", color: C.text3, fontSize: 13 }}>
        {loading ? "Loading inventory..." : "Failed to load data."}
      </div>
    );
  }

  const isSystemTab = ["warehouses", "rgroups", "svolumes", "resources", "gfunctions", "pipes", "tasks"].includes(subTab);

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", background: C.bg }}>
      {/* Toolbar */}
      <div style={{ padding: "10px 16px", borderBottom: `1px solid ${C.border}`, background: C.card, display: "flex", alignItems: "center", gap: 10, flexShrink: 0, flexWrap: "wrap" }}>
        <SearchInput value={filter} onChange={(v) => { setFilter(v); setPage(0); }} />
        <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
          {SUB_TAB_META.map(({ key, label, future }) => (
            <Chip key={key} label={`${label}${future ? "" : ` (${counts[key as SubTab] ?? 0})`}`}
              active={subTab === key} muted={!!future}
              onClick={() => { setSubTab(key); setSelected(null); setPage(0); }} />
          ))}
        </div>
      </div>

      {/* Summary + Pagination bar */}
      <div style={{ padding: "6px 16px", borderBottom: `1px solid ${C.border}`, fontSize: 11, color: C.text3, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span>{`Showing ${Math.min(page * pageSize + 1, filteredList.length)}–${Math.min((page + 1) * pageSize, filteredList.length)} of ${filteredList.length}`}</span>
        {filteredList.length > 0 && (
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <select value={pageSize} onChange={(e) => { setPageSize(Number(e.target.value)); setPage(0); }}
              style={{ background: C.bg, border: `1px solid ${C.border}`, borderRadius: 4, color: C.text2, fontSize: 11, padding: "2px 4px", cursor: "pointer", fontFamily: "inherit" }}>
              {[10, 25, 50, 100].map((n) => <option key={n} value={n}>{n} / page</option>)}
            </select>
            <button onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={page === 0}
              style={{ background: "none", border: `1px solid ${C.border}`, borderRadius: 4, color: page === 0 ? C.text3 : C.text2, cursor: page === 0 ? "default" : "pointer", padding: "2px 8px", fontSize: 11, fontFamily: "inherit" }}>Prev</button>
            <span style={{ color: C.text2 }}>{page + 1} / {Math.max(1, Math.ceil(filteredList.length / pageSize))}</span>
            <button onClick={() => setPage((p) => Math.min(Math.ceil(filteredList.length / pageSize) - 1, p + 1))} disabled={(page + 1) * pageSize >= filteredList.length}
              style={{ background: "none", border: `1px solid ${C.border}`, borderRadius: 4, color: (page + 1) * pageSize >= filteredList.length ? C.text3 : C.text2, cursor: (page + 1) * pageSize >= filteredList.length ? "default" : "pointer", padding: "2px 8px", fontSize: 11, fontFamily: "inherit" }}>Next</button>
          </div>
        )}
      </div>

      {/* Main area */}
      <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
        {/* Object list */}
        <div style={{ flex: 1, overflowY: "auto" }}>
          {filteredList.length === 0 ? (
            <div style={{ padding: 48, textAlign: "center", color: C.text3, fontSize: 13 }}>No items found</div>
          ) : (
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
              <thead>
                <tr style={{ position: "sticky", top: 0, background: C.card, zIndex: 1 }}>
                  {subTab === "roles" ? (
                    <><SortTH label="Role" dir={sortDir} onToggle={() => setSortDir((d) => d === "asc" ? "desc" : "asc")} /><TH>Type</TH><TH>Source</TH><TH>Grants</TH></>
                  ) : subTab === "users" ? (
                    <><SortTH label="User" dir={sortDir} onToggle={() => setSortDir((d) => d === "asc" ? "desc" : "asc")} /><TH>Host</TH></>
                  ) : subTab === "catalogs" ? (
                    <><SortTH label="Catalog" dir={sortDir} onToggle={() => setSortDir((d) => d === "asc" ? "desc" : "asc")} /><TH>Type</TH></>
                  ) : subTab === "databases" ? (
                    <><SortTH label="Database" dir={sortDir} onToggle={() => setSortDir((d) => d === "asc" ? "desc" : "asc")} /><TH>Catalog</TH></>
                  ) : isSystemTab ? (
                    <><SortTH label="Name" dir={sortDir} onToggle={() => setSortDir((d) => d === "asc" ? "desc" : "asc")} />
                      {(subTab === "pipes" || subTab === "tasks") && <TH>Database</TH>}
                      {(subTab === "warehouses" || subTab === "pipes" || subTab === "tasks") && <TH>State</TH>}
                      {subTab === "resources" && <TH>Type</TH>}
                    </>
                  ) : (subTab === "tables" || subTab === "mvs") ? (
                    <><SortTH label="Name" dir={sortDir} onToggle={() => setSortDir((d) => d === "asc" ? "desc" : "asc")} /><TH>Catalog</TH><TH>Database</TH><TH>Rows</TH><TH>Size</TH></>
                  ) : (
                    <><SortTH label="Name" dir={sortDir} onToggle={() => setSortDir((d) => d === "asc" ? "desc" : "asc")} /><TH>Catalog</TH><TH>Database</TH></>
                  )}
                </tr>
              </thead>
              <tbody>
                {filteredList.slice(page * pageSize, (page + 1) * pageSize).map((row: Record<string, string>, i: number) => {
                  const isActive = selected?.name === row.name && selected?.database === (row.database || undefined);
                  return (
                    <tr key={`${row.name}-${row.database ?? ""}-${i}`}
                      onClick={() => handleRowClick(row)}
                      style={{ borderBottom: `1px solid ${C.border}22`, cursor: "pointer", background: isActive ? `${C.accent}12` : undefined }}
                      onMouseEnter={(e) => { if (!isActive) e.currentTarget.style.background = `${C.accent}08`; }}
                      onMouseLeave={(e) => { if (!isActive) e.currentTarget.style.background = isActive ? `${C.accent}12` : ""; }}>
                      {subTab === "roles" ? (
                        <>
                          <TD><span style={{ fontWeight: 500, color: C.text1 }}>{row.name}</span></TD>
                          <TD><Badge text={row.kind} color={row.kind === "direct" ? C.green : C.accent} /></TD>
                          <TD><span style={{ color: C.text1, fontSize: 12 }}>{row.source}</span></TD>
                          <TD><span style={{ color: C.text1, fontSize: 12 }}>{row.grantsCount}</span></TD>
                        </>
                      ) : subTab === "users" ? (
                        (() => {
                          const m = row.name.match(/^'?([^'@]+)'?@'?([^']*)'?$/);
                          const uname = m ? m[1] : row.name;
                          const rawHost = m ? (m[2] || "%") : "%";
                          const host = !rawHost || rawHost === "%" ? "ALL CIDR" : rawHost.includes("/") ? rawHost : rawHost + "/32";
                          return <>
                            <TD><span style={{ fontWeight: 500, color: C.text1 }}>{uname}</span></TD>
                            <TD><span style={{ fontSize: 11, fontFamily: "monospace", padding: "2px 6px", borderRadius: 4, background: host === "ALL CIDR" ? "rgba(14,165,233,0.12)" : "rgba(249,115,22,0.12)", color: host === "ALL CIDR" ? "#38bdf8" : "#fb923c" }}>{host}</span></TD>
                          </>;
                        })()
                      ) : subTab === "catalogs" ? (
                        <>
                          <TD><span style={{ fontWeight: 500, color: C.text1 }}>{row.name}</span></TD>
                          <TD><span style={{ color: C.text1, fontSize: 12 }}>{row.type}</span></TD>
                        </>
                      ) : subTab === "databases" ? (
                        <>
                          <TD><span style={{ fontWeight: 500, color: C.text1 }}>{row.name}</span></TD>
                          <TD><span style={{ color: C.text1, fontSize: 12 }}>{row.catalog || "default_catalog"}</span></TD>
                        </>
                      ) : isSystemTab ? (
                        <>
                          <TD><span style={{ fontWeight: 500, color: C.text1 }}>{row.name}</span></TD>
                          {(subTab === "pipes" || subTab === "tasks") && <TD><span style={{ color: C.text1, fontSize: 12 }}>{row.database || "-"}</span></TD>}
                          {(subTab === "warehouses" || subTab === "pipes" || subTab === "tasks") && <TD><span style={{ color: C.text1, fontSize: 12 }}>{row.state || "-"}</span></TD>}
                          {subTab === "resources" && <TD><span style={{ color: C.text1, fontSize: 12 }}>{row.resource_type || "-"}</span></TD>}
                        </>
                      ) : (subTab === "tables" || subTab === "mvs") ? (
                        <>
                          <TD><span style={{ fontWeight: 500, color: C.text1 }}>{row.name}</span></TD>
                          <TD><span style={{ color: C.text2, fontSize: 11 }}>{row.catalog || "default_catalog"}</span></TD>
                          <TD><span style={{ color: C.text1, fontSize: 12 }}>{row.database}</span></TD>
                          <TD><span style={{ color: C.text1, fontSize: 12 }}>{row.rows != null ? Number(row.rows).toLocaleString() : "-"}</span></TD>
                          <TD><span style={{ color: C.text1, fontSize: 12 }}>{row.size != null ? formatBytes(Number(row.size)) : "-"}</span></TD>
                        </>
                      ) : (
                        <>
                          <TD><span style={{ fontWeight: 500, color: C.text1 }}>{row.name}</span></TD>
                          <TD><span style={{ color: C.text2, fontSize: 11 }}>{row.catalog || "default_catalog"}</span></TD>
                          <TD><span style={{ color: C.text1, fontSize: 12 }}>{row.database}</span></TD>
                        </>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* Detail panel */}
        {selected && (
          <div style={{ width: 450, borderLeft: `1px solid ${C.border}`, display: "flex", flexDirection: "column", overflow: "hidden", flexShrink: 0, background: C.card }}>
            <DetailPanel key={`${selected.name}-${selected.database}`} item={selected} onClose={() => setSelected(null)} myData={data} />
          </div>
        )}
      </div>
    </div>
  );
}
