/** Owns the grantee's current grants (debounced fetch with the user@host retry) plus the direct/scope/inherited/already-granted derivations. */
import { useEffect, useMemo, useState } from "react";
import { getRolePrivileges, getUserPrivileges } from "../../api/admin";
import { OBJECT_TYPE_ORDER, grantMatchesObject, isRevocableRow } from "../../utils/grantHelpers";
import type { PrivilegeGrant } from "../../types";

export function useGranteeGrants({
  granteeName,
  granteeType,
  objectType,
  catalog,
  database,
  objName,
}: {
  granteeName: string;
  granteeType: "USER" | "ROLE";
  objectType: string;
  catalog: string;
  database: string;
  objName: string;
}) {
  const [granteeGrants, setGranteeGrants] = useState<PrivilegeGrant[] | null>(null);
  const [grantsTick, setGrantsTick] = useState(0); // bump to refetch grantee grants

  // load the grantee's privileges — powers the revoke helper AND already-granted badges
  useEffect(() => {
    const t = setTimeout(async () => {
      if (!granteeName) { setGranteeGrants(null); return; }
      const fetcher = granteeType === "USER" ? getUserPrivileges : getRolePrivileges;
      try {
        let grants = await fetcher(granteeName);
        // sys tables store user grantees as 'name'@'host' — retry bare names in that form
        if (grants.length === 0 && granteeType === "USER" && !granteeName.includes("@")) {
          grants = await fetcher(`'${granteeName}'@'%'`);
        }
        setGranteeGrants(grants);
      } catch {
        setGranteeGrants([]);
      }
    }, 400);
    return () => clearTimeout(t);
  }, [granteeName, granteeType, grantsTick]);

  const directGrants = useMemo(
    () => (granteeGrants ?? []).filter((g) => g.source === "direct" && isRevocableRow(g)),
    [granteeGrants]
  );
  // direct but wildcard/scope grants — shown for context, not selectable
  const scopeGrants = useMemo(
    () =>
      (granteeGrants ?? []).filter(
        (g) => g.source === "direct" && OBJECT_TYPE_ORDER.includes(g.object_type) && !isRevocableRow(g)
      ),
    [granteeGrants]
  );
  const inheritedGrants = useMemo(
    () => (granteeGrants ?? []).filter((g) => g.source !== "direct" && OBJECT_TYPE_ORDER.includes(g.object_type)),
    [granteeGrants]
  );

  // privileges the grantee already holds on the currently selected object
  const alreadyGranted = useMemo(() => {
    const set = new Set<string>();
    // "already granted" is only meaningful once the object is fully specified.
    // An empty field would otherwise match db-wide/wildcard grants (null object_name),
    // spuriously flagging privileges as held (and, in revoke, enabling them).
    const needsDbSel = objectType !== "CATALOG";
    const needsNameSel = !["CATALOG", "DATABASE"].includes(objectType);
    if (!catalog.trim() || (needsDbSel && !database.trim()) || (needsNameSel && !objName.trim())) return set;
    for (const g of granteeGrants ?? []) {
      if (grantMatchesObject(g, objectType, catalog.trim(), database.trim(), objName.trim())) {
        set.add(g.privilege_type);
      }
    }
    return set;
  }, [granteeGrants, objectType, catalog, database, objName]);

  const refetch = () => setGrantsTick((x) => x + 1);

  return { granteeGrants, directGrants, scopeGrants, inheritedGrants, alreadyGranted, refetch };
}
