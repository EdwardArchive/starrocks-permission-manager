import { useEffect, useState, useRef } from "react";
import { getCatalogs, getDatabases, getTables, getRoles as userGetRoles, searchAll as userSearchAll, type SearchResult } from "../../api/user";
import { getRoles as adminGetRoles, searchAll as adminSearchAll } from "../../api/admin";
import { useDagStore } from "../../stores/dagStore";
import { useAuthStore } from "../../stores/authStore";
import { colorizedSvg, NODE_COLORS } from "../dag/nodeIcons";
import type { CatalogItem, DatabaseItem, ObjectItem, RoleItem } from "../../types";

/* ── Inline SVG icon (same as mockup: 16x16) ── */
function Icon({ type, size = 16 }: { type: string; size?: number }) {
  const svg = colorizedSvg(type);
  if (!svg) return null;
  const sized = svg
    .replace(/width="[^"]*"/, `width="${size}"`)
    .replace(/height="[^"]*"/, `height="${size}"`);
  return (
    <span
      style={{ width: size, height: size, flexShrink: 0, display: "inline-flex", alignItems: "center", justifyContent: "center", verticalAlign: "middle" }}
      dangerouslySetInnerHTML={{ __html: sized }}
    />
  );
}

/* ── Styles matching mockup.html exactly ── */
const S = {
  aside: {
    width: 300, flexShrink: 0, display: "flex" as const, flexDirection: "column" as const,
    borderRight: "1px solid #475569", background: "#1e293b", overflow: "hidden",
  },
  searchWrap: { padding: "12px 16px", borderBottom: "1px solid #475569" },
  searchInput: {
    width: "100%", padding: "8px 12px", background: "#0f172a", border: "1px solid #475569",
    borderRadius: 6, color: "#e2e8f0", fontSize: 13, outline: "none", fontFamily: "inherit",
  },
  content: { flex: 1, overflowY: "auto" as const, padding: "8px 0" },
  sectionTitle: {
    padding: "8px 16px", fontSize: 11, fontWeight: 700, textTransform: "uppercase" as const,
    letterSpacing: "0.05em", color: "#94a3b8",
  },
  item: (indent: number, isGroup?: boolean): React.CSSProperties => ({
    display: "flex", alignItems: "center", gap: 8, cursor: "pointer",
    padding: `6px 16px 6px ${24 + indent * 16}px`,
    fontSize: isGroup ? 12 : 13, fontWeight: isGroup ? 600 : 400,
    color: isGroup ? "#94a3b8" : "#e2e8f0",
    border: "none", background: "transparent", width: "100%", textAlign: "left",
    fontFamily: "inherit",
  }),
  badge: (color?: string): React.CSSProperties => ({
    marginLeft: "auto", background: color || "#334155", padding: "1px 6px",
    borderRadius: 10, fontSize: 11, color: color ? undefined : "#94a3b8",
  }),
  expand: { fontSize: 10, marginRight: 2, color: "#94a3b8", flexShrink: 0 } as React.CSSProperties,
};

/* ── Eye toggle for hide/show ── */
function EyeToggle({ label, hidden, onToggle }: { label: string; hidden: boolean; onToggle: (e: React.MouseEvent) => void }) {
  return (
    <span
      role="button"
      tabIndex={0}
      onClick={onToggle}
      title={hidden ? `Show ${label}` : `Hide ${label}`}
      style={{
        background: "none", border: "none", cursor: "pointer", padding: 2,
        color: hidden ? "#475569" : "#64748b", flexShrink: 0,
        display: "inline-flex", alignItems: "center", justifyContent: "center",
        opacity: hidden ? 0.5 : 0.7,
      }}
      onMouseEnter={(e) => { e.currentTarget.style.opacity = "1"; }}
      onMouseLeave={(e) => { e.currentTarget.style.opacity = hidden ? "0.5" : "0.7"; }}
    >
      {hidden ? (
        <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
          <path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94"/>
          <path d="M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19"/>
          <line x1="1" y1="1" x2="23" y2="23"/>
        </svg>
      ) : (
        <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
          <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
          <circle cx="12" cy="12" r="3"/>
        </svg>
      )}
    </span>
  );
}

export default function Sidebar() {
  const { activeTab, searchQuery, setSearchQuery, setSelectedNode, setPanelMode, activeCatalog, setActiveCatalog, setActiveTab, hiddenNodes, toggleNodeVisibility } = useDagStore();
  const { user } = useAuthStore();
  const isAdmin = user?.is_user_admin ?? false;

  const [catalogs, setCatalogs] = useState<CatalogItem[]>([]);
  const [dbMap, setDbMap] = useState<Record<string, DatabaseItem[]>>({});
  const [objMap, setObjMap] = useState<Record<string, ObjectItem[]>>({});
  const [roles, setRoles] = useState<RoleItem[]>([]);
  const [expandedCats, setExpandedCats] = useState<Set<string>>(new Set());
  const [expandedDbs, setExpandedDbs] = useState<Set<string>>(new Set());

  // Server-side search
  const [searchResults, setSearchResults] = useState<SearchResult[] | null>(null);
  const [searching, setSearching] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    getCatalogs().then(setCatalogs).catch(() => {});
    const getRoles = isAdmin ? adminGetRoles : userGetRoles;
    getRoles().then(setRoles).catch(() => {});
  }, [isAdmin]);

  // Debounced search: trigger after 300ms of no typing, min 2 chars
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const trimmed = searchQuery.trim();
    if (trimmed.length < 2) {
      setSearchResults(null);
      setSearching(false);
      return;
    }
    setSearching(true);
    debounceRef.current = setTimeout(() => {
      const searchAll = isAdmin ? adminSearchAll : userSearchAll;
      searchAll(trimmed)
        .then(setSearchResults)
        .catch(() => setSearchResults([]))
        .finally(() => setSearching(false));
    }, 300);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [searchQuery, isAdmin]);

  const toggleCat = async (cat: string) => {
    const next = new Set(expandedCats);
    if (next.has(cat)) { next.delete(cat); } else {
      next.add(cat);
      if (!dbMap[cat]) {
        const dbs = await getDatabases(cat).catch(() => []);
        setDbMap((m) => ({ ...m, [cat]: dbs }));
      }
    }
    setExpandedCats(next);
  };

  const toggleDb = async (cat: string, db: string) => {
    if (activeTab !== "obj") setActiveTab("obj");
    const key = `${cat}.${db}`;
    const next = new Set(expandedDbs);
    if (next.has(key)) { next.delete(key); } else {
      next.add(key);
      if (!objMap[key]) {
        const objs = await getTables(cat, db).catch(() => []);
        setObjMap((m) => ({ ...m, [key]: objs }));
      }
    }
    setExpandedDbs(next);
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
    if (!el.dataset.active) el.style.background = "#334155";
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
          onFocus={(e) => (e.target.style.borderColor = "#3b82f6")}
          onBlur={(e) => (e.target.style.borderColor = "#475569")}
        />
        {searchQuery && (
          <button
            onClick={() => { setSearchQuery(""); setSearchResults(null); }}
            style={{
              position: "absolute", right: 20, top: "50%", transform: "translateY(-50%)",
              width: 18, height: 18, border: "none", background: "#475569", borderRadius: "50%",
              color: "#e2e8f0", fontSize: 11, cursor: "pointer", display: "flex",
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
              <div style={{ padding: "12px 16px", display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "#94a3b8" }}>
                <span style={{
                  width: 14, height: 14, border: "2px solid #475569", borderTop: "2px solid #3b82f6",
                  borderRadius: "50%", display: "inline-block",
                  animation: "spin 0.8s linear infinite",
                }} />
                Searching...
                <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
              </div>
            )}
            {!searching && searchResults?.length === 0 && (
              <div style={{ padding: "8px 16px", fontSize: 12, color: "#94a3b8", fontStyle: "italic" }}>No results found</div>
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
                <span style={{ fontSize: 10, color: "#64748b", flexShrink: 0, maxWidth: 100, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
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
            <div style={{ padding: "4px 16px", fontSize: 11, color: "#94a3b8", fontStyle: "italic" }}>
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
