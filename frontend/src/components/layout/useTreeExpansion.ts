/**
 * useTreeExpansion — object-tree data + expand/collapse state for the Sidebar.
 *
 * Owns the two expanded-key sets (catalogs, and `catalog.db` composites) plus the
 * lazily-loaded `dbMap` (databases per catalog) and `objMap` (objects per
 * `catalog.db`). `toggleCat` / `toggleDb` fetch on first expand, then flip the
 * key. Collapsing (or re-expanding cached data) never refetches. Functional
 * updaters keep concurrent toggles consistent. The `setActiveTab` navigation
 * side-effect stays in the Sidebar.
 */
import { useState } from "react";
import { getDatabases, getTables } from "../../api/user";
import type { DatabaseItem, ObjectItem } from "../../types";

function toggleInSet(set: Set<string>, key: string): Set<string> {
  const next = new Set(set);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  return next;
}

export function useTreeExpansion() {
  const [expandedCats, setExpandedCats] = useState<Set<string>>(new Set());
  const [expandedDbs, setExpandedDbs] = useState<Set<string>>(new Set());
  const [dbMap, setDbMap] = useState<Record<string, DatabaseItem[]>>({});
  const [objMap, setObjMap] = useState<Record<string, ObjectItem[]>>({});

  const toggleCat = async (cat: string) => {
    if (!expandedCats.has(cat) && !dbMap[cat]) {
      const dbs = await getDatabases(cat).catch(() => []);
      setDbMap((m) => ({ ...m, [cat]: dbs }));
    }
    setExpandedCats((prev) => toggleInSet(prev, cat));
  };

  const toggleDb = async (cat: string, db: string) => {
    const key = `${cat}.${db}`;
    if (!expandedDbs.has(key) && !objMap[key]) {
      const objs = await getTables(cat, db).catch(() => []);
      setObjMap((m) => ({ ...m, [key]: objs }));
    }
    setExpandedDbs((prev) => toggleInSet(prev, key));
  };

  return { expandedCats, expandedDbs, dbMap, objMap, toggleCat, toggleDb };
}
