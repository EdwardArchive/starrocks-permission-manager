-- Operator setup for the GRANT/REVOKE feature (v2.0).
-- Run as root / db_admin. See docs/GRANT_REVOKE_DESIGN.md §4 for rationale.
-- Validated against StarRocks 4.0.8.

CREATE DATABASE IF NOT EXISTS srpm_audit;

CREATE TABLE IF NOT EXISTS srpm_audit.grant_log (
  log_time   DATETIME      NOT NULL,
  actor      VARCHAR(256)  NOT NULL,   -- CURRENT_USER(), e.g. 'alice'@'%'
  action     VARCHAR(16)   NOT NULL,   -- GRANT | REVOKE
  grant_type VARCHAR(16)   NOT NULL,   -- PRIVILEGE | ROLE
  sql_text   STRING        NOT NULL,
  result     VARCHAR(16)   NOT NULL,   -- ok | error
  error_msg  STRING        NULL
)
DUPLICATE KEY(log_time, actor)
DISTRIBUTED BY HASH(actor)
PROPERTIES ("replication_num" = "1");  -- match your cluster's replication

-- Bundle role: one assignment enables the full feature for an administrator.
-- (Granting directly to built-in roles fails: "role user_admin is not mutable!")
CREATE ROLE IF NOT EXISTS srpm_grant_admin;

-- GRANT/REVOKE capability (GRANT ON SYSTEM, inherited through role nesting)
GRANT user_admin TO ROLE srpm_grant_admin;

-- App admin detection (user_admin alone cannot read sys.*).
-- NOTE: must be ON TABLE; ON VIEW fails with "cannot find view".
GRANT SELECT ON TABLE sys.role_edges      TO ROLE srpm_grant_admin;
GRANT SELECT ON TABLE sys.grants_to_users TO ROLE srpm_grant_admin;
GRANT SELECT ON TABLE sys.grants_to_roles TO ROLE srpm_grant_admin;

-- Audit trail read/write
GRANT INSERT, SELECT ON TABLE srpm_audit.grant_log TO ROLE srpm_grant_admin;

-- Per administrator (repeat for each):
-- GRANT srpm_grant_admin TO USER 'alice'@'%';
