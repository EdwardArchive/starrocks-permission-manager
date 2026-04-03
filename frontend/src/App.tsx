import { useEffect, useState } from "react";
import { ReactFlowProvider } from "@xyflow/react";
import { useAuthStore } from "./stores/authStore";
import { useShallow } from "zustand/react/shallow";
import { useDagStore, type TabId } from "./stores/dagStore";
import { getMe } from "./api/auth";
import { getObjectHierarchy, getRoleHierarchy, getFullGraph } from "./api/dag";
import type { DAGGraph } from "./types";

import LoginForm from "./components/auth/LoginForm";
import Header from "./components/layout/Header";
import Sidebar from "./components/layout/Sidebar";
import DAGView from "./components/dag/DAGView";
import ObjectDetailPanel from "./components/panels/ObjectDetailPanel";
import UserDetailPanel from "./components/panels/UserDetailPanel";
import GroupDetailPanel from "./components/panels/GroupDetailPanel";
import { NODE_COLORS } from "./components/dag/nodeIcons";
import ExportPngBtn from "./components/common/ExportPngBtn";
import PermissionDetailTab from "./components/tabs/PermissionDetailTab";

const TAB_CONFIG: { id: TabId; label: string; icon: string; disabled?: boolean }[] = [
  { id: "obj", label: "Object Hierarchy", icon: '<rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/>' },
  { id: "role", label: "Role Map", icon: '<circle cx="12" cy="5" r="2.5"/><circle cx="5" cy="17" r="2.5"/><circle cx="19" cy="17" r="2.5"/><path d="M12 7.5v3"/><path d="M12 10.5L5 14.5"/><path d="M12 10.5L19 14.5"/>' },
  { id: "perm", label: "Permission Details", icon: '<circle cx="11" cy="11" r="7"/><line x1="16.5" y1="16.5" x2="21" y2="21"/>' },
  { id: "full", label: "Full Permission Graph", icon: '<circle cx="5" cy="6" r="2.5"/><circle cx="19" cy="6" r="2.5"/><circle cx="5" cy="18" r="2.5"/><circle cx="19" cy="18" r="2.5"/><line x1="7.5" y1="6" x2="16.5" y2="6"/><line x1="5" y1="8.5" x2="5" y2="15.5"/><line x1="7" y1="7.5" x2="17" y2="16.5"/>', disabled: true },
];

const OBJ_FILTERS = [
  { type: "catalog", label: "Catalogs" },
  { type: "database", label: "Databases" },
  { type: "table", label: "Tables" },
  { type: "view", label: "Views" },
  { type: "mv", label: "MVs" },
  { type: "function", label: "Functions" },
];

const ROLE_FILTERS = [
  { type: "role", label: "Roles" },
  { type: "user", label: "Users" },
];

export default function App() {
  const { isLoggedIn, user, setAuth } = useAuthStore();
  const { activeTab, setActiveTab, activeCatalog, panelMode, setPanelMode, visibleTypes, toggleType, groupsOnly, setGroupsOnly, hiddenNodes } = useDagStore(
    useShallow((s) => ({
      activeTab: s.activeTab,
      setActiveTab: s.setActiveTab,
      activeCatalog: s.activeCatalog,
      panelMode: s.panelMode,
      setPanelMode: s.setPanelMode,
      visibleTypes: s.visibleTypes,
      toggleType: s.toggleType,
      groupsOnly: s.groupsOnly,
      setGroupsOnly: s.setGroupsOnly,
      hiddenNodes: s.hiddenNodes,
    }))
  );

  const [dagState, setDagState] = useState<{ cache: Record<string, DAGGraph | null>; loading: boolean }>({
    cache: {}, loading: false,
  });

  useEffect(() => {
    if (isLoggedIn && !user) {
      getMe().then((me) => setAuth(localStorage.getItem("sr_token")!, me)).catch(() => useAuthStore.getState().logout());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-only: restore login session once
  }, []);

  // Load DAG data when tab or catalog changes (skip perm tab - it manages its own DAG)
  const dagKey = `${activeTab}_${activeCatalog}`;
  useEffect(() => {
    if (!isLoggedIn || activeTab === "perm") return;
    if (dagState.cache[dagKey]) return;
    const controller = new AbortController();
    setDagState((prev) => ({ ...prev, loading: true }));
    const fetcher =
      activeTab === "obj" ? () => getObjectHierarchy(activeCatalog, controller.signal) :
      activeTab === "role" ? () => getRoleHierarchy(controller.signal) :
      () => getFullGraph(activeCatalog, controller.signal);
    fetcher()
      .then((data) => setDagState((prev) => ({ cache: { ...prev.cache, [dagKey]: data }, loading: false })))
      .catch(() => setDagState((prev) => ({ ...prev, loading: false })));
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional: only reload on tab/catalog change, dagState.cache checked inside
  }, [isLoggedIn, activeTab, activeCatalog]);

  if (!isLoggedIn) return <LoginForm />;

  const direction = activeTab === "full" ? "LR" : "TB";

  const rawDag = dagState.cache[dagKey] || null;
  const loading = dagState.loading;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh" }}>
      <Header />
      <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
        {/* Sidebar: hidden on perm tab (it has its own) */}
        {activeTab !== "perm" && <Sidebar />}

        {/* Main content */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
          {/* Tab bar */}
          <div style={{ display: "flex", gap: 0, borderBottom: "1px solid #475569", background: "#1e293b", padding: "0 16px", flexShrink: 0 }}>
            {TAB_CONFIG.map((t) => {
              const active = activeTab === t.id;
              return (
                <button
                  key={t.id}
                  onClick={() => !t.disabled && setActiveTab(t.id)}
                  disabled={t.disabled}
                  style={{
                    padding: "12px 20px", fontSize: 13, fontWeight: 500,
                    cursor: t.disabled ? "not-allowed" : "pointer",
                    color: t.disabled ? "#475569" : active ? "#3b82f6" : "#94a3b8",
                    opacity: t.disabled ? 0.5 : 1,
                    border: "none", borderBottom: `2px solid ${active && !t.disabled ? "#3b82f6" : "transparent"}`,
                    background: "none", fontFamily: "inherit",
                    display: "flex", alignItems: "center", gap: 6,
                  }}
                >
                  <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, display: "block" }} dangerouslySetInnerHTML={{ __html: t.icon }} />
                  <span style={{ whiteSpace: "nowrap", lineHeight: 1 }}>{t.label}</span>
                  {t.disabled && <span style={{ fontSize: 9, color: "#64748b", fontWeight: 400 }}>Coming Soon</span>}
                </button>
              );
            })}
          </div>

          {/* Content area: perm tab has its own layout */}
          {activeTab === "perm" ? (
            <PermissionDetailTab />
          ) : (
            <div style={{ flex: 1, position: "relative", background: "#0f172a" }}>
              {/* Toolbar: tab-specific checkbox filters + export */}
              <div style={{ position: "absolute", top: 12, left: 12, right: 12, zIndex: 10, display: "flex", alignItems: "center", gap: 12 }}>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  {(activeTab === "obj" ? OBJ_FILTERS : ROLE_FILTERS).map((f) => (
                    <label key={f.type} style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 12, color: "#94a3b8", cursor: "pointer", userSelect: "none", whiteSpace: "nowrap" }}>
                      <input type="checkbox" checked={visibleTypes[f.type]} onChange={() => toggleType(f.type)} style={{ accentColor: "#3b82f6", width: 14, height: 14, cursor: "pointer" }} />
                      <span style={{ width: 10, height: 10, borderRadius: 3, background: NODE_COLORS[f.type], flexShrink: 0 }} />
                      {f.label}
                    </label>
                  ))}
                  {activeTab === "obj" && (
                    <>
                      <span style={{ width: 1, height: 20, background: "#475569" }} />
                      <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 12, color: "#94a3b8", cursor: "pointer", whiteSpace: "nowrap" }}>
                        <input type="checkbox" checked={groupsOnly} onChange={(e) => setGroupsOnly(e.target.checked)} style={{ accentColor: "#3b82f6", width: 14, height: 14, cursor: "pointer" }} />
                        Groups Only
                      </label>
                    </>
                  )}
                </div>
                <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
                  <ExportPngBtn />
                </div>
              </div>

              <ReactFlowProvider>
                <DAGView data={rawDag} direction={direction} loading={loading} hiddenNodes={hiddenNodes} />
              </ReactFlowProvider>
            </div>
          )}
        </div>

        {/* Detail panel: hidden on perm tab */}
        {activeTab !== "perm" && (
          <div
            style={{
              width: panelMode ? 380 : 0,
              flexShrink: 0,
              borderLeft: panelMode ? "1px solid #475569" : "none",
              overflowY: "auto", overflowX: "hidden",
              background: "#1e293b",
              transition: "width 0.3s ease",
            }}
          >
            {panelMode && (
              <div style={{ width: 380 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px 20px", borderBottom: "1px solid #475569" }}>
                  <span style={{ fontSize: 15, fontWeight: 600 }}>Details</span>
                  <button
                    onClick={() => setPanelMode(null)}
                    style={{ width: 28, height: 28, border: "none", background: "transparent", color: "#94a3b8", borderRadius: 6, fontSize: 18, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}
                  >
                    &times;
                  </button>
                </div>
                <div style={{ padding: "16px 20px" }}>
                  {panelMode === "object" && <ObjectDetailPanel />}
                  {panelMode === "user" && <UserDetailPanel />}
                  {panelMode === "group" && <GroupDetailPanel />}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

