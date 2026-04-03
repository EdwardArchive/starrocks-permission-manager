import { useEffect, useState } from "react";
import { useDagStore } from "../../stores/dagStore";
import { getUserEffectivePrivileges } from "../../api/privileges";
import InlineIcon from "../common/InlineIcon";
import { getPrivColor } from "../../utils/privColors";
import type { PrivilegeGrant } from "../../types";

export default function UserDetailPanel() {
  const { selectedNode } = useDagStore();
  const [grants, setGrants] = useState<PrivilegeGrant[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadedNodeId, setLoadedNodeId] = useState<string | null>(null);

  useEffect(() => {
    if (!selectedNode) return;
    setGrants([]);
    setLoading(true);
    setLoadedNodeId(null);
    const nodeId = selectedNode.id;
    getUserEffectivePrivileges(selectedNode.label)
      .then((data) => { setGrants(data); setLoadedNodeId(nodeId); })
      .catch(() => { setLoadedNodeId(nodeId); })
      .finally(() => setLoading(false));
  }, [selectedNode]);

  if (!selectedNode) return null;

  // Group by catalog → database → object
  const tree: Record<string, Record<string, { name: string; type: string; privs: { priv: string; source: string }[] }[]>> = {};
  grants.forEach((g) => {
    const cat = g.object_catalog || "(system)";
    const db = g.object_database || "(global)";
    (tree[cat] ??= {})[db] ??= [];
    const existing = tree[cat][db].find((o) => o.name === (g.object_name || g.object_type));
    if (existing) {
      existing.privs.push({ priv: g.privilege_type, source: g.source });
    } else {
      tree[cat][db].push({
        name: g.object_name || g.object_type,
        type: g.object_type,
        privs: [{ priv: g.privilege_type, source: g.source }],
      });
    }
  });

  const roles = [...new Set(grants.filter((g) => g.source !== "direct").map((g) => g.source))];

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
        <InlineIcon type="user" size={18} />
        <h3 style={{ fontSize: 15, fontWeight: 600, margin: 0 }}>{selectedNode.label}</h3>
      </div>
      <p style={{ fontSize: 12, color: "#94a3b8", marginBottom: 14 }}>
        {(() => {
          const m = selectedNode.label.match(/^'?([^'@]+)'?@'?([^']*)'?$/);
          if (m) {
            const host = m[2];
            const hostLabel = !host || host === "%" ? "ALL CIDR" : host.includes("/") ? host : host + "/32";
            return <>{m[1]} <span style={{ color: "#64748b" }}>({hostLabel})</span></>;
          }
          return selectedNode.label;
        })()}
      </p>

      {/* Roles */}
      {roles.length > 0 && (
        <>
          <p style={{ fontSize: 13, fontWeight: 600, color: "#94a3b8", marginBottom: 8 }}>Assigned Roles</p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 16 }}>
            {roles.map((r) => (
              <span key={r} style={{ padding: "3px 8px", borderRadius: 6, fontSize: 11, fontWeight: 500, background: "rgba(249,115,22,0.15)", color: "#f97316" }}>{r}</span>
            ))}
          </div>
        </>
      )}

      <p style={{ fontSize: 13, fontWeight: 600, color: "#94a3b8", marginBottom: 8 }}>Accessible Objects</p>

      {(loading || loadedNodeId !== selectedNode?.id) ? (
        <p style={{ fontSize: 13, color: "#94a3b8", fontStyle: "italic" }}>Loading...</p>
      ) : Object.entries(tree).length === 0 ? (
        <p style={{ fontSize: 13, color: "#94a3b8", fontStyle: "italic" }}>No grants found</p>
      ) : (
      Object.entries(tree).map(([cat, dbs]) => (
        <div key={cat} style={{ marginBottom: 10 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "4px 0", fontSize: 13, fontWeight: 500, whiteSpace: "nowrap" }}>
            <InlineIcon type="catalog" size={14} /> {cat}
          </div>
          {Object.entries(dbs).map(([db, objs]) => (
            <div key={db} style={{ paddingLeft: 20, marginBottom: 4 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "3px 0", fontSize: 12, color: "#94a3b8", whiteSpace: "nowrap" }}>
                <InlineIcon type="database" size={12} /> {db}
              </div>
              {objs.map((o) => (
                <div key={o.name} style={{
                  padding: "4px 0 4px 20px",
                  borderBottom: "1px solid rgba(71,85,105,0.2)",
                  fontSize: 12,
                }}>
                  {/* Object name on its own line */}
                  <div style={{ fontWeight: 500, color: "#e2e8f0", marginBottom: 3, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {o.name}
                  </div>
                  {/* Privilege tags below */}
                  <div style={{ display: "flex", gap: 3, flexWrap: "wrap" }}>
                    {o.privs.map((p, i) => {
                      const c = getPrivColor(p.priv);
                      return <span key={i} style={{ padding: "2px 5px", borderRadius: 4, fontSize: 10, fontWeight: 600, background: c.bg, color: c.fg, whiteSpace: "nowrap" }}>{p.priv}</span>;
                    })}
                  </div>
                </div>
              ))}
            </div>
          ))}
        </div>
      ))
      )}
    </div>
  );
}
