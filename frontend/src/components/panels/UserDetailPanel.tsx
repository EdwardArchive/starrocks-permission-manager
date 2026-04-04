import { useEffect, useState } from "react";
import { useDagStore } from "../../stores/dagStore";
import { getUserEffectivePrivileges } from "../../api/user";
import InlineIcon from "../common/InlineIcon";
import GrantTreeView from "../common/GrantTreeView";
import { buildGrantDisplay, extractSourceRoles } from "../../utils/grantDisplay";
import type { PrivilegeGrant } from "../../types";

export default function UserDetailPanel() {
  const { selectedNode } = useDagStore();
  const [state, setState] = useState<{ grants: PrivilegeGrant[]; loading: boolean; loadedNodeId: string | null }>({
    grants: [], loading: false, loadedNodeId: null,
  });

  useEffect(() => {
    if (!selectedNode) return;
    const nodeId = selectedNode.id;
    getUserEffectivePrivileges(selectedNode.label)
      .then((data) => setState({ grants: data, loading: false, loadedNodeId: nodeId }))
      .catch(() => setState((prev) => ({ ...prev, loading: false, loadedNodeId: nodeId })));
    return () => setState({ grants: [], loading: true, loadedNodeId: null });
  }, [selectedNode]);

  if (!selectedNode) return null;

  const { grants, loading, loadedNodeId } = state;
  const groups = buildGrantDisplay(grants);
  const sourceRoles = extractSourceRoles(grants);

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

      {(loading || loadedNodeId !== selectedNode?.id) ? (
        <p style={{ fontSize: 13, color: "#94a3b8", fontStyle: "italic" }}>Loading...</p>
      ) : (
        <GrantTreeView
          groups={groups}
          title="Effective Privileges"
          totalGrants={grants.length}
          sourceRoles={sourceRoles}
        />
      )}
    </div>
  );
}
