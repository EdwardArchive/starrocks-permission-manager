/**
 * Parse a StarRocks resource-group `classifiers` JSON string into structured rules.
 *
 * Extracted verbatim from InventoryDetailPanel's SysObjectInfoPane useMemo so the
 * parsing logic is unit-testable in isolation.
 *
 * Input is the raw `classifiers` column value (a JSON array of strings like
 * `"(id=100, weight=3.0, user=alice, query_type in (SELECT))"`). Rules that carry
 * only `id`/`weight` are dropped as non-meaningful; when every rule is dropped but
 * the source array was non-empty, the group is a system default.
 */

export interface ResourceGroupClassifiers {
  /** Meaningful classifier rules (id/weight-only rules removed). */
  classifiers: Record<string, string>[];
  /** True when the source had rules but all were id/weight-only (system default group). */
  isSystemDefault: boolean;
}

export function parseResourceGroupClassifiers(
  classifiersJson: string | null | undefined,
): ResourceGroupClassifiers {
  if (!classifiersJson) return { classifiers: [], isSystemDefault: false };
  try {
    const raw: string[] = JSON.parse(classifiersJson);
    const parsed = raw.map((c) => {
      const inner = c.replace(/^\(/, "").replace(/\)$/, "");
      const result: Record<string, string> = {};
      const parts = inner.match(/[^,]+(?:\([^)]*\))?/g) || [];
      for (const part of parts) {
        const trimmed = part.trim();
        const eqIdx = trimmed.indexOf("=");
        const inIdx = trimmed.indexOf(" in ");
        if (eqIdx > 0) {
          result[trimmed.slice(0, eqIdx).trim()] = trimmed.slice(eqIdx + 1).trim();
        } else if (inIdx > 0) {
          result[trimmed.slice(0, inIdx).trim()] = trimmed.slice(inIdx + 4).trim();
        }
      }
      return result;
    });
    const meaningful = parsed.filter((clf) => Object.keys(clf).some((k) => k !== "id" && k !== "weight"));
    return { classifiers: meaningful, isSystemDefault: raw.length > 0 && meaningful.length === 0 };
  } catch { return { classifiers: [], isSystemDefault: false }; }
}
