/** Parse a naive "YYYY-MM-DD HH:MM:SS" (or ISO) timestamp as if it were UTC. */
function parseAsUtc(input: string): Date {
  let normalized = input;
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(input)) {
    normalized = input.replace(" ", "T") + "Z";
  }
  return new Date(normalized);
}

/**
 * Clock skew (ms) between the cluster's wall clock and the browser, derived
 * from the `server_now` field of a cluster API response at receive time.
 *
 * StarRocks SHOW commands return naive timestamps in the *cluster's* timezone
 * (not necessarily UTC). Parsing both `server_now` and node timestamps with
 * the same as-if-UTC rule makes the timezone offset cancel out in diffs, so
 * `formatRelativeTime(ts, skewedNow(skew))` is correct regardless of zone.
 * Returns null when server_now is missing/unparseable (fall back to browser clock).
 */
export function clockSkewMs(serverNow: string | null | undefined): number | null {
  if (!serverNow) return null;
  const d = parseAsUtc(serverNow);
  if (isNaN(d.getTime())) return null;
  return d.getTime() - Date.now();
}

/** Reference "now" for formatRelativeTime, corrected by clockSkewMs(). */
export function skewedNow(skewMs: number | null): Date {
  return skewMs == null ? new Date() : new Date(Date.now() + skewMs);
}

/**
 * Format an absolute timestamp (ISO 8601 or "YYYY-MM-DD HH:MM:SS") as
 * relative time like "2 minutes ago", "3 days ago", or "just now".
 * Returns an empty string for null/undefined/invalid input.
 *
 * **UTC assumption**: Space-separated timestamps (e.g. `"2026-04-19 10:00:00"`)
 * are assumed to be UTC. StarRocks returns them in the *cluster's* timezone,
 * which may differ from the browser's — pass `now = skewedNow(clockSkewMs(server_now))`
 * (from the cluster API response) to cancel the offset; with the default
 * browser-clock `now`, labels are wrong by the TZ difference.
 */
export function formatRelativeTime(
  input: string | null | undefined,
  now: Date = new Date(),
): string {
  if (input == null || input === "") return "";

  const date = parseAsUtc(input);
  if (isNaN(date.getTime())) return "";

  const diffMs = now.getTime() - date.getTime();
  const isFuture = diffMs < 0;
  const absMs = Math.abs(diffMs);

  const seconds = Math.floor(absMs / 1000);
  const minutes = Math.floor(absMs / (1000 * 60));
  const hours = Math.floor(absMs / (1000 * 60 * 60));
  const days = Math.floor(absMs / (1000 * 60 * 60 * 24));
  const months = Math.floor(days / 30);
  const years = Math.floor(days / 365);

  let label: string;

  if (seconds < 5) {
    return "just now";
  } else if (seconds < 60) {
    label = `${seconds} ${seconds === 1 ? "second" : "seconds"}`;
  } else if (minutes < 60) {
    label = `${minutes} ${minutes === 1 ? "minute" : "minutes"}`;
  } else if (hours < 24) {
    label = `${hours} ${hours === 1 ? "hour" : "hours"}`;
  } else if (days < 30) {
    label = `${days} ${days === 1 ? "day" : "days"}`;
  } else if (months < 12) {
    label = `${months} ${months === 1 ? "month" : "months"}`;
  } else {
    label = `${years} ${years === 1 ? "year" : "years"}`;
  }

  return isFuture ? `in ${label}` : `${label} ago`;
}
