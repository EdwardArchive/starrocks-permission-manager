/** Shared formatting helpers for the cluster query panels. */

export function fmtRows(n: number | null): string {
  if (n == null) return "—";
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return String(n);
}

export function fmtBytes(n: number | null): string {
  if (n == null) return "—";
  const u = ["B", "KB", "MB", "GB", "TB", "PB"];
  let v = n;
  let i = 0;
  while (v >= 1024 && i < u.length - 1) {
    v /= 1024;
    i++;
  }
  return `${i === 0 ? v : v.toFixed(2)} ${u[i]}`;
}

/** Milliseconds → "350 ms" / "2.1 s" / "1m 5s". */
export function fmtDurationMs(ms: number | null): string {
  if (ms == null) return "—";
  if (ms < 1000) return `${Math.round(ms)} ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(s < 10 ? 2 : 1)} s`;
  const m = Math.floor(s / 60);
  return `${m}m ${Math.round(s - m * 60)}s`;
}

/**
 * CPU share as a % of total cluster cores. `cores` is "average cores kept
 * busy" (cumulative or instantaneous). Falls back to a "×cores" multiplier
 * when the cluster core count is unknown (e.g. limited mode).
 */
export function fmtCpuShare(cores: number | null, totalCores: number | null): string {
  if (cores == null) return "—";
  if (totalCores && totalCores > 0) return `${((cores / totalCores) * 100).toFixed(1)}%`;
  return `×${cores.toFixed(1)}`;
}
