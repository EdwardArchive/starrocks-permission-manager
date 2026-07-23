/** Owns the confirm/execute lifecycle: runs the built requests, logs results, fires audit/toast + refresh, and closes or resets on keep-open. */
import { useState } from "react";
import { executeGrant } from "../../api/admin";
import { useGrantStore } from "../../stores/grantStore";
import { showToast } from "../../utils/toast";
import type { GrantRequest } from "../../types";

export interface ExecResult {
  label: string;
  ok: boolean;
  audit?: "ok" | "failed";
  error?: string;
}

export function useGrantExecutor({
  buildRequest,
  action,
  keepOpen,
  onKeepOpenReset,
}: {
  buildRequest: () => GrantRequest | null;
  action: "GRANT" | "REVOKE";
  keepOpen: boolean;
  onKeepOpenReset: () => void;
}) {
  const closeWizard = useGrantStore((s) => s.closeWizard);
  const bumpRefresh = useGrantStore((s) => s.bumpRefresh);

  const [confirming, setConfirming] = useState(false);
  const [executing, setExecuting] = useState(false);
  const [results, setResults] = useState<ExecResult[]>([]);

  const runRequests = async (reqs: GrantRequest[]) => {
    setExecuting(true);
    const newResults: ExecResult[] = [];
    let anyOk = false;
    for (const req of reqs) {
      const label =
        req.type === "ROLE"
          ? `${req.action} role ${req.role} ${req.action === "GRANT" ? "to" : "from"} ${req.grantee.name}`
          : `${req.action} ${(req.privileges ?? []).join(", ")} on ${[req.object?.database, req.object?.name].filter(Boolean).join(".")}`;
      try {
        const res = await executeGrant(req);
        newResults.push({ label, ok: true, audit: res.audit });
        anyOk = true;
      } catch (e) {
        newResults.push({ label, ok: false, error: e instanceof Error ? e.message : String(e) });
      }
    }
    setExecuting(false);
    setConfirming(false);
    setResults((prev) => [...prev, ...newResults]);
    if (anyOk) bumpRefresh();
    if (newResults.some((r) => r.audit === "failed")) {
      showToast("Executed, but some audit records could not be written (check srpm_audit setup)", "warning", 8000);
    }
    const allOk = newResults.every((r) => r.ok);
    if (allOk && !keepOpen) {
      showToast(`${action} executed successfully`, "info", 4000);
      closeWizard();
      return;
    }
    // keep-open: stay, refresh grantee grants, reset transient parts
    onKeepOpenReset();
  };

  const handleExecute = () => {
    const req = buildRequest();
    if (!req) return;
    void runRequests([req]);
  };

  return { confirming, setConfirming, executing, results, handleExecute };
}
