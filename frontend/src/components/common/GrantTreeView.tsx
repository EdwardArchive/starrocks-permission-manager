/**
 * Shared component for rendering privilege grants in a consistent scope-grouped tree.
 * Used by ObjectDetailPanel, UserDetailPanel, PermissionDetailTab, MyPermissionsTab.
 */

import InlineIcon from "./InlineIcon";
import { getPrivColor } from "../../utils/privColors";
import type { GrantDisplayGroup } from "../../utils/grantDisplay";

interface Props {
  groups: GrantDisplayGroup[];
  title?: string;
  totalGrants?: number;
  sourceRoles?: string[];  // "Inherited from" roles to display
}

export default function GrantTreeView({ groups, title, totalGrants, sourceRoles }: Props) {
  return (
    <div style={{ minWidth: 0, overflow: "hidden" }}>
      {/* Title */}
      {title && (
        <p style={{ fontSize: 13, fontWeight: 600, color: "#94a3b8", marginBottom: 8, whiteSpace: "nowrap" }}>
          {title}{totalGrants != null && ` (${totalGrants} grants)`}
        </p>
      )}

      {/* Inherited from roles */}
      {sourceRoles && sourceRoles.length > 0 && (
        <>
          <p style={{ fontSize: 12, color: "#64748b", marginBottom: 6 }}>Inherited from</p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 14 }}>
            {sourceRoles.map((r) => (
              <span key={r} style={{ padding: "3px 8px", borderRadius: 6, fontSize: 11, fontWeight: 500, background: "rgba(249,115,22,0.15)", color: "#f97316" }}>{r}</span>
            ))}
          </div>
        </>
      )}

      {/* No data */}
      {groups.length === 0 && (
        <p style={{ fontSize: 13, color: "#64748b", fontStyle: "italic", textAlign: "center", padding: 16 }}>
          No grants found
        </p>
      )}

      {/* Scope groups */}
      {groups.map(({ scope, icon, items }) => (
        <div key={scope} style={{ marginBottom: 12 }}>
          {/* Scope header */}
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4, fontSize: 12, fontWeight: 600, color: "#94a3b8", whiteSpace: "nowrap" }}>
            <InlineIcon type={icon} size={14} />
            {scope}
            <span style={{ fontSize: 10, color: "#64748b" }}>({items.length})</span>
          </div>

          {/* Items */}
          {items.map((obj, idx) => (
            <div key={`${obj.displayName}-${idx}`} style={{ padding: "6px 0 6px 20px", borderBottom: "1px solid rgba(71,85,105,0.15)", fontSize: 12 }}>
              <div style={{ fontWeight: 500, color: "#e2e8f0", marginBottom: 3, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                {obj.displayName}
              </div>
              {obj.context && (
                <div style={{ fontSize: 10, color: "#64748b", marginBottom: 3 }}>{obj.context}</div>
              )}
              <div style={{ display: "flex", gap: 3, flexWrap: "wrap" }}>
                {obj.privs.map((p) => {
                  const c = getPrivColor(p);
                  return (
                    <span key={p} style={{
                      padding: "2px 6px", borderRadius: 4, fontSize: 10, fontWeight: 600,
                      background: c.bg, color: c.fg, whiteSpace: "nowrap", lineHeight: 1.4,
                    }}>
                      {p}
                    </span>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
