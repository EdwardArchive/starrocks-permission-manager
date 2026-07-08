# E2E tests (Playwright)

Live-cluster end-to-end tests for the GRANT/REVOKE feature. They drive the real
UI (vite dev server) against the real backend and a real StarRocks cluster.

## Prerequisites

1. **Cluster fixtures** (run once as root/db_admin):

```sql
-- feature infra (also see docs/sql/setup_grant_admin.sql)
CREATE DATABASE IF NOT EXISTS srpm_audit;
CREATE TABLE IF NOT EXISTS srpm_audit.grant_log ( ... );  -- full DDL in docs/sql/setup_grant_admin.sql

-- E2E fixtures
CREATE DATABASE IF NOT EXISTS srpm_e2e_db;
CREATE TABLE IF NOT EXISTS srpm_e2e_db.demo_t (id INT)
  DUPLICATE KEY(id) DISTRIBUTED BY HASH(id) PROPERTIES("replication_num"="1");
CREATE USER IF NOT EXISTS 'srpm_e2e_target'@'%' IDENTIFIED BY 'E2eTarget123!';
CREATE ROLE IF NOT EXISTS srpm_e2e_role;
```

2. **Environment variables**: `E2E_SR_PASS` (required; tests skip without it),
   `E2E_SR_HOST` / `E2E_SR_PORT` / `E2E_SR_USER` (default `192.168.10.5` / `9030` / `root`).
   Put them in a gitignored **`frontend/e2e/.env`** (copy `e2e/.env.example`) so you
   don't have to pass them inline. Inline environment variables still override the file.

## Run

```bash
cd frontend
cp e2e/.env.example e2e/.env   # then fill in E2E_SR_PASS
npx playwright test            # reads e2e/.env
# or inline:  E2E_SR_PASS='<root password>' npx playwright test
npx playwright show-report --host 0.0.0.0   # view from another machine
```

## Regenerate documentation screenshots

`capture-docs-screenshots.mjs` refreshes the Manage Privileges screenshots in
`docs/screenshots/` (grant wizard, revoke, grant audit). It needs the dev servers
running (vite :5199, backend :8888) and reads the same `e2e/.env`:

```bash
cd frontend
node e2e/capture-docs-screenshots.mjs
```

The Playwright config auto-starts both dev servers (backend on :8888, vite on
:5173 bound to 0.0.0.0) and reuses them if already running.

Tests run **serially** (they mutate shared cluster state) and clean up the
grants they create (grant → revoke pairs). The fixture objects themselves are
left in place for repeat runs.
