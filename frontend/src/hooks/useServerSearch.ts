/* eslint-disable react-hooks/set-state-in-effect -- the debounce effect intentionally drives `searching`/`results` (timing-based, not render-derivable); extracted verbatim from PermissionDetailTab's file-level disable. */
/**
 * useServerSearch — debounced server-side search with cancel-on-supersede.
 *
 * Extracted from the identical blocks in Sidebar and PermissionDetailTab:
 *   - trims the query; below `minLength` chars → idle (`results: null`)
 *   - otherwise flips `searching` true immediately, then fires `searcher` after
 *     `delayMs` of quiet; the effect cleanup cancels a pending request so a
 *     superseded keystroke never hits the network
 *   - success → results; failure → `[]`; either way `searching` clears
 *   - previous results stay visible while a new search is in flight
 *
 * `results` is `null` when idle and `[]` when a search returned nothing — call
 * sites distinguish "not searching" from "no matches". `reset()` returns to idle
 * synchronously (for select / clear handlers that also blank the query).
 *
 * The searcher is held in a ref (mirrors usePolling) so swapping its identity —
 * e.g. usePermApi()'s admin/user singleton — never restarts the debounce.
 */
import { useCallback, useEffect, useRef, useState } from "react";

export interface UseServerSearchOptions {
  minLength?: number;
  delayMs?: number;
}

export interface UseServerSearchResult<T> {
  results: T[] | null;
  searching: boolean;
  reset: () => void;
}

export function useServerSearch<T>(
  query: string,
  searcher: (q: string) => Promise<T[]>,
  { minLength = 2, delayMs = 300 }: UseServerSearchOptions = {},
): UseServerSearchResult<T> {
  const [results, setResults] = useState<T[] | null>(null);
  const [searching, setSearching] = useState(false);

  const searcherRef = useRef(searcher);
  useEffect(() => {
    searcherRef.current = searcher;
  });

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < minLength) {
      setResults(null);
      setSearching(false);
      return;
    }
    setSearching(true);
    const timer = setTimeout(() => {
      searcherRef.current(trimmed)
        .then((r) => setResults(r))
        .catch(() => setResults([]))
        .finally(() => setSearching(false));
    }, delayMs);
    return () => clearTimeout(timer);
  }, [query, minLength, delayMs]);

  const reset = useCallback(() => {
    setResults(null);
    setSearching(false);
  }, []);

  return { results, searching, reset };
}
