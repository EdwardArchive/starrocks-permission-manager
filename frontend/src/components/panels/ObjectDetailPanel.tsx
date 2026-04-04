import { useEffect, useState } from "react";
import { useDagStore } from "../../stores/dagStore";
import { getObjectPrivileges, getRolePrivileges, getTableDetail } from "../../api/user";
import GrantTreeView from "../common/GrantTreeView";
import { buildGrantDisplay, extractSourceRoles } from "../../utils/grantDisplay";
import { PermissionMatrixView } from "../tabs/PermissionMatrix";
import { formatBytes } from "../../utils/inventory-helpers";
import { C } from "../../utils/colors";
import type { PrivilegeGrant, TableDetail } from "../../types";

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
    const srObjectType = nodeType === "mv" ? "MATERIALIZED VIEW" : nodeType.toUpperCase();

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedNode]);

  useEffect(() => {
    if (tab !== "details" || !selectedNode) return;
    if (data.detail) return;
    if (!parsed.catalog || !parsed.database || !parsed.name) return;
    setData((prev) => ({ ...prev, loadingDetail: true }));
    getTableDetail(parsed.catalog, parsed.database, parsed.name)
      .then((detail) => setData((prev) => ({ ...prev, detail, loadingDetail: false })))
      .catch(() => setData((prev) => ({ ...prev, loadingDetail: false })));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, selectedNode]);

  if (!selectedNode) return null;

  const { grants, detail, loadedNodeId, loadingPrivs, loadingDetail } = data;
  const color = selectedNode.color || C.text2;
  const isRole = selectedNode.type.toLowerCase() === "role";
  const nodeType = selectedNode.type.toLowerCase();
  const srObjectType = nodeType === "mv" ? "MATERIALIZED VIEW" : nodeType.toUpperCase();


  // Path display
  const pathParts = nodeType === "catalog" ? [selectedNode.label]
    : nodeType === "database" ? [parsed.catalog, selectedNode.label].filter(Boolean)
    : nodeType === "system" ? ["SYSTEM"]
    : [parsed.catalog, parsed.database, parsed.name || selectedNode.label].filter(Boolean);

  return (
    <div>
      {/* Object path */}
      <div style={{ fontSize: 12, color: C.text2, marginBottom: 12, wordBreak: "break-all", lineHeight: 1.6 }}>
        {pathParts.map((p, i) => (
          <span key={i}>
            {i > 0 && <span style={{ color: C.borderLight, margin: "0 3px" }}>/</span>}
            <span style={i === pathParts.length - 1 ? { color: C.text1, fontWeight: 500 } : undefined}>{p}</span>
          </span>
        ))}
      </div>

      {/* Type badge */}
      <span style={{ display: "inline-block", padding: "4px 10px", borderRadius: 6, fontSize: 12, fontWeight: 500, marginBottom: 16, background: `${color}20`, color }}>
        {selectedNode.type.toUpperCase()}
      </span>

      {/* Tabs */}
      <div style={{ display: "flex", gap: 0, borderBottom: `1px solid ${C.borderLight}`, marginBottom: 16 }}>
        {(["privileges", "details"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            style={{
              padding: "8px 14px", fontSize: 12, fontWeight: 500, cursor: "pointer",
              color: tab === t ? C.accent : C.text2,
              border: "none", borderBottom: `2px solid ${tab === t ? C.accent : "transparent"}`,
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
            <p style={{ fontSize: 13, color: C.text2, fontStyle: "italic" }}>Loading...</p>
          ) : grants.length === 0 ? (
            <p style={{ fontSize: 13, color: C.text2, fontStyle: "italic" }}>No grants found</p>
          ) : isRole ? (
            <GrantTreeView
              groups={buildGrantDisplay(grants)}
              title="Role Privileges"
              totalGrants={grants.length}
              sourceRoles={extractSourceRoles(grants)}
            />
          ) : (
            <PermissionMatrixView
              grants={grants}
              objectType={srObjectType}
            />
          )}
        </div>
      )}

      {tab === "details" && (
        <div style={{ fontSize: 13 }}>
          {loadingDetail ? (
            <p style={{ color: C.text2, fontStyle: "italic" }}>Loading details...</p>
          ) : !detail ? (
            <p style={{ color: C.text2, fontStyle: "italic" }}>
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
                  <p style={{ fontWeight: 600, color: C.text2, marginTop: 16, marginBottom: 8 }}>
                    Columns ({detail.columns.length})
                  </p>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
                    <thead>
                      <tr style={{ borderBottom: `1px solid ${C.borderLight}` }}>
                        <th style={{ textAlign: "left", padding: 4, color: C.text2 }}>Name</th>
                        <th style={{ textAlign: "left", padding: 4, color: C.text2 }}>Type</th>
                        <th style={{ textAlign: "center", padding: 4, color: C.text2 }}>Key</th>
                        <th style={{ textAlign: "center", padding: 4, color: C.text2 }}>Null</th>
                      </tr>
                    </thead>
                    <tbody>
                      {detail.columns.map((c) => (
                        <tr key={c.name} style={{ borderBottom: "1px solid rgba(71,85,105,0.2)" }}>
                          <td style={{ padding: 4 }}>{c.name}</td>
                          <td style={{ padding: 4, color: C.text2 }}>{c.column_type}</td>
                          <td style={{ padding: 4, textAlign: "center", color: "#f59e0b", fontSize: 10, fontWeight: 700 }}>{c.column_key || ""}</td>
                          <td style={{ padding: 4, textAlign: "center", color: "#22c55e", fontSize: 10 }}>{c.is_nullable === "YES" ? "Y" : ""}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </>
              )}

              {detail.ddl && <DDLBlock ddl={detail.ddl} />}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: "flex", padding: "8px 0", borderBottom: "1px solid rgba(71,85,105,0.2)", fontSize: 13 }}>
      <span style={{ width: 110, flexShrink: 0, color: C.text2, fontWeight: 500 }}>{label}</span>
      <span style={{ color: C.text1, wordBreak: "break-word", lineHeight: 1.5 }}>{value}</span>
    </div>
  );
}

function DDLBlock({ ddl }: { ddl: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ marginTop: 16 }}>
      <button
        onClick={() => setOpen(!open)}
        style={{ fontSize: 12, color: C.accent, cursor: "pointer", background: "none", border: "none", padding: "4px 0", fontFamily: "inherit" }}
      >
        {open ? "▼ Hide DDL" : "▶ Show DDL"}
      </button>
      {open && (
        <pre style={{
          background: C.bg, border: `1px solid ${C.borderLight}`, borderRadius: 8, padding: 12,
          fontFamily: "'JetBrains Mono','Fira Code',monospace", fontSize: 11, lineHeight: 1.6,
          overflowX: "auto", whiteSpace: "pre", color: C.text2, maxHeight: 200, overflowY: "auto", marginTop: 8,
        }}>
          {ddl}
        </pre>
      )}
    </div>
  );
}
