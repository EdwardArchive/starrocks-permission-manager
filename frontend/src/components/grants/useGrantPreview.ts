/** Owns the debounced live SQL preview (sql/warnings/error) plus the copy-to-clipboard action, keyed on buildRequest identity. */
import { useEffect, useState } from "react";
import { previewGrant } from "../../api/admin";
import { showToast } from "../../utils/toast";
import type { GrantRequest } from "../../types";

export function useGrantPreview(buildRequest: () => GrantRequest | null) {
  const [previewSql, setPreviewSql] = useState<string[]>([]);
  const [previewWarnings, setPreviewWarnings] = useState<string[]>([]);
  const [previewError, setPreviewError] = useState("");

  // live SQL preview (debounced)
  useEffect(() => {
    const t = setTimeout(() => {
      const req = buildRequest();
      if (!req) {
        setPreviewSql([]);
        setPreviewError("");
        setPreviewWarnings([]);
        return;
      }
      previewGrant(req)
        .then((res) => {
          setPreviewSql(res.sql);
          setPreviewWarnings([...new Set(res.warnings)]);
          setPreviewError("");
        })
        .catch((e: Error) => {
          setPreviewSql([]);
          setPreviewWarnings([]);
          setPreviewError(e.message);
        });
    }, 400);
    return () => clearTimeout(t);
  }, [buildRequest]);

  const copySql = () => {
    if (!previewSql.length) return;
    const text = previewSql.join(";\n") + ";";
    if (!navigator.clipboard) { showToast("Clipboard unavailable in this context", "warning", 3000); return; }
    navigator.clipboard.writeText(text)
      .then(() => showToast("SQL copied to clipboard", "info", 2000))
      .catch(() => showToast("Could not copy SQL", "error", 3000));
  };

  return { previewSql, previewWarnings, previewError, copySql };
}
