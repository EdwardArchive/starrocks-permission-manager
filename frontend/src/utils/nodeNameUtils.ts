const _NAME_SUFFIX_RE = /_\d+_\d+$/;
const _IPV4_RE = /^\d{1,3}(\.\d{1,3}){3}$/;

/**
 * Returns a short display name for a StarRocks node identifier.
 *
 * Handles three forms that appear in K8s deployments:
 *   - FQDN  "starrocks-oss-cn-1.ns.svc.cluster.local" → "starrocks-oss-cn-1"
 *   - FE K8s "starrocks-oss-fe-0_9010_1775306864789"  → "starrocks-oss-fe-0"
 *   - IPv4  "10.100.1.2"                              → "10.100.1.2"  (unchanged)
 *   - plain  "fe-01"                                   → "fe-01"       (unchanged)
 */
export function shortenNodeName(name: string): string {
  if (!name) return name;
  // IPv4 addresses must not be split on "."
  if (_IPV4_RE.test(name)) return name;
  // FQDN: take only the first DNS label
  const label = name.includes(".") ? name.split(".")[0] : name;
  // Strip _<port>_<timestamp> suffix added by StarRocks for FE nodes
  return label.replace(_NAME_SUFFIX_RE, "");
}
