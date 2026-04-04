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
import type { DAGGraph, DAGNode, PrivilegeGrant } from "../../types";

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
  const [entity, setEntity] = useState<{ dag: DAGGraph | null; dagLoading: boolean; grants: PrivilegeGrant[]; grantsLoading: boolean }>({
    dag: null, dagLoading: false, grants: [], grantsLoading: false,
  });

  // Clicked DAG node detail panel
  const { selectedNode } = useDagStore();
  const [clicked, setClicked] = useState<{ node: DAGNode | null; grants: PrivilegeGrant[]; loading: boolean }>({
    node: null, grants: [], loading: false,
  });

  // Watch for DAG node clicks
  useEffect(() => {
    if (!selectedNode || !selected) {
      setClicked({ node: null, grants: [], loading: false });
      return;
    }
    const nodeType = selectedNode.type?.toLowerCase();
    if (nodeType !== "user" && nodeType !== "role") {
      setClicked({ node: null, grants: [], loading: false });
      return;
    }
    setClicked({ node: selectedNode, grants: [], loading: true });
    const fetcher = nodeType === "user"
      ? getUserEffectivePrivileges(selectedNode.label)
      : getRolePrivileges(selectedNode.label);
    fetcher
      .then((grants) => setClicked((prev) => ({ ...prev, grants, loading: false })))
      .catch(() => setClicked((prev) => ({ ...prev, grants: [], loading: false })));
  }, [selectedNode, selected]);

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

  // Load DAG + grants when entity selected
  useEffect(() => {
    if (!selected) return;
    const controller = new AbortController();
    setEntity({ dag: null, dagLoading: true, grants: [], grantsLoading: true });

    getInheritanceDag(selected.name, selected.type, controller.signal)
      .then((dag) => setEntity((prev) => ({ ...prev, dag, dagLoading: false })))
      .catch(() => setEntity((prev) => ({ ...prev, dagLoading: false })));

    const grantFetcher = selected.type === "user"
      ? getUserEffectivePrivileges(selected.name, controller.signal)
      : getRolePrivileges(selected.name, controller.signal);
    grantFetcher
      .then((grants) => setEntity((prev) => ({ ...prev, grants, grantsLoading: false })))
      .catch(() => setEntity((prev) => ({ ...prev, grantsLoading: false })));

    return () => controller.abort();
  }, [selected]);

  const handleSelect = useCallback((name: string, type: "user" | "role") => {
    setSelected({ name, type });
    setSearchText("");
    setSearch({ results: [], searching: false });
    setFilterText("");
  }, []);

  // Group grants by scope (shared utility)
  const grouped = buildGrantDisplay(entity.grants, { filter: filterText });

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
                onClick={() => { setSearchText(""); setSearch({ results: [], searching: false }); }}
                style={{ position: "absolute", right: 6, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", color: "#94a3b8", cursor: "pointer", fontSize: 16 }}
              >
                &times;
              </button>
            )}
          </div>
          {search.searching && <p style={{ fontSize: 11, color: "#64748b", marginTop: 4 }}>Searching...</p>}
        </div>

        {/* Search results dropdown */}
        {search.results.length > 0 && (
          <div style={{ maxHeight: 200, overflowY: "auto", borderBottom: "1px solid #475569" }}>
            {search.results.map((r, i) => (
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
          ) : entity.grantsLoading ? (
            <p style={{ padding: 16, fontSize: 13, color: "#94a3b8", fontStyle: "italic", textAlign: "center" }}>Loading privileges...</p>
          ) : (
            <div style={{ padding: "0 12px" }}>
              <GrantTreeView groups={grouped} />
            </div>
          )}
        </div>
      </div>

      {/* Center: DAG view */}
      <div style={{ flex: 1, position: "relative", background: "#0f172a" }}>
        {!selected ? (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", color: "#475569", fontSize: 14 }}>
            Select a user or role to view inheritance DAG
          </div>
        ) : entity.dagLoading ? (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", color: "#94a3b8", fontSize: 14 }}>
            Loading inheritance graph...
          </div>
        ) : (
          <>
            <div style={{ position: "absolute", top: 12, right: 12, zIndex: 10 }}>
              <ExportPngBtn />
            </div>
            <ReactFlowProvider>
              <DAGView data={entity.dag} direction="TB" loading={false} />
            </ReactFlowProvider>
          </>
        )}
      </div>

      {/* Right: Clicked node detail panel */}
      {clicked.node && (
        <div style={{ width: 320, flexShrink: 0, borderLeft: "1px solid #475569", display: "flex", flexDirection: "column", overflow: "hidden", background: "#1e293b" }}>
          {/* Header */}
          <div style={{ padding: 12, borderBottom: "1px solid #475569", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <InlineIcon type={clicked.node!.type} size={18} />
              <span style={{ fontSize: 14, fontWeight: 600, color: "#e2e8f0" }}>
                <FormattedName name={clicked.node!.label} />
              </span>
              <span style={{
                fontSize: 10, padding: "2px 6px", borderRadius: 4, fontWeight: 600,
                background: clicked.node!.type === "user" ? "rgba(14,165,233,0.18)" : "rgba(249,115,22,0.18)",
                color: clicked.node!.type === "user" ? "#38bdf8" : "#fb923c",
              }}>
                {clicked.node!.type.toUpperCase()}
              </span>
            </div>
            <button
              onClick={() => setClicked({ node: null, grants: [], loading: false })}
              style={{ background: "none", border: "none", color: "#94a3b8", cursor: "pointer", fontSize: 18, lineHeight: 1 }}
            >
              &times;
            </button>
          </div>

          {/* Grants */}
          <div style={{ flex: 1, overflowY: "auto", padding: "8px 0" }}>
            {clicked.loading ? (
              <p style={{ padding: 16, fontSize: 13, color: "#94a3b8", fontStyle: "italic", textAlign: "center" }}>Loading privileges...</p>
            ) : (
              <div style={{ padding: "0 12px" }}>
                <GrantTreeView groups={buildGrantDisplay(clicked.grants)} />
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
        {uname} <span style={{ fontSize: 10, color: "#64748b", fontWeight: 400 }}>({hostLabel})</span>
      </>
    );
  }
  return <>{name}</>;
}

