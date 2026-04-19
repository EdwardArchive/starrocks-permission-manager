/**
 * Format an absolute timestamp (ISO 8601 or "YYYY-MM-DD HH:MM:SS") as
 * relative time like "2 minutes ago", "3 days ago", or "just now".
 * Returns an empty string for null/undefined/invalid input.
 *
 * **UTC assumption**: Space-separated timestamps (e.g. `"2026-04-19 10:00:00"`)
 * are assumed to be UTC because that's the StarRocks default. If your StarRocks
 * server runs in a non-UTC timezone, offsets displayed as "X minutes ago" will
 * be wrong by the TZ offset. Most production deployments use UTC, so this is
 * usually a non-issue.
 */
export function formatRelativeTime(
  input: string | null | undefined,
  now: Date = new Date(),
): string {
  if (input == null || input === "") return "";

  // Normalize space-separated datetime to ISO 8601 UTC
  // e.g. "2026-04-19 10:00:00" → "2026-04-19T10:00:00Z"
  let normalized = input;
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(input)) {
    normalized = input.replace(" ", "T") + "Z";
  }

  const date = new Date(normalized);
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
