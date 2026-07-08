/**
 * Parser for StarRocks grantee identities ("'user'@'host'", quotes optional).
 *
 * Single source for the `'name'@'host'` → { username, host label } logic that
 * every grantee display site uses. Rendering stays local to each component —
 * this module is parsing only.
 */

export interface ParsedGrantee {
  /** Username part; the raw input when the name is not in user@host form. */
  uname: string;
  /** Raw host capture (may be ""); null when the name is not in user@host form. */
  host: string | null;
  /**
   * Display label for the host: "%" or empty host → "ALL CIDR", CIDR ranges
   * pass through, bare IPs/hostnames get a "/32" suffix.
   * null when the name is not in user@host form — use this as the
   * "did it parse?" discriminator (it is never null or "" on a match).
   */
  hostLabel: string | null;
}

/** Host label shown when a user identity applies to all hosts ("%" or empty host). */
export const ALL_HOSTS_LABEL = "ALL CIDR";

const GRANTEE_RE = /^'?([^'@]+)'?@'?([^']*)'?$/;

export function parseGrantee(name: string): ParsedGrantee {
  const m = name.match(GRANTEE_RE);
  if (!m) return { uname: name, host: null, hostLabel: null };
  const [, uname, host] = m;
  const hostLabel = !host || host === "%" ? ALL_HOSTS_LABEL : host.includes("/") ? host : host + "/32";
  return { uname, host, hostLabel };
}
