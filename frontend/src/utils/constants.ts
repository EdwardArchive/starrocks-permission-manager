/** Shared frontend constants (mirror of backend services/shared/constants.py where applicable). */

/** StarRocks built-in roles — immutable; GRANT/REVOKE on them fails with "role X is not mutable". */
export const BUILTIN_ROLES = new Set(["root", "cluster_admin", "db_admin", "user_admin", "security_admin", "public"]);
