/* eslint-disable react-hooks/set-state-in-effect -- setState in effects is intentional; React 18+ auto-batches these calls */
import { useEffect, useState, useCallback } from "react";
import { ReactFlowProvider } from "@xyflow/react";
import { getInheritanceDag, getUserEffectivePrivileges, getRolePrivileges, searchUsersRoles } from "../../api/admin";
import InlineIcon from "../common/InlineIcon";
import GrantTreeView from "../common/GrantTreeView";
import { buildGrantDisplay } from "../../utils/grantDisplay";
import DAGView from "../dag/DAGView";
import ExportPngBtn from "../common/ExportPngBtn";
import { useDagStore } from "../../stores/dagStore";
import { C, ENTITY_BADGE } from "../../utils/colors";
import { useAsyncData } from "../../hooks/useAsyncData";
import type { DAGNode } from "../../types";

interface SelectedEntity {
  name: string;
  type: "user" | "role";
}

export default function PermissionDetailTab() {
  const [selected, setSelected] = useState<SelectedEntity | null>(null);
  const [searchText, setSearchText] = useState("");
  const [filterText, setFilterText] = useState("");

  // Search state
  const [search, setSearch] = useState<{ results: { name: string; type: string }[]; searching: boolean }>({
    results: [], searching: false,
  });

  // Entity data (DAG + grants for selected user/role)
  const dagRes = useAsyncData(
    () => getInheritanceDag(selected!.name, selected!.type),
    [selected],
    { enabled: !!selected },
  );
  const grantsRes = useAsyncData(
    () => (selected!.type === "user"
      ? getUserEffectivePrivileges(selected!.name)
      : getRolePrivileges(selected!.name)),
    [selected],
    { enabled: !!selected },
  );

  // Clicked DAG node detail panel
  const selectedNode = useDagStore((s) => s.selectedNode);
  const [clickedNode, setClickedNode] = useState<DAGNode | null>(null);

  // Watch for DAG node clicks
  useEffect(() => {
    if (!selectedNode || !selected) {
      setClickedNode(null);
      return;
    }
    const nodeType = selectedNode.type?.toLowerCase();
    setClickedNode(nodeType === "user" || nodeType === "role" ? selectedNode : null);
  }, [selectedNode, selected]);

  // `selected` stays in the deps: re-selecting an entity refetches the open panel (as before)
  const clickedGrants = useAsyncData(
    () => (clickedNode!.type?.toLowerCase() === "user"
      ? getUserEffectivePrivileges(clickedNode!.label)
      : getRolePrivileges(clickedNode!.label)),
    [clickedNode, selected],
    { enabled: !!clickedNode },
  );

  // Debounced search
  useEffect(() => {
    const trimmed = searchText.trim();
    if (trimmed.length < 2) {
      setSearch({ results: [], searching: false });
      return;
    }
    setSearch((prev) => ({ ...prev, searching: true }));
    const timer = setTimeout(() => {
      searchUsersRoles(trimmed)
        .then((results) => setSearch({ results, searching: false }))
        .catch(() => setSearch({ results: [], searching: false }));
    }, 300);
    return () => clearTimeout(timer);
  }, [searchText]);

  const handleSelect = useCallback((name: string, type: "user" | "role") => {
    setSelected({ name, type });
    setSearchText("");
    setSearch({ results: [], searching: false });
    setFilterText("");
  }, []);

  // Group grants by scope (shared utility)
  const grouped = buildGrantDisplay(grantsRes.data ?? [], { filter: filterText });

  return (
    <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
      {/* Left sidebar: search + privilege list */}
      <div style={{ width: 320, flexShrink: 0, borderRight: `1px solid ${C.borderLight}`, display: "flex", flexDirection: "column", overflow: "hidden", background: C.card }}>
        {/* Search */}
        <div style={{ padding: 12, borderBottom: `1px solid ${C.borderLight}` }}>
          <div style={{ position: "relative" }}>
            <input
              type="text"
              placeholder="Search user or role..."
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              style={{
                width: "100%", padding: "8px 30px 8px 10px", fontSize: 13,
                background: C.bg, border: `1px solid ${C.borderLight}`, borderRadius: 6,
                color: C.text1, outline: "none", fontFamily: "inherit", boxSizing: "border-box",
              }}
            />
            {searchText && (
              <button
                onClick={() => { setSearchText(""); setSearch({ results: [], searching: false }); }}
                style={{ position: "absolute", right: 6, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", color: C.text2, cursor: "pointer", fontSize: 16 }}
              >
                &times;
              </button>
            )}
          </div>
          {search.searching && <p style={{ fontSize: 11, color: C.text3, marginTop: 4 }}>Searching...</p>}
        </div>

        {/* Search results dropdown */}
        {search.results.length > 0 && (
          <div style={{ maxHeight: 200, overflowY: "auto", borderBottom: `1px solid ${C.borderLight}` }}>
            {search.results.map((r, i) => (
              <button
                key={`${r.type}-${r.name}-${i}`}
                onClick={() => handleSelect(r.name, r.type as "user" | "role")}
                style={{
                  display: "flex", alignItems: "center", gap: 8, width: "100%",
                  padding: "8px 12px", border: "none", background: "none",
                  color: C.text1, cursor: "pointer", fontSize: 12, fontFamily: "inherit",
                  textAlign: "left", borderBottom: "1px solid rgba(71,85,105,0.2)",
                }}
                onMouseEnter={(e) => e.currentTarget.style.background = C.border}
                onMouseLeave={(e) => e.currentTarget.style.background = "none"}
              >
                <InlineIcon type={r.type} size={14} />
                <span>{r.name}</span>
                <span style={{ fontSize: 10, color: C.text3, marginLeft: "auto" }}>{r.type.toUpperCase()}</span>
              </button>
            ))}
          </div>
        )}

        {/* Selected entity header */}
        {selected && (
          <div style={{ padding: "12px 12px 8px", borderBottom: `1px solid ${C.borderLight}` }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
              <InlineIcon type={selected.type} size={18} />
              <span style={{ fontSize: 14, fontWeight: 600, color: C.text1 }}>
                <FormattedName name={selected.name} />
              </span>
              <span style={{
                fontSize: 10, padding: "2px 6px", borderRadius: 4, fontWeight: 600,
                background: ENTITY_BADGE[selected.type].bg,
                color: ENTITY_BADGE[selected.type].fg,
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
                background: C.bg, border: `1px solid ${C.border}`, borderRadius: 4,
                color: C.text1, outline: "none", fontFamily: "inherit", boxSizing: "border-box",
              }}
            />
          </div>
        )}

        {/* Privilege list */}
        <div style={{ flex: 1, overflowY: "auto", padding: "8px 0" }}>
          {!selected ? (
            <p style={{ padding: 16, fontSize: 13, color: C.text3, textAlign: "center" }}>
              Search and select a user or role to view permissions
            </p>
          ) : grantsRes.loading ? (
            <p style={{ padding: 16, fontSize: 13, color: C.text2, fontStyle: "italic", textAlign: "center" }}>Loading privileges...</p>
          ) : (
            <div style={{ padding: "0 12px" }}>
              <GrantTreeView groups={grouped} />
            </div>
          )}
        </div>
      </div>

      {/* Center: DAG view */}
      <div style={{ flex: 1, position: "relative", background: C.bg }}>
        {!selected ? (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", color: C.borderLight, fontSize: 14 }}>
            Select a user or role to view inheritance DAG
          </div>
        ) : dagRes.loading ? (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", color: C.text2, fontSize: 14 }}>
            Loading inheritance graph...
          </div>
        ) : (
          <>
            <div style={{ position: "absolute", top: 12, right: 12, zIndex: 10 }}>
              <ExportPngBtn />
            </div>
            <ReactFlowProvider>
              <DAGView data={dagRes.data} direction="TB" loading={false} />
            </ReactFlowProvider>
          </>
        )}
      </div>

      {/* Right: Clicked node detail panel */}
      {clickedNode && (
        <div style={{ width: 320, flexShrink: 0, borderLeft: `1px solid ${C.borderLight}`, display: "flex", flexDirection: "column", overflow: "hidden", background: C.card }}>
          {/* Header */}
          <div style={{ padding: 12, borderBottom: `1px solid ${C.borderLight}`, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <InlineIcon type={clickedNode.type} size={18} />
              <span style={{ fontSize: 14, fontWeight: 600, color: C.text1 }}>
                <FormattedName name={clickedNode.label} />
              </span>
              <span style={{
                fontSize: 10, padding: "2px 6px", borderRadius: 4, fontWeight: 600,
                background: ENTITY_BADGE[clickedNode.type as "user" | "role"].bg,
                color: ENTITY_BADGE[clickedNode.type as "user" | "role"].fg,
              }}>
                {clickedNode.type.toUpperCase()}
              </span>
            </div>
            <button
              onClick={() => setClickedNode(null)}
              style={{ background: "none", border: "none", color: C.text2, cursor: "pointer", fontSize: 18, lineHeight: 1 }}
            >
              &times;
            </button>
          </div>

          {/* Grants */}
          <div style={{ flex: 1, overflowY: "auto", padding: "8px 0" }}>
            {clickedGrants.loading ? (
              <p style={{ padding: 16, fontSize: 13, color: C.text2, fontStyle: "italic", textAlign: "center" }}>Loading privileges...</p>
            ) : (
              <div style={{ padding: "0 12px" }}>
                <GrantTreeView groups={buildGrantDisplay(clickedGrants.data ?? [])} />
              </div>
            )}
          </div>
        </div>
      )}
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
        {uname} <span style={{ fontSize: 10, color: C.text3, fontWeight: 400 }}>({hostLabel})</span>
      </>
    );
  }
  return <>{name}</>;
}

