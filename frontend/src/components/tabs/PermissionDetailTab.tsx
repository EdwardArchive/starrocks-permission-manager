import { useEffect, useState, useCallback } from "react";
import { ReactFlowProvider } from "@xyflow/react";
import { getInheritanceDag } from "../../api/dag";
import { getUserEffectivePrivileges, getRolePrivileges } from "../../api/privileges";
import { searchUsersRoles } from "../../api/search";
import InlineIcon from "../common/InlineIcon";
import { getPrivColor } from "../../utils/privColors";
import { SCOPE_ORDER, SCOPE_ICONS } from "../../utils/scopeConfig";
import DAGView from "../dag/DAGView";
import ExportPngBtn from "../common/ExportPngBtn";
import type { DAGGraph, PrivilegeGrant } from "../../types";

interface SelectedEntity {
  name: string;
  type: "user" | "role";
}

export default function PermissionDetailTab() {
  const [selected, setSelected] = useState<SelectedEntity | null>(null);
  const [searchText, setSearchText] = useState("");
  const [searchResults, setSearchResults] = useState<{ name: string; type: string }[]>([]);
  const [searching, setSearching] = useState(false);
  const [dagData, setDagData] = useState<DAGGraph | null>(null);
  const [dagLoading, setDagLoading] = useState(false);
  const [grants, setGrants] = useState<PrivilegeGrant[]>([]);
  const [grantsLoading, setGrantsLoading] = useState(false);
  const [filterText, setFilterText] = useState("");

  // Debounced search
  useEffect(() => {
    const trimmed = searchText.trim();
    if (trimmed.length < 2) {
      setSearchResults([]);
      return;
    }
    setSearching(true);
    const timer = setTimeout(() => {
      searchUsersRoles(trimmed)
        .then((results) => {
          setSearchResults(results);
        })
        .catch(() => setSearchResults([]))
        .finally(() => setSearching(false));
    }, 300);
    return () => clearTimeout(timer);
  }, [searchText]);

  // Load DAG + grants when entity selected
  useEffect(() => {
    if (!selected) return;
    const controller = new AbortController();
    setDagLoading(true);
    setGrantsLoading(true);
    setDagData(null);
    setGrants([]);

    getInheritanceDag(selected.name, selected.type, controller.signal)
      .then(setDagData)
      .catch(() => {})
      .finally(() => setDagLoading(false));

    const grantFetcher = selected.type === "user"
      ? getUserEffectivePrivileges(selected.name, controller.signal)
      : getRolePrivileges(selected.name, controller.signal);
    grantFetcher
      .then(setGrants)
      .catch(() => {})
      .finally(() => setGrantsLoading(false));

    return () => controller.abort();
  }, [selected]);

  const handleSelect = useCallback((name: string, type: "user" | "role") => {
    setSelected({ name, type });
    setSearchText("");
    setSearchResults([]);
    setFilterText("");
  }, []);

  // Group grants by scope
  const grouped = groupGrantsByScope(grants, filterText);

  return (
    <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
      {/* Left sidebar: search + privilege list */}
      <div style={{ width: 320, flexShrink: 0, borderRight: "1px solid #475569", display: "flex", flexDirection: "column", overflow: "hidden", background: "#1e293b" }}>
        {/* Search */}
        <div style={{ padding: 12, borderBottom: "1px solid #475569" }}>
          <div style={{ position: "relative" }}>
            <input
              type="text"
              placeholder="Search user or role..."
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              style={{
                width: "100%", padding: "8px 30px 8px 10px", fontSize: 13,
                background: "#0f172a", border: "1px solid #475569", borderRadius: 6,
                color: "#e2e8f0", outline: "none", fontFamily: "inherit", boxSizing: "border-box",
              }}
            />
            {searchText && (
              <button
                onClick={() => { setSearchText(""); setSearchResults([]); }}
                style={{ position: "absolute", right: 6, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", color: "#94a3b8", cursor: "pointer", fontSize: 16 }}
              >
                &times;
              </button>
            )}
          </div>
          {searching && <p style={{ fontSize: 11, color: "#64748b", marginTop: 4 }}>Searching...</p>}
        </div>

        {/* Search results dropdown */}
        {searchResults.length > 0 && (
          <div style={{ maxHeight: 200, overflowY: "auto", borderBottom: "1px solid #475569" }}>
            {searchResults.map((r, i) => (
              <button
                key={`${r.type}-${r.name}-${i}`}
                onClick={() => handleSelect(r.name, r.type as "user" | "role")}
                style={{
                  display: "flex", alignItems: "center", gap: 8, width: "100%",
                  padding: "8px 12px", border: "none", background: "none",
                  color: "#e2e8f0", cursor: "pointer", fontSize: 12, fontFamily: "inherit",
                  textAlign: "left", borderBottom: "1px solid rgba(71,85,105,0.2)",
                }}
                onMouseEnter={(e) => e.currentTarget.style.background = "#334155"}
                onMouseLeave={(e) => e.currentTarget.style.background = "none"}
              >
                <InlineIcon type={r.type} size={14} />
                <span>{r.name}</span>
                <span style={{ fontSize: 10, color: "#64748b", marginLeft: "auto" }}>{r.type.toUpperCase()}</span>
              </button>
            ))}
          </div>
        )}

        {/* Selected entity header */}
        {selected && (
          <div style={{ padding: "12px 12px 8px", borderBottom: "1px solid #475569" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
              <InlineIcon type={selected.type} size={18} />
              <span style={{ fontSize: 14, fontWeight: 600, color: "#e2e8f0" }}>
                <FormattedName name={selected.name} />
              </span>
              <span style={{
                fontSize: 10, padding: "2px 6px", borderRadius: 4, fontWeight: 600,
                background: selected.type === "user" ? "rgba(14,165,233,0.18)" : "rgba(249,115,22,0.18)",
                color: selected.type === "user" ? "#38bdf8" : "#fb923c",
              }}>
                {selected.type.toUpperCase()}
              </span>
            </div>
            {/* Filter within grants */}
            <input
              type="text"
              placeholder="Filter privileges..."
              value={filterText}
              onChange={(e) => setFilterText(e.target.value)}
              style={{
                width: "100%", padding: "6px 8px", fontSize: 12, marginTop: 6,
                background: "#0f172a", border: "1px solid #334155", borderRadius: 4,
                color: "#e2e8f0", outline: "none", fontFamily: "inherit", boxSizing: "border-box",
              }}
            />
          </div>
        )}

        {/* Privilege list */}
        <div style={{ flex: 1, overflowY: "auto", padding: "8px 0" }}>
          {!selected ? (
            <p style={{ padding: 16, fontSize: 13, color: "#64748b", textAlign: "center" }}>
              Search and select a user or role to view permissions
            </p>
          ) : grantsLoading ? (
            <p style={{ padding: 16, fontSize: 13, color: "#94a3b8", fontStyle: "italic", textAlign: "center" }}>Loading privileges...</p>
          ) : grouped.length === 0 ? (
            <p style={{ padding: 16, fontSize: 13, color: "#64748b", textAlign: "center" }}>
              {filterText ? "No matching privileges" : "No grants found"}
            </p>
          ) : (
            grouped.map(({ scope, items }) => (
              <div key={scope} style={{ marginBottom: 10, padding: "0 12px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4, fontSize: 12, fontWeight: 600, color: "#94a3b8", whiteSpace: "nowrap" }}>
                  <InlineIcon type={SCOPE_ICONS[scope] || "system"} size={14} />
                  {scope}
                  <span style={{ fontSize: 10, color: "#64748b" }}>({items.length})</span>
                </div>
                {items.map((obj, idx) => (
                  <div key={`${obj.path}-${idx}`} style={{ padding: "6px 0 6px 20px", borderBottom: "1px solid rgba(71,85,105,0.15)", fontSize: 12 }}>
                    <div style={{ fontWeight: 500, color: "#e2e8f0", marginBottom: 3, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {obj.displayName}
                    </div>
                    {obj.context && (
                      <div style={{ fontSize: 10, color: "#64748b", marginBottom: 3 }}>{obj.context}</div>
                    )}
                    <div style={{ display: "flex", gap: 3, flexWrap: "wrap" }}>
                      {obj.privs.map((p) => {
                        const c = getPrivColor(p);
                        return (
                          <span key={p} style={{ padding: "2px 6px", borderRadius: 4, fontSize: 10, fontWeight: 600, background: c.bg, color: c.fg, whiteSpace: "nowrap", lineHeight: 1.4 }}>
                            {p}
                          </span>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            ))
          )}
        </div>
      </div>

      {/* Right: DAG view */}
      <div style={{ flex: 1, position: "relative", background: "#0f172a" }}>
        {!selected ? (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", color: "#475569", fontSize: 14 }}>
            Select a user or role to view inheritance DAG
          </div>
        ) : dagLoading ? (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", color: "#94a3b8", fontSize: 14 }}>
            Loading inheritance graph...
          </div>
        ) : (
          <>
            <div style={{ position: "absolute", top: 12, right: 12, zIndex: 10 }}>
              <ExportPngBtn />
            </div>
            <ReactFlowProvider>
              <DAGView data={dagData} direction="TB" loading={false} />
            </ReactFlowProvider>
          </>
        )}
      </div>
    </div>
  );
}

/* ── Helpers ── */

function FormattedName({ name }: { name: string }) {
  const match = name.match(/^'?([^'@]+)'?@'?([^']*)'?$/);
  if (match) {
    const [, uname, host] = match;
    const hostLabel = !host || host === "%" ? "ALL CIDR" : host.includes("/") ? host : host + "/32";
    return (
      <>
        {uname} <span style={{ fontSize: 10, color: "#64748b", fontWeight: 400 }}>({hostLabel})</span>
      </>
    );
  }
  return <>{name}</>;
}

interface GroupedScope {
  scope: string;
  items: { path: string; displayName: string; context: string; privs: string[] }[];
}

function groupGrantsByScope(grants: PrivilegeGrant[], filter: string): GroupedScope[] {
  const filterLower = filter.toLowerCase();
  const groups: Record<string, GroupedScope["items"]> = {};

  for (const g of grants) {
    const scope = g.object_type?.toUpperCase() || "SYSTEM";
    const path = [g.object_catalog, g.object_database, g.object_name].filter(Boolean).join(".");
    const displayName = g.object_name || g.object_database || scope;
    const context = g.object_name && g.object_database
      ? `${g.object_catalog || ""}.${g.object_database}`
      : g.object_catalog || "";

    // Apply filter
    if (filterLower) {
      const searchable = `${displayName} ${context} ${g.privilege_type} ${scope}`.toLowerCase();
      if (!searchable.includes(filterLower)) continue;
    }

    const key = path || scope;
    (groups[scope] ??= []);
    const existing = groups[scope].find((x) => x.path === key);
    if (existing) {
      if (!existing.privs.includes(g.privilege_type)) existing.privs.push(g.privilege_type);
    } else {
      groups[scope].push({ path: key, displayName, context, privs: [g.privilege_type] });
    }
  }

  const sorted = SCOPE_ORDER.filter((s) => groups[s]?.length);
  Object.keys(groups).forEach((s) => { if (!sorted.includes(s)) sorted.push(s); });

  return sorted.map((scope) => ({ scope, items: groups[scope] }));
}
