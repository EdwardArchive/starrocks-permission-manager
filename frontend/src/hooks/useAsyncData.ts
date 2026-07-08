/**
 * useAsyncData — shared fetch/loading/error triad for detail panels and panes.
 *
 * Replaces the copy-pasted pattern:
 *   const [state, setState] = useState({ data, loading });
 *   useEffect(() => { fetcher().then(...).catch(...); }, deps);
 *
 * Semantics:
 * - Deps change → result is invalidated *during render* (same-frame `loading`,
 *   like the `loadedNodeId` render-time guards this replaces), then refetched.
 * - Stale responses are dropped: a settle only lands if its effect run is still
 *   the latest (no state updates after unmount or after deps changed).
 * - Errors are captured (`error`), `data` goes null, `loading` false — call
 *   sites keep rendering their empty states exactly as before.
 * - `enabled: false` → idle (no fetch, `loading` false).
 * - `keepPreviousData: true` → previous `data` is returned while a refetch is
 *   in flight (stale-display sites); default returns null during refetch.
 */
import { useEffect, useState } from "react";
import type { DependencyList } from "react";

export interface UseAsyncDataOptions {
  /** When false, stay idle: no fetch, `loading` false. Default true. */
  enabled?: boolean;
  /** When true, keep returning the previous data while a refetch is in flight. Default false. */
  keepPreviousData?: boolean;
}

export interface UseAsyncDataResult<T> {
  data: T | null;
  loading: boolean;
  error: unknown;
}

/** Settled result cell. `key` is the deps snapshot the result belongs to; null = no current result. */
interface Cell<T> {
  key: DependencyList | null;
  data: T | null;
  error: unknown;
}

function sameDeps(a: DependencyList, b: DependencyList): boolean {
  return a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
}

export function useAsyncData<T>(
  fetcher: () => Promise<T>,
  deps: DependencyList,
  { enabled = true, keepPreviousData = false }: UseAsyncDataOptions = {},
): UseAsyncDataResult<T> {
  const [cell, setCell] = useState<Cell<T>>({ key: null, data: null, error: null });

  // Deps changed since the settled result → invalidate now, during render, so
  // `loading` flips in the same frame (React's documented "adjusting state when
  // props change" pattern). Guarded: runs at most once per deps change.
  if (cell.key !== null && !sameDeps(cell.key, deps)) {
    setCell({ key: null, data: cell.data, error: null });
  }

  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    fetcher()
      .then((data) => { if (alive) setCell({ key: deps, data, error: null }); })
      .catch((error: unknown) => { if (alive) setCell({ key: deps, data: null, error }); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- caller-provided deps drive the fetch; `fetcher` is intentionally excluded (inline closures change identity every render)
  }, [enabled, ...deps]);

  const current = cell.key !== null && sameDeps(cell.key, deps);
  return {
    data: current || keepPreviousData ? cell.data : null,
    loading: enabled && !current,
    error: current ? cell.error : null,
  };
}
