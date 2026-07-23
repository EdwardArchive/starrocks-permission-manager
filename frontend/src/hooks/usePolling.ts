/**
 * usePolling — shared recurring-poll loop with the app-wide conventions:
 * periodic ticks are skipped while the page is hidden (`document.hidden`),
 * the loop restarts when `enabled` / `intervalMs` change, and the latest
 * `fn` is always invoked without restarting the timer (callers don't need
 * useCallback gymnastics).
 *
 * Consciously excluded concerns (do not "fix" these here):
 * - The `immediate` call fires on (re)start regardless of `document.hidden`;
 *   only periodic ticks are hidden-guarded.
 * - Request cancellation (AbortController) stays caller-side, inside each
 *   site's fetch function — the hook never aborts anything.
 * - Sites whose first fetch differs from their tick (spinner vs quiet,
 *   extra guards like deniedRef, extra restart deps like errorsOnly) keep
 *   their own immediate+abort effect and use this hook for ticks only.
 */
import { useEffect, useRef, useState } from "react";

export interface UsePollingOptions {
  /** Master switch — false clears the timer and suppresses `immediate`. */
  enabled?: boolean;
  /** Call `fn` once on (re)start, before the first interval elapses. */
  immediate?: boolean;
}

export function usePolling(
  fn: () => void | Promise<void>,
  intervalMs: number,
  { enabled = true, immediate = false }: UsePollingOptions = {},
): void {
  const fnRef = useRef(fn);
  useEffect(() => {
    fnRef.current = fn;
  });

  useEffect(() => {
    if (!enabled) return;
    if (immediate) void fnRef.current();
    if (intervalMs <= 0) return;
    const id = setInterval(() => {
      if (document.hidden) return;
      void fnRef.current();
    }, intervalMs);
    return () => clearInterval(id);
  }, [enabled, immediate, intervalMs]);
}

/**
 * useTickerNow — a `Date.now()` timestamp refreshed every `intervalMs`
 * (default 1s), for "updated Xs ago" style labels. Ticks follow usePolling
 * semantics (skipped while the page is hidden; the value catches up on the
 * first visible tick).
 */
export function useTickerNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  usePolling(() => setNow(Date.now()), intervalMs);
  return now;
}
