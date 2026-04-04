import { useEffect, useState } from "react";
import { useDagStore } from "../../stores/dagStore";
import { getObjectPrivileges, getRolePrivileges } from "../../api/privileges";
import { getTableDetail } from "../../api/objects";
import InlineIcon from "../common/InlineIcon";
import GrantTreeView from "../common/GrantTreeView";
import { buildGrantDisplay, extractSourceRoles } from "../../utils/grantDisplay";
import { PRIV_BY_TYPE, formatBytes } from "../../utils/inventory-helpers";
import type { PrivilegeGrant, TableDetail } from "../../types";
const DEFAULT_PRIVS = ["SELECT", "INSERT", "UPDATE", "DELETE", "ALTER", "DROP"];
// "ALL" or "ALL PRIVILEGES" should expand to all individual privilege types
const ALL_ALIASES = new Set(["ALL", "ALL PRIVILEGES"]);

// Extract catalog/database from DAG node metadata
function getNodeContext(node: { label: string; metadata?: Record<string, unknown> | null }) {
  const meta = node.metadata || {};
  return {
    catalog: meta.catalog as string | undefined,
    database: meta.database as string | undefined,
    name: node.label,
  };
}

export default function ObjectDetailPanel() {
  const { selectedNode } = useDagStore();
  const [tab, setTab] = useState<"privileges" | "details">("privileges");

  interface PanelData {
    grants: PrivilegeGrant[];
    detail: TableDetail | null;
    loadedNodeId: string | null;
    loadingPrivs: boolean;
    loadingDetail: boolean;
  }
  const [data, setData] = useState<PanelData>({
    grants: [], detail: null, loadedNodeId: null, loadingPrivs: false, loadingDetail: false,
  });

  const parsed = selectedNode ? getNodeContext(selectedNode) : {} as ReturnType<typeof getNodeContext>;

  useEffect(() => {
    if (!selectedNode) return;
    setTab("privileges");
    setData({ grants: [], detail: null, loadedNodeId: null, loadingPrivs: true, loadingDetail: false });

    const nodeId = selectedNode.id;
    const nodeType = selectedNode.type.toLowerCase();
    // Map DAG node type to StarRocks object type for API filtering
    const srObjectType = nodeType === "mv" ? "MATERIALIZED VIEW" : nodeType.toUpperCase();

    // For database/catalog nodes: query at that scope level, not as object name
    let fetchCatalog = parsed.catalog;
    let fetchDatabase = parsed.database;
    let fetchName: string | undefined = parsed.name || selectedNode.label;
    if (nodeType === "database") {
      fetchCatalog = parsed.catalog;
      fetchDatabase = selectedNode.label;
      fetchName = undefined;
    } else if (nodeType === "catalog") {
      fetchCatalog = selectedNode.label;
      fetchDatabase = undefined;
      fetchName = undefined;
    } else if (nodeType === "system") {
      fetchCatalog = undefined;
      fetchDatabase = undefined;
      fetchName = undefined;
    }

    const fetcher = nodeType === "role"
      ? getRolePrivileges(selectedNode.label)
      : getObjectPrivileges(fetchCatalog, fetchDatabase, fetchName, srObjectType);
    fetcher
      .then((grants) => setData((prev) => ({ ...prev, grants, loadedNodeId: nodeId, loadingPrivs: false })))
      .catch(() => setData((prev) => ({ ...prev, loadedNodeId: nodeId, loadingPrivs: false })));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional: parsed derives from selectedNode
  }, [selectedNode]);

  useEffect(() => {
    if (tab !== "details" || !selectedNode) return;
    if (data.detail) return;
    if (!parsed.catalog || !parsed.database || !parsed.name) return;
    setData((prev) => ({ ...prev, loadingDetail: true }));
    getTableDetail(parsed.catalog, parsed.database, parsed.name)
      .then((detail) => setData((prev) => ({ ...prev, detail, loadingDetail: false })))
      .catch(() => setData((prev) => ({ ...prev, loadingDetail: false })));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional: data.detail/parsed derive from selectedNode
  }, [tab, selectedNode]);

  if (!selectedNode) return null;

  const { grants, detail, loadedNodeId, loadingPrivs, loadingDetail } = data;
  const color = selectedNode.color || "#94a3b8";

  const isRole = selectedNode.type.toLowerCase() === "role";

  // Determine privilege columns: dynamic for roles, type-specific for objects
  const nodeType = selectedNode.type.toLowerCase();
  const privColumns = isRole
    ? [...new Set(grants.map((g) => g.privilege_type.toUpperCase()))].sort()
    : (PRIV_BY_TYPE[nodeType] || DEFAULT_PRIVS);

  // For objects: rows = grantees (users/roles). For roles: rows = objects the role can access
  // Helper: derive display label and scope type for role grant rows
  function grantRowKey(g: PrivilegeGrant): string {
    if (g.object_name) return g.object_name;
    if (g.object_database) return `ALL ${g.object_type}S IN ${g.object_database}`;
    if (g.object_catalog) return `ALL IN ${g.object_catalog}`;
    return g.object_type || "SYSTEM";
  }
  function grantScopeType(g: PrivilegeGrant): string {
    if (g.object_name) return g.object_type || "";
    if (g.object_database) return "DATABASE";
    if (g.object_catalog) return "CATALOG";
    return g.object_type || "SYSTEM";
  }

  const rowKeys = [...new Set(grants.map((g) => isRole ? grantRowKey(g) : g.grantee))];
  const matrix = rowKeys.map((name) => {
    const row: Record<string, "D" | "I" | "-"> = {};
    privColumns.forEach((p) => (row[p] = "-"));
    const matching = grants.filter((g) => isRole ? grantRowKey(g) === name : g.grantee === name);
    matching.forEach((g) => {
      const p = g.privilege_type.toUpperCase();
      const badge = g.source === "direct" ? "D" as const : "I" as const;
      if (ALL_ALIASES.has(p)) {
        privColumns.forEach((col) => {
          if (row[col] === "-" || (row[col] === "I" && badge === "D")) row[col] = badge;
        });
      } else if (p in row) {
        if (row[p] === "-" || (row[p] === "I" && badge === "D")) row[p] = badge;
      }
    });
    const sample = matching[0];
    const rowType = isRole ? grantScopeType(sample) : (sample?.grantee_type || "");
    return { name, type: rowType, row };
  });

  // Path display — avoid duplicates for catalog/database nodes
  const _nt = selectedNode.type.toLowerCase();
  const pathParts = _nt === "catalog" ? [selectedNode.label]
    : _nt === "database" ? [parsed.catalog, selectedNode.label].filter(Boolean)
    : _nt === "system" ? ["SYSTEM"]
    : [parsed.catalog, parsed.database, parsed.name || selectedNode.label].filter(Boolean);

  return (
    <div>
      {/* Object path */}
      <div style={{ fontSize: 12, color: "#94a3b8", marginBottom: 12, wordBreak: "break-all", lineHeight: 1.6 }}>
        {pathParts.map((p, i) => (
          <span key={i}>
            {i > 0 && <span style={{ color: "#475569", margin: "0 3px" }}>/</span>}
            <span style={i === pathParts.length - 1 ? { color: "#e2e8f0", fontWeight: 500 } : undefined}>{p}</span>
          </span>
        ))}
      </div>

      {/* Type badge */}
      <span style={{ display: "inline-block", padding: "4px 10px", borderRadius: 6, fontSize: 12, fontWeight: 500, marginBottom: 16, background: `${color}20`, color }}>
        {selectedNode.type.toUpperCase()}
      </span>

      {/* Tabs */}
      <div style={{ display: "flex", gap: 0, borderBottom: "1px solid #475569", marginBottom: 16 }}>
        {(["privileges", "details"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            style={{
              padding: "8px 14px", fontSize: 12, fontWeight: 500, cursor: "pointer",
              color: tab === t ? "#3b82f6" : "#94a3b8",
              border: "none", borderBottom: `2px solid ${tab === t ? "#3b82f6" : "transparent"}`,
              background: "none", fontFamily: "inherit", textTransform: "capitalize",
            }}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === "privileges" && (
        <div>
          {(loadingPrivs || loadedNodeId !== selectedNode?.id) ? (
            <p style={{ fontSize: 13, color: "#94a3b8", fontStyle: "italic" }}>Loading...</p>
          ) : grants.length === 0 ? (
            <p style={{ fontSize: 13, color: "#94a3b8", fontStyle: "italic" }}>No grants found</p>
          ) : isRole ? (
            /* ── Role: scope-grouped privilege view ── */
            <GrantTreeView
              groups={buildGrantDisplay(grants)}
              title="Role Privileges"
              totalGrants={grants.length}
              sourceRoles={extractSourceRoles(grants)}
            />
          ) : (
            /* ── Object: matrix view (grantee × privilege type) ── */
            <>
              <p style={{ fontSize: 13, fontWeight: 600, color: "#94a3b8", marginBottom: 10 }}>Permission Matrix</p>
              <div style={{ overflowX: "auto" }}>
              <table style={{ minWidth: 420, borderCollapse: "collapse", fontSize: 12 }}>
                <thead>
                  <tr style={{ borderBottom: "1px solid #475569" }}>
                    <th style={{ textAlign: "left", padding: "8px 6px", fontWeight: 600, color: "#94a3b8", fontSize: 11, whiteSpace: "nowrap" }}>User/Role</th>
                    {privColumns.map((p) => (
                      <th key={p} style={{ textAlign: "center", padding: "8px 3px", fontWeight: 600, color: "#94a3b8", fontSize: 10, whiteSpace: "nowrap" }}>{p.startsWith("CREATE") ? "CREATE" : p}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {matrix.map((m) => (
                    <tr key={m.name} style={{ borderBottom: "1px solid rgba(71,85,105,0.3)" }}>
                      <td style={{ padding: "10px 8px", fontWeight: 500, display: "flex", alignItems: "center", gap: 8 }}>
                        <InlineIcon type={m.type === "ROLE" ? "role" : "user"} size={18} />
                        <UserName name={m.name} />
                      </td>
                      {privColumns.map((p) => (
                        <td key={p} style={{ textAlign: "center", padding: "8px 4px" }}>
                          <Badge v={m.row[p]} />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
              </div>
              <div style={{ display: "flex", gap: 16, marginTop: 12, fontSize: 11, color: "#94a3b8" }}>
                <span style={{ display: "flex", alignItems: "center", gap: 4 }}><Badge v="D" /> Direct</span>
                <span style={{ display: "flex", alignItems: "center", gap: 4 }}><Badge v="I" /> Inherited</span>
                <span style={{ display: "flex", alignItems: "center", gap: 4 }}><Badge v="-" /> No Access</span>
              </div>
            </>
          )}
        </div>
      )}

      {tab === "details" && (
        <div style={{ fontSize: 13 }}>
          {loadingDetail ? (
            <p style={{ color: "#94a3b8", fontStyle: "italic" }}>Loading details...</p>
          ) : !detail ? (
            <p style={{ color: "#94a3b8", fontStyle: "italic" }}>
              {parsed.name ? "Could not load details" : "Select a table/view to see details"}
            </p>
          ) : (
            <div>
              {detail.key_type && <InfoRow label="Key Type" value={detail.key_type} />}
              {detail.engine && <InfoRow label="Engine" value={detail.engine} />}
              {detail.row_count != null && <InfoRow label="Rows" value={detail.row_count.toLocaleString()} />}
              {detail.data_size != null && <InfoRow label="Data Size" value={formatBytes(detail.data_size)} />}
              {detail.distribution_type && (
                <InfoRow label="Distribution" value={`${detail.distribution_type}(${detail.bucket_keys?.join(", ")}) x ${detail.bucket_count}`} />
              )}
              {detail.partition_method && (
                <InfoRow label="Partition" value={`${detail.partition_method}(${detail.partition_key})${detail.partition_count != null ? ` - ${detail.partition_count} partitions` : ""}`} />
              )}
              {detail.replication_num && <InfoRow label="Replicas" value={String(detail.replication_num)} />}
              {detail.storage_medium && <InfoRow label="Storage" value={detail.storage_medium} />}
              {detail.compression && <InfoRow label="Compression" value={detail.compression} />}
              {detail.create_time && <InfoRow label="Created" value={detail.create_time} />}
              {detail.update_time && <InfoRow label="Last Updated" value={detail.update_time} />}

              {detail.columns.length > 0 && (
                <>
                  <p style={{ fontWeight: 600, color: "#94a3b8", marginTop: 16, marginBottom: 8 }}>
                    Columns ({detail.columns.length})
                  </p>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
                    <thead>
                      <tr style={{ borderBottom: "1px solid #475569" }}>
                        <th style={{ textAlign: "left", padding: 4, color: "#94a3b8" }}>Name</th>
                        <th style={{ textAlign: "left", padding: 4, color: "#94a3b8" }}>Type</th>
                        <th style={{ textAlign: "center", padding: 4, color: "#94a3b8" }}>Key</th>
                        <th style={{ textAlign: "center", padding: 4, color: "#94a3b8" }}>Null</th>
                      </tr>
                    </thead>
                    <tbody>
                      {detail.columns.map((c) => (
                        <tr key={c.name} style={{ borderBottom: "1px solid rgba(71,85,105,0.2)" }}>
                          <td style={{ padding: 4 }}>{c.name}</td>
                          <td style={{ padding: 4, color: "#94a3b8" }}>{c.column_type}</td>
                          <td style={{ padding: 4, textAlign: "center", color: "#f59e0b", fontSize: 10, fontWeight: 700 }}>{c.column_key || ""}</td>
                          <td style={{ padding: 4, textAlign: "center", color: "#22c55e", fontSize: 10 }}>{c.is_nullable === "YES" ? "Y" : ""}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </>
              )}

              {detail.ddl && (
                <DDLBlock ddl={detail.ddl} />
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Badge({ v }: { v: string }) {
  const style: React.CSSProperties = {
    display: "inline-flex", alignItems: "center", justifyContent: "center",
    width: 22, height: 22, borderRadius: 4, fontSize: 10, fontWeight: 700,
  };
  if (v === "D") return <span style={{ ...style, background: "rgba(34,197,94,0.2)", color: "#22c55e" }}>D</span>;
  if (v === "I") return <span style={{ ...style, background: "rgba(59,130,246,0.2)", color: "#3b82f6" }}>I</span>;
  return <span style={{ ...style, color: "#334155" }}>-</span>;
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: "flex", padding: "8px 0", borderBottom: "1px solid rgba(71,85,105,0.2)", fontSize: 13 }}>
      <span style={{ width: 110, flexShrink: 0, color: "#94a3b8", fontWeight: 500 }}>{label}</span>
      <span style={{ color: "#e2e8f0", wordBreak: "break-word", lineHeight: 1.5 }}>{value}</span>
    </div>
  );
}

function DDLBlock({ ddl }: { ddl: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ marginTop: 16 }}>
      <button
        onClick={() => setOpen(!open)}
        style={{ fontSize: 12, color: "#3b82f6", cursor: "pointer", background: "none", border: "none", padding: "4px 0", fontFamily: "inherit" }}
      >
        {open ? "▼ Hide DDL" : "▶ Show DDL"}
      </button>
      {open && (
        <pre style={{
          background: "#0f172a", border: "1px solid #475569", borderRadius: 8, padding: 12,
          fontFamily: "'JetBrains Mono','Fira Code',monospace", fontSize: 11, lineHeight: 1.6,
          overflowX: "auto", whiteSpace: "pre", color: "#94a3b8", maxHeight: 200, overflowY: "auto", marginTop: 8,
        }}>
          {ddl}
        </pre>
      )}
    </div>
  );
}


/** Display user/role name. Parses 'name'@'host' format for readability. */
function UserName({ name }: { name: string }) {
  const match = name.match(/^'?([^'@]+)'?@'?([^']*)'?$/);
  if (match) {
    const [, uname, host] = match;
    const hostLabel = !host || host === "%" ? "ALL CIDR" : host.includes("/") ? host : host + "/32";
    return (
      <span style={{ display: "flex", flexDirection: "column", lineHeight: 1.3 }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: "#e2e8f0" }}>{uname}</span>
        <span style={{ fontSize: 10, color: "#64748b" }}>({hostLabel})</span>
      </span>
    );
  }
  return <span style={{ fontSize: 13, fontWeight: 600, color: "#e2e8f0" }}>{name}</span>;
}

