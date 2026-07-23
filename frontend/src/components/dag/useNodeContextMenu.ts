/**
 * useNodeContextMenu — right-click "Manage privileges…" menu for the DAG.
 *
 * Grant-capable admins only (gated on `can_manage_grants`). `handleCtxManage`
 * maps the right-clicked node to a grant-wizard prefill (user/role → grantee,
 * catalog/db/table/view/mv/function → object, else open blank). Store reads use
 * `getState()` inside the callbacks so the hook has no render-path store
 * dependency. Pure extraction from DAGView — behavior identical.
 */
import { useCallback, useState } from "react";
import type { NodeMouseHandler } from "@xyflow/react";
import { useAuthStore } from "../../stores/authStore";
import { useGrantStore } from "../../stores/grantStore";
import type { DAGGraph } from "../../types";

interface CtxMenu {
  x: number;
  y: number;
  nodeId: string;
}

export function useNodeContextMenu(data: DAGGraph | null) {
  const [ctxMenu, setCtxMenu] = useState<CtxMenu | null>(null);

  const onNodeContextMenu: NodeMouseHandler = useCallback((event, node) => {
    if (!useAuthStore.getState().user?.can_manage_grants) return;
    event.preventDefault();
    const bounds = (event.currentTarget as HTMLElement).closest(".react-flow")?.getBoundingClientRect();
    setCtxMenu({
      x: event.clientX - (bounds?.left ?? 0),
      y: event.clientY - (bounds?.top ?? 0),
      nodeId: node.id,
    });
  }, []);

  const handleCtxManage = useCallback(() => {
    const dagNode = data?.nodes.find((n) => n.id === ctxMenu?.nodeId);
    setCtxMenu(null);
    if (!dagNode) return;
    const t = dagNode.type.toLowerCase();
    const openWizard = useGrantStore.getState().openWizard;
    if (t === "user" || t === "role") {
      openWizard({ grantee: { name: dagNode.label, type: t === "role" ? "ROLE" : "USER" } });
    } else if (["catalog", "database", "table", "view", "mv", "function"].includes(t)) {
      const meta = (dagNode.metadata ?? {}) as { catalog?: string; database?: string };
      openWizard({
        object: {
          object_type: t === "mv" ? "MATERIALIZED VIEW" : t.toUpperCase(),
          catalog: t === "catalog" ? dagNode.label : (meta.catalog ?? "default_catalog"),
          database: t === "catalog" ? null : t === "database" ? dagNode.label : meta.database,
          name: ["catalog", "database"].includes(t) ? null : dagNode.label,
        },
      });
    } else {
      // group/system nodes — open without prefill rather than doing nothing
      openWizard();
    }
  }, [data, ctxMenu]);

  return { ctxMenu, setCtxMenu, onNodeContextMenu, handleCtxManage };
}
