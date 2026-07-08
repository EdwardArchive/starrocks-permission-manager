import { useDagStore } from "../../stores/dagStore";
import { useAuthStore } from "../../stores/authStore";
import { useGrantStore } from "../../stores/grantStore";
import { getUserEffectivePrivileges } from "../../api/user";
import InlineIcon from "../common/InlineIcon";
import GrantTreeView from "../common/GrantTreeView";
import { C } from "../../utils/colors";
import { buildGrantDisplay, extractSourceRoles } from "../../utils/grantDisplay";
import { useAsyncData } from "../../hooks/useAsyncData";

export default function UserDetailPanel() {
  const selectedNode = useDagStore((s) => s.selectedNode);
  const canManageGrants = useAuthStore((s) => s.user?.can_manage_grants ?? false);
  const openWizard = useGrantStore((s) => s.openWizard);
  const { data, loading } = useAsyncData(
    () => getUserEffectivePrivileges(selectedNode!.label),
    [selectedNode],
    { enabled: !!selectedNode },
  );

  if (!selectedNode) return null;

  const grants = data ?? [];
  const groups = buildGrantDisplay(grants);
  const sourceRoles = extractSourceRoles(grants);

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
        <InlineIcon type="user" size={18} />
        <h3 style={{ fontSize: 15, fontWeight: 600, margin: 0 }}>{selectedNode.label}</h3>
        {canManageGrants && (
          <button
            data-testid="panel-manage-btn"
            onClick={() =>
              openWizard({
                grantee: {
                  name: selectedNode.label,
                  type: selectedNode.type.toUpperCase() === "ROLE" ? "ROLE" : "USER",
                },
              })
            }
            style={{ marginLeft: "auto", padding: "3px 10px", fontSize: 11, borderRadius: 6, border: `1px solid ${C.accent}`, background: "transparent", color: C.accent, cursor: "pointer", fontFamily: "inherit" }}
          >
            ⚙ Manage…
          </button>
        )}
      </div>
      <p style={{ fontSize: 12, color: C.text2, marginBottom: 14 }}>
        {(() => {
          const m = selectedNode.label.match(/^'?([^'@]+)'?@'?([^']*)'?$/);
          if (m) {
            const host = m[2];
            const hostLabel = !host || host === "%" ? "ALL CIDR" : host.includes("/") ? host : host + "/32";
            return <>{m[1]} <span style={{ color: C.text3 }}>({hostLabel})</span></>;
          }
          return selectedNode.label;
        })()}
      </p>

      {loading ? (
        <p style={{ fontSize: 13, color: C.text2, fontStyle: "italic" }}>Loading...</p>
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
