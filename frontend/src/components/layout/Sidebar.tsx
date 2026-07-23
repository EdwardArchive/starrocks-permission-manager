import { useEffect, useState } from "react";
import { getCatalogs } from "../../api/user";
import { usePermApi } from "../../api/permApi";
import { useShallow } from "zustand/react/shallow";
import { useDagStore } from "../../stores/dagStore";
import { useAuthStore } from "../../stores/authStore";
import { NODE_COLORS } from "../dag/nodeIcons";
import { C } from "../../utils/colors";
import { useServerSearch } from "../../hooks/useServerSearch";
import { useTreeExpansion } from "./useTreeExpansion";
import { Icon, EyeToggle } from "./sidebarParts";
import { S } from "./sidebarStyles";
import type { CatalogItem, ObjectItem, RoleItem, SearchResult } from "../../types";

export default function Sidebar() {
  const {
    activeTab,
    searchQuery,
    setSearchQuery,
    setSelectedNode,
    setPanelMode,
    activeCatalog,
    setActiveCatalog,
    setActiveTab,
    hiddenNodes,
    toggleNodeVisibility,
  } = useDagStore(
    useShallow((s) => ({
      activeTab: s.activeTab,
      searchQuery: s.searchQuery,
      setSearchQuery: s.setSearchQuery,
      setSelectedNode: s.setSelectedNode,
      setPanelMode: s.setPanelMode,
      activeCatalog: s.activeCatalog,
      setActiveCatalog: s.setActiveCatalog,
      setActiveTab: s.setActiveTab,
      hiddenNodes: s.hiddenNodes,
      toggleNodeVisibility: s.toggleNodeVisibility,
    })),
  );
  const { user } = useAuthStore();
  const permApi = usePermApi();

  const [catalogs, setCatalogs] = useState<CatalogItem[]>([]);
  const [roles, setRoles] = useState<RoleItem[]>([]);

  const { expandedCats, expandedDbs, dbMap, objMap, toggleCat, toggleDb: expandDb } = useTreeExpansion();

  // Server-side search (300ms debounce, min 2 chars — see useServerSearch)
  const { results: searchResults, searching, reset: resetSearch } = useServerSearch<SearchResult>(
    searchQuery,
    permApi.searchAll,
  );

  useEffect(() => {
    getCatalogs().then(setCatalogs).catch(() => {});
    permApi.getRoles().then(setRoles).catch(() => {});
  }, [permApi]);

  const toggleDb = (cat: string, db: string) => {
    if (activeTab !== "obj") setActiveTab("obj");
    expandDb(cat, db);
  };

  const selectItem = (type: string, label: string, metadata?: Record<string, unknown>) => {
    setSelectedNode({ id: "", label, type, color: NODE_COLORS[type], metadata });
    if (type === "user" || type === "role") {
      setActiveTab("role");
      setPanelMode(type === "user" ? "user" : "object");
    } else {
      setActiveTab("obj");
      setPanelMode("object");
    }
  };

  const q = searchQuery.toLowerCase();
  const match = (name: string) => !q || name.toLowerCase().includes(q);

  const hoverIn = (e: React.MouseEvent) => {
    const el = e.currentTarget as HTMLElement;
    if (!el.dataset.active) el.style.background = C.border;
  };
  const hoverOut = (e: React.MouseEvent) => {
    const el = e.currentTarget as HTMLElement;
    if (!el.dataset.active) el.style.background = "transparent";
  };

  const onCatalogClick = (catName: string) => {
    if (activeTab !== "obj") setActiveTab("obj");
    toggleCat(catName);
    setActiveCatalog(catName);
  };

  return (
    <aside style={S.aside}>
      {/* Search */}
      <div style={{ ...S.searchWrap, position: "relative" }}>
        <input
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search objects, users, roles..."
          style={{ ...S.searchInput, paddingRight: searchQuery ? 28 : 12 }}
          onFocus={(e) => (e.target.style.borderColor = C.accent)}
          onBlur={(e) => (e.target.style.borderColor = C.borderLight)}
        />
        {searchQuery && (
          <button
            onClick={() => { setSearchQuery(""); resetSearch(); }}
            style={{
              position: "absolute", right: 20, top: "50%", transform: "translateY(-50%)",
              width: 18, height: 18, border: "none", background: C.borderLight, borderRadius: "50%",
              color: C.text1, fontSize: 11, cursor: "pointer", display: "flex",
              alignItems: "center", justifyContent: "center", fontFamily: "inherit", padding: 0,
            }}
          >
            &times;
          </button>
        )}
      </div>

      <div style={S.content}>
        {/* ── Search results mode ── */}
        {(searchResults !== null || searching) ? (
          <div>
            <div style={S.sectionTitle}>
              Search Results {searching ? "" : `(${searchResults?.length ?? 0})`}
            </div>
            {searching && (
              <div style={{ padding: "12px 16px", display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: C.text2 }}>
                <span style={{
                  width: 14, height: 14, border: `2px solid ${C.borderLight}`, borderTop: `2px solid ${C.accent}`,
                  borderRadius: "50%", display: "inline-block",
                  animation: "spin 0.8s linear infinite",
                }} />
                Searching...
                <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
              </div>
            )}
            {!searching && searchResults?.length === 0 && (
              <div style={{ padding: "8px 16px", fontSize: 12, color: C.text2, fontStyle: "italic" }}>No results found</div>
            )}
            {(searchResults || []).map((r, i) => (
              <button
                key={`${r.path}_${i}`}
                style={S.item(0)}
                onClick={() => {
                  if (r.catalog) setActiveCatalog(r.catalog);
                  selectItem(r.type, r.name, { catalog: r.catalog, database: r.database });
                }}
                onMouseEnter={hoverIn}
                onMouseLeave={hoverOut}
              >
                <Icon type={r.type} size={14} />
                <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.name}</span>
                <span style={{ fontSize: 10, color: C.text3, flexShrink: 0, maxWidth: 100, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {r.catalog && r.database ? `${r.catalog}.${r.database}` : r.catalog || ""}
                </span>
              </button>
            ))}
          </div>
        ) : (
        <>
        {/* ── Catalogs ── */}
        <div style={S.sectionTitle}>Catalogs</div>
        {catalogs.filter((c) => match(c.name)).map((cat) => {
          const isActive = activeCatalog === cat.name;
          return (
          <div key={cat.name}>
            <button
              data-active={isActive ? "1" : undefined}
              style={{
                ...S.item(0),
                background: isActive ? "rgba(59,130,246,0.12)" : "transparent",
              }}
              onClick={() => onCatalogClick(cat.name)}
              onMouseEnter={hoverIn}
              onMouseLeave={hoverOut}
            >
              <span style={S.expand}>{expandedCats.has(cat.name) ? "▼" : "▶"}</span>
              <Icon type="catalog" />
              <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 150 }}>
                {cat.name}
              </span>
              <span style={{ ...S.badge(), flexShrink: 0 }}>{cat.catalog_type.replace("Catalog", "")}</span>
            </button>

            {expandedCats.has(cat.name) && (dbMap[cat.name] || []).filter((d) => match(d.name)).map((db) => (
              <div key={db.name}>
                <button style={S.item(1)} onClick={() => toggleDb(cat.name, db.name)} onMouseEnter={hoverIn} onMouseLeave={hoverOut}>
                  <span style={S.expand}>{expandedDbs.has(`${cat.name}.${db.name}`) ? "▼" : "▶"}</span>
                  <Icon type="database" />
                  <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{db.name}</span>
                  <EyeToggle label={db.name} hidden={hiddenNodes.has(db.name)} onToggle={(e) => { e.stopPropagation(); toggleNodeVisibility(db.name); }} />
                </button>

                {expandedDbs.has(`${cat.name}.${db.name}`) && (() => {
                  const objs = objMap[`${cat.name}.${db.name}`] || [];
                  const groups: Record<string, ObjectItem[]> = {};
                  objs.filter((o) => match(o.name)).forEach((o) => {
                    const g = o.object_type === "MATERIALIZED VIEW" ? "mv" : o.object_type.toLowerCase();
                    (groups[g] ??= []).push(o);
                  });
                  return Object.entries(groups).map(([gType, items]) => (
                    <div key={gType}>
                      {/* Group header */}
                      <div style={S.item(2, true)}>
                        <span style={S.expand}>▼</span>
                        <Icon type={gType} size={14} />
                        {gType === "mv" ? "Materialized Views" : gType.charAt(0).toUpperCase() + gType.slice(1) + "s"}
                        <span style={S.badge()}>{items.length}</span>
                      </div>
                      {/* Items */}
                      {items.map((o) => (
                        <button key={o.name} style={S.item(3)} onClick={() => selectItem(gType, o.name)} onMouseEnter={hoverIn} onMouseLeave={hoverOut}>
                          <Icon type={gType} size={14} />
                          <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{o.name}</span>
                          <EyeToggle label={o.name} hidden={hiddenNodes.has(o.name)} onToggle={(e) => { e.stopPropagation(); toggleNodeVisibility(o.name); }} />
                        </button>
                      ))}
                    </div>
                  ));
                })()}
              </div>
            ))}
          </div>
        );})}

        {/* ── Users ── */}
        {user?.is_user_admin && (
          <>
            <div style={{ ...S.sectionTitle, marginTop: 8 }}>Users</div>
            <div style={{ padding: "4px 16px", fontSize: 11, color: C.text2, fontStyle: "italic" }}>
              Loaded from role hierarchy
            </div>
          </>
        )}

        {/* ── Roles ── */}
        <div style={{ ...S.sectionTitle, marginTop: 8 }}>Roles</div>
        {roles.filter((r) => match(r.name)).map((r) => (
          <button key={r.name} style={S.item(0)} onClick={() => selectItem("role", r.name)} onMouseEnter={hoverIn} onMouseLeave={hoverOut}>
            <Icon type="role" />
            <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.name}</span>
            {r.is_builtin && (
              <span style={{ ...S.badge("rgba(99,102,241,0.2)"), color: "#6366f1" }}>built-in</span>
            )}
            <EyeToggle label={r.name} hidden={hiddenNodes.has(r.name)} onToggle={(e) => { e.stopPropagation(); toggleNodeVisibility(r.name); }} />
          </button>
        ))}
        </>
        )}
      </div>
    </aside>
  );
}
