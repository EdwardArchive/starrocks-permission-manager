/** Owns the wizard's form-field state (initialized from the store prefill) plus buildRequest and the derived flags. */
import { useCallback, useState } from "react";
import { useAuthStore } from "../../stores/authStore";
import { useGrantStore } from "../../stores/grantStore";
import { bareUser } from "../../utils/grantHelpers";
import type { GrantRequest } from "../../types";

export function useGrantForm() {
  const prefill = useGrantStore((s) => s.prefill);
  const currentUser = useAuthStore((s) => s.user?.username ?? "");

  // form state (initialized from the contextual prefill)
  const [action, setAction] = useState<"GRANT" | "REVOKE">(prefill?.action ?? "GRANT");
  const [grantType, setGrantType] = useState<"PRIVILEGE" | "ROLE">("PRIVILEGE");
  const [granteeName, setGranteeName] = useState(prefill?.grantee?.name ?? "");
  const [granteeType, setGranteeType] = useState<"USER" | "ROLE">(prefill?.grantee?.type ?? "USER");
  const [objectType, setObjectType] = useState(prefill?.object?.object_type ?? "TABLE");
  const [catalog, setCatalog] = useState(prefill?.object?.catalog ?? "default_catalog");
  const [database, setDatabase] = useState(prefill?.object?.database ?? "");
  const [objName, setObjName] = useState(prefill?.object?.name ?? "");
  const [privileges, setPrivileges] = useState<Set<string>>(new Set(prefill?.privileges ?? []));
  const [withGrantOption, setWithGrantOption] = useState(false);
  const [role, setRole] = useState("");
  const [keepOpen, setKeepOpen] = useState(false);

  const buildRequest = useCallback((): GrantRequest | null => {
    if (!granteeName.trim()) return null;
    const grantee = { name: granteeName.trim(), type: granteeType };
    if (grantType === "ROLE") {
      if (!role.trim()) return null;
      return { action, type: "ROLE", grantee, role: role.trim() };
    }
    if (privileges.size === 0 || !catalog.trim()) return null;
    const needsDb = objectType !== "CATALOG";
    const needsName = !["CATALOG", "DATABASE"].includes(objectType);
    if (needsDb && !database.trim()) return null;
    if (needsName && !objName.trim()) return null;
    return {
      action,
      type: "PRIVILEGE",
      grantee,
      object: {
        object_type: objectType,
        catalog: catalog.trim(),
        database: needsDb ? database.trim() : null,
        name: needsName ? objName.trim() : null,
      },
      privileges: [...privileges],
      // StarRocks has no `REVOKE ... WITH GRANT OPTION`; never send it on a revoke
      with_grant_option: action === "GRANT" ? withGrantOption : false,
    };
  }, [action, grantType, granteeName, granteeType, role, objectType, catalog, database, objName, privileges, withGrantOption]);

  const needsDb = objectType !== "CATALOG";
  const needsName = !["CATALOG", "DATABASE"].includes(objectType);
  const selfRevoke = action === "REVOKE" && granteeType === "USER" && bareUser(granteeName) === currentUser;
  const dangerous = withGrantOption || privileges.has("ALL");

  return {
    action, setAction,
    grantType, setGrantType,
    granteeName, setGranteeName,
    granteeType, setGranteeType,
    objectType, setObjectType,
    catalog, setCatalog,
    database, setDatabase,
    objName, setObjName,
    privileges, setPrivileges,
    withGrantOption, setWithGrantOption,
    role, setRole,
    keepOpen, setKeepOpen,
    needsDb, needsName,
    buildRequest,
    selfRevoke, dangerous,
  };
}
