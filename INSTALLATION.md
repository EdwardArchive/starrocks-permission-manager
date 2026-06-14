# Installation & Cluster Setup

> Building and running the app itself (Docker, Kubernetes, local dev) lives in the
> [README](README.md). **This guide covers the StarRocks-side setup** — the databases,
> tables, roles, and privileges the app depends on, organized by the feature each one
> unlocks.

## How privileges map to features

The app never elevates its own access — every query runs under **your StarRocks
login**, and StarRocks is the final authority. So "installing" the app is mostly a
matter of deciding which StarRocks roles your operators hold. Features light up
progressively, and each tier is independent and additive — grant only what you need.

| Capability tier | StarRocks role / object required | Unlocks |
|---|---|---|
| **Baseline** | *any valid account* | Object Hierarchy, Role Map, My Inventory (self-scoped), login |
| **Admin (read)** | `user_admin` **or** `security_admin` | Permission Focus, org-wide DAG / matrix, all users & roles |
| **Grant management** | `srpm_grant_admin` bundle (incl. `user_admin`) + `srpm_audit.grant_log` | Manage Privileges (GRANT/REVOKE) wizard, Grant Audit tab |
| **Cluster monitoring** | `cluster_admin` (SYSTEM OPERATE) | Cluster Monitor node inventory + running queries |
| **Kill queries** | grant-admin (`user_admin`) **and** `cluster_admin` | KILL button in Running queries (audited) |
| **Query history** | AuditLoader plugin → `starrocks_audit_db__.starrocks_audit_tbl__` | Recent (completed) queries view |

---

## 1. Baseline — every user (no setup)

Nothing to create. Any account that can log in to StarRocks (host / port / user /
password) can use the app's self-scoped views. The backend relies only on `SHOW GRANTS`,
other `SHOW ...` commands, and `INFORMATION_SCHEMA`, which StarRocks filters per user
automatically — no backend-side filtering and no extra grants.

**Network:** the app must reach the FE **query port** (default `9030`, MySQL protocol).

---

## 2. Admin (read) — `user_admin` or `security_admin`

To see *other* users'/roles' permissions (Permission Focus, organization-wide DAG and
matrix), the account must be able to read the `sys.*` system tables **and** run
`SHOW ROLES`. At login the app verifies all four — if **any** fails, the account is
treated as non-admin:

1. `SELECT 1 FROM sys.role_edges LIMIT 1`
2. `SELECT 1 FROM sys.grants_to_users LIMIT 1`
3. `SELECT 1 FROM sys.grants_to_roles LIMIT 1`
4. `SHOW ROLES`

The simplest way to satisfy all four is a built-in role:

```sql
GRANT user_admin TO USER 'alice'@'%';      -- read + (with grant_log setup) write
-- or, read-only admin:
GRANT security_admin TO USER 'alice'@'%';
```

> `cluster_admin` alone is **not** admin in this app — it covers node monitoring, not
> `sys.*` / `SHOW ROLES`. See
> [README → Admin Detection](README.md#admin-detection--what-admin-means-in-this-app).

---

## 3. Grant management — `srpm_audit.grant_log` + `srpm_grant_admin`

The **Manage Privileges** wizard (GRANT/REVOKE) and the **Grant Audit** tab require:

- an audit table, `srpm_audit.grant_log`, where every attempt (success *and* failure) is
  recorded — this table also captures **KILL** actions from the Cluster Monitor; and
- the account to carry `user_admin` in its role chain (StarRocks' `GRANT ON SYSTEM`
  capability), which the app surfaces as `can_manage_grants`.

Both are provisioned by one script:

```bash
mysql -h <fe-host> -P 9030 -uroot -p < docs/sql/setup_grant_admin.sql
```

It creates `srpm_audit.grant_log` and the `srpm_grant_admin` bundle role (`user_admin` +
`SELECT` on the three `sys.*` tables + `INSERT, SELECT` on the audit table). Then assign
it per administrator:

```sql
GRANT srpm_grant_admin TO USER 'alice'@'%';
```

Granting `srpm_grant_admin` satisfies **both** tier 2 (admin read) and tier 3 in a single
assignment. See [docs/GRANT_REVOKE_DESIGN.md](docs/GRANT_REVOKE_DESIGN.md) for rationale.

`srpm_audit.grant_log` schema (from `docs/sql/setup_grant_admin.sql`):

| Column | Type | Notes |
|---|---|---|
| `log_time` | DATETIME | when the attempt happened |
| `actor` | VARCHAR(256) | `CURRENT_USER()`, e.g. `'alice'@'%'` |
| `action` | VARCHAR(16) | `GRANT` · `REVOKE` · `KILL` |
| `grant_type` | VARCHAR(16) | `PRIVILEGE` · `ROLE` · `QUERY` |
| `sql_text` | STRING | the statement executed |
| `result` | VARCHAR(16) | `ok` · `error` |
| `error_msg` | STRING | populated on failure |

---

## 4. Cluster monitoring — `cluster_admin`

The **Cluster Monitor** tab and the header drawer read live node state and running
queries. These require StarRocks' SYSTEM **OPERATE** privilege, carried by
`cluster_admin`:

```sql
GRANT cluster_admin TO USER 'alice'@'%';
```

- Without it, `/api/cluster/status` degrades to a **limited** view (just the single FE
  you're connected to) and the running-queries panel shows a permission notice — no error.
- **KILL** a running query additionally requires grant-admin (`user_admin`, i.e.
  `can_manage_grants`). The button is hidden otherwise, and every KILL is audited to
  `srpm_audit.grant_log` (tier 3).

**Network:** for FE/BE/CN resource metrics (heap, BE CPU%, connections, QPS) the app
probes each node's **HTTP port** `/metrics` directly — FE `http_port` (default `8030`)
and BE/CN `http_port` (default `8040`). These endpoints are unauthenticated; only network
reachability from the app to those ports is required. If a node is unreachable, only the
affected metrics are hidden — the rest of the dashboard still works.

---

## 5. Query history — StarRocks AuditLoader plugin

The **Recent** queries view (completed queries, with an errors-only filter) reads the
StarRocks **AuditLoader** audit table:

```
starrocks_audit_db__.starrocks_audit_tbl__
```

This table is **not** created by this app and is **not** present by default — it is
created and populated by StarRocks' AuditLoader plugin. If it's absent, the Recent view
reports "unavailable" gracefully (no error); everything else keeps working.

### 5.1 Install AuditLoader

The install procedure and the canonical table DDL are **version-specific**, so follow the
official StarRocks guide rather than copying a DDL from here:

👉 StarRocks docs → *"Manage StarRocks audit logs within a table"* (AuditLoader)
   — <https://docs.starrocks.io/docs/administration/management/audit_loader/>

The outline is:

1. `CREATE DATABASE starrocks_audit_db__;`
2. Create `starrocks_audit_db__.starrocks_audit_tbl__` using the DDL from that doc **for
   your StarRocks version** (it includes dynamic partitioning + a retention window).
3. Package the plugin (`plugin.conf` + jar) and `INSTALL PLUGIN FROM "/path/auditloader.zip";`.
4. Run any query, wait one load interval, and confirm rows appear in the table.

### 5.2 Columns the app reads

The default AuditLoader schema already includes everything below; this list is so you can
verify a **customized** schema stays compatible. The history query selects:

```
queryId, timestamp, user, db, warehouse, queryType, state, errorCode,
queryTime, scanRows, scanBytes, memCostBytes, cpuCostNs, stmt
```

and filters on `isQuery = 1` (real queries only).

> `warehouse` is present in the StarRocks 3.x+/4.x default schema. On an older,
> hand-rolled schema that lacks it, add the column — otherwise the history query errors
> and the tab falls back to "unavailable".

### 5.3 Grant read access

History runs under the logged-in user, so each operator who should see it needs `SELECT`
on the audit table:

```sql
-- add it to the bundle role so every grant-admin gets history with no extra step:
GRANT SELECT ON TABLE starrocks_audit_db__.starrocks_audit_tbl__ TO ROLE srpm_grant_admin;
-- …or grant a specific user directly:
GRANT SELECT ON TABLE starrocks_audit_db__.starrocks_audit_tbl__ TO USER 'alice'@'%';
```

This grant is intentionally **not** in `setup_grant_admin.sql`, because the table may not
exist yet when that script runs (the plugin creates it).

---

## Reference — objects & roles this app expects

**Tables**

| Object | Created by | Required for | Privilege the user needs |
|---|---|---|---|
| `sys.role_edges`, `sys.grants_to_users`, `sys.grants_to_roles` | StarRocks (built-in) | Admin read tier | `SELECT` (via `user_admin` / `security_admin`) |
| `srpm_audit.grant_log` | `docs/sql/setup_grant_admin.sql` | GRANT/REVOKE + KILL audit, Grant Audit tab | `INSERT, SELECT` |
| `starrocks_audit_db__.starrocks_audit_tbl__` | AuditLoader plugin | Recent query history | `SELECT` |

**Roles**

| Role | Source | What it gives the app |
|---|---|---|
| `user_admin` | built-in | admin read **and** `can_manage_grants` (GRANT/REVOKE, KILL) |
| `security_admin` | built-in | admin read only |
| `cluster_admin` | built-in | Cluster Monitor inventory + running queries (SYSTEM OPERATE) |
| `srpm_grant_admin` | `setup_grant_admin.sql` | bundles `user_admin` + `sys.*` SELECT + `grant_log` access |

---

## Verify

After setup, log in as the operator and confirm:

- [ ] **Permission Focus** tab is visible (admin read OK)
- [ ] `⚙ Manage Privileges` opens and the SQL preview renders (grant-admin OK)
- [ ] **Grant Audit** tab lists rows (grant_log readable)
- [ ] **Cluster Monitor** shows the full node grid, not the "limited" banner (cluster_admin OK)
- [ ] **Recent** queries view lists completed queries (AuditLoader OK)
- [ ] A test GRANT then REVOKE shows up in Grant Audit with `result = ok`
