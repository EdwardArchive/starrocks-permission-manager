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

## Run

```bash
cd frontend
E2E_SR_PASS='<root password>' npx playwright test
npx playwright show-report --host 0.0.0.0   # view from another machine
```

The Playwright config auto-starts both dev servers (backend on :8888, vite on
:5173 bound to 0.0.0.0) and reuses them if already running.

Tests run **serially** (they mutate shared cluster state) and clean up the
grants they create (grant → revoke pairs). The fixture objects themselves are
left in place for repeat runs.
