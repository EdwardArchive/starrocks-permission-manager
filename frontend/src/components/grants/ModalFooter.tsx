/** Sticky footer: keep-open toggle + Cancel/Execute, flipping to the confirm step (with self-revoke lockout warning). */
import type { Dispatch, SetStateAction } from "react";
import { C } from "../../utils/colors";
import { WarnLine } from "./primitives";

export default function ModalFooter({
  confirming,
  setConfirming,
  executing,
  selfRevoke,
  action,
  modeColor,
  handleExecute,
  canExecute,
  keepOpen,
  setKeepOpen,
  closeWizard,
}: {
  confirming: boolean;
  setConfirming: Dispatch<SetStateAction<boolean>>;
  executing: boolean;
  selfRevoke: boolean;
  action: "GRANT" | "REVOKE";
  modeColor: string;
  handleExecute: () => void;
  canExecute: boolean;
  keepOpen: boolean;
  setKeepOpen: Dispatch<SetStateAction<boolean>>;
  closeWizard: () => void;
}) {
  return (
    <div style={{ flexShrink: 0, borderTop: `1px solid ${C.border}`, background: "#1b2438", padding: confirming ? 14 : "13px 20px" }}>
      {confirming ? (
        <div>
          <div style={{ fontSize: 13, color: C.text1, marginBottom: 8 }}>
            Execute the previewed SQL against the cluster? StarRocks may still deny the operation based on your actual privileges.
          </div>
          {selfRevoke && (
            <div data-testid="mp-self-revoke-warning" style={{ marginBottom: 8 }}>
              <WarnLine color="#fca5a5">
                You are revoking from <strong>yourself</strong>. Removing your own user_admin role will lock you out of this feature.
              </WarnLine>
            </div>
          )}
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <button onClick={() => setConfirming(false)} disabled={executing} style={{ padding: "7px 16px", background: "transparent", border: `1px solid ${C.borderLight}`, borderRadius: 6, color: C.text2, fontSize: 13, cursor: "pointer", fontFamily: "inherit" }}>Back</button>
            <button
              data-testid="mp-confirm"
              onClick={handleExecute}
              disabled={executing}
              style={{ padding: "7px 16px", background: modeColor, border: "none", borderRadius: 6, color: "#fff", fontSize: 13, fontWeight: 500, cursor: executing ? "wait" : "pointer", fontFamily: "inherit" }}
            >
              {executing ? "Executing…" : `Confirm & ${action === "REVOKE" ? "Revoke" : "Grant"}`}
            </button>
          </div>
        </div>
      ) : (
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", alignItems: "center" }}>
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: C.text2, marginRight: "auto", cursor: "pointer" }}>
            <input type="checkbox" data-testid="mp-keep-open" checked={keepOpen} onChange={(e) => setKeepOpen(e.target.checked)} style={{ accentColor: C.accent, cursor: "pointer" }} />
            Keep open after execute
          </label>
          <button data-testid="mp-cancel" onClick={closeWizard} style={{ padding: "8px 18px", background: "transparent", border: `1px solid ${C.borderLight}`, borderRadius: 6, color: C.text2, fontSize: 13, cursor: "pointer", fontFamily: "inherit" }}>Cancel</button>
          <button
            data-testid="mp-execute"
            onClick={() => setConfirming(true)}
            disabled={!canExecute}
            style={{
              padding: "8px 18px", borderRadius: 6, fontSize: 13, fontWeight: 500, fontFamily: "inherit",
              background: canExecute ? modeColor : C.borderLight, color: canExecute ? "#fff" : C.text3,
              border: "none", cursor: canExecute ? "pointer" : "not-allowed",
            }}
          >
            Execute
          </button>
        </div>
      )}
    </div>
  );
}
