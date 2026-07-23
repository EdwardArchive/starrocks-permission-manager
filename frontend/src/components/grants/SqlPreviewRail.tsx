/** Right rail: live SQL preview (with high-impact badge + copy) and the session results log. */
import { C } from "../../utils/colors";
import { CheckMark, CopyIcon, CrossMark, WarnLine } from "./primitives";
import { kStyle } from "./styles";
import { renderSqlLine } from "./grantSql";
import type { ExecResult } from "./useGrantExecutor";

export default function SqlPreviewRail({
  previewSql,
  previewWarnings,
  previewError,
  dangerous,
  grantType,
  action,
  copySql,
  results,
}: {
  previewSql: string[];
  previewWarnings: string[];
  previewError: string;
  dangerous: boolean;
  grantType: "PRIVILEGE" | "ROLE";
  action: "GRANT" | "REVOKE";
  copySql: () => void;
  results: ExecResult[];
}) {
  return (
    <div style={{ width: 312, flexShrink: 0, borderLeft: `1px solid ${C.border}`, background: "#161f33", overflowY: "auto", padding: "16px 16px", display: "flex", flexDirection: "column", gap: 16 }}>
      <div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
          <span style={kStyle}>SQL preview</span>
          {dangerous && grantType === "PRIVILEGE" && action === "GRANT" && (
            <span data-testid="mp-danger-badge" style={{ fontSize: 9, fontWeight: 800, letterSpacing: "0.4px", padding: "2px 6px", borderRadius: 4, background: "#dc262633", color: "#fca5a5" }}>
              HIGH IMPACT
            </span>
          )}
          <span style={{ flex: 1 }} />
          <button
            onClick={copySql}
            data-testid="mp-copy-sql"
            disabled={!previewSql.length}
            title="Copy SQL"
            style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11, padding: "3px 9px", borderRadius: 5, border: `1px solid ${C.borderLight}`, background: "transparent", color: previewSql.length ? C.text2 : C.text3, cursor: previewSql.length ? "pointer" : "not-allowed", fontFamily: "inherit" }}
          >
            <CopyIcon /> Copy
          </button>
        </div>
        <div
          data-testid="mp-preview-sql"
          style={{ margin: 0, padding: "11px 13px", background: "#0b1120", border: `1px solid ${C.border}`, borderRadius: 8, fontSize: 12.5, lineHeight: 1.7, fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace", color: C.text1, whiteSpace: "pre-wrap", wordBreak: "break-word", minHeight: 44 }}
        >
          {previewError ? (
            <span style={{ color: "#fca5a5" }}>{previewError}</span>
          ) : previewSql.length ? (
            previewSql.map((l, i) => (
              <div key={i}>{renderSqlLine(l)}<span style={{ color: C.text3 }}>;</span></div>
            ))
          ) : (
            <span style={{ color: C.text3 }}>— complete the form to preview —</span>
          )}
        </div>
        {previewWarnings.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 8 }}>
            {previewWarnings.map((w, i) => (<WarnLine key={i}>{w}</WarnLine>))}
          </div>
        )}
      </div>

      {/* Session results log */}
      <div>
        <div style={{ ...kStyle, marginBottom: 10 }}>Results</div>
        {results.length > 0 ? (
          <div data-testid="mp-results" style={{ display: "flex", flexDirection: "column", gap: 7 }}>
            {results.map((r, i) => (
              <div key={i} data-ok={r.ok ? "true" : "false"} style={{ fontSize: 12, color: r.ok ? "#86efac" : "#fca5a5", display: "flex", gap: 6, alignItems: "flex-start" }}>
                <span style={{ flexShrink: 0, marginTop: 1 }}>{r.ok ? <CheckMark /> : <CrossMark />}</span>
                <span style={{ color: C.text2 }}>
                  {r.label}
                  {r.audit === "failed" && <span style={{ color: "#fde68a" }}> (audit failed)</span>}
                  {r.error && <span> — {r.error}</span>}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <div style={{ fontSize: 12, color: C.text3, lineHeight: 1.5 }}>Executed statements will appear here.</div>
        )}
      </div>
    </div>
  );
}
