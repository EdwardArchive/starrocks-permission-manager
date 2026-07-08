/** Owns the wizard's reference data (spec, catalogs, databases, objects, roles, grantee suggestions) and their fetch effects. */
import { useEffect, useState } from "react";
import { getGrantSpec, getRoles, searchUsersRoles } from "../../api/admin";
import { getCatalogs, getDatabases, getTables } from "../../api/user";
import type { GrantSpec } from "../../types";

export function useGrantDataSources({
  catalog,
  database,
  granteeName,
}: {
  catalog: string;
  database: string;
  granteeName: string;
}) {
  const [spec, setSpec] = useState<GrantSpec | null>(null);
  const [granteeSuggestions, setGranteeSuggestions] = useState<{ name: string; type: string }[]>([]);
  const [catalogs, setCatalogs] = useState<string[]>([]);
  const [databases, setDatabases] = useState<string[]>([]);
  const [objects, setObjects] = useState<{ name: string; object_type: string }[]>([]);
  const [allRoles, setAllRoles] = useState<string[]>([]);

  // initial data load (mount-only — the body remounts per open)
  useEffect(() => {
    getGrantSpec().then(setSpec).catch(() => {});
    getCatalogs().then((cs) => setCatalogs(cs.map((c) => c.name))).catch(() => {});
    getRoles().then((rs) => setAllRoles(rs.map((r) => r.name))).catch(() => {});
  }, []);

  // dependent pickers
  useEffect(() => {
    if (!catalog) return;
    let cancelled = false;
    getDatabases(catalog)
      .then((ds) => { if (!cancelled) setDatabases(ds.map((d) => d.name)); })
      .catch(() => { if (!cancelled) setDatabases([]); });
    return () => { cancelled = true; };
  }, [catalog]);

  useEffect(() => {
    if (!catalog || !database) return;
    let cancelled = false;
    getTables(catalog, database)
      .then((os) => { if (!cancelled) setObjects(os); })
      .catch(() => { if (!cancelled) setObjects([]); });
    return () => { cancelled = true; };
  }, [catalog, database]);

  // grantee suggestions (debounced, custom dropdown)
  useEffect(() => {
    const t = setTimeout(() => {
      if (granteeName.length < 1) { setGranteeSuggestions([]); return; }
      searchUsersRoles(granteeName, 12)
        .then((rs) => setGranteeSuggestions(rs.filter((r) => r.type === "user" || r.type === "role").map((r) => ({ name: r.name, type: r.type }))))
        .catch(() => {});
    }, 300);
    return () => clearTimeout(t);
  }, [granteeName]);

  return { spec, catalogs, databases, objects, allRoles, granteeSuggestions };
}
