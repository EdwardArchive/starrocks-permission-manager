# Cluster Monitoring Overhaul + Running Queries Panel (Issue #15)

Design notes and live-cluster validation evidence for the v2.1 monitoring work:
the **Cluster Monitor tab**, the **Running Queries panel** (issue #15), and the
fixes that came out of inspecting the deployed UI.

## Problem

The original monitoring surface was a 440px right-side drawer showing node
inventory only. `num_running_queries` was a bare count — no way to see *which*
queries consume cluster resources (issue #15). Live inspection of the deployed
app (StarRocks 4.0.8, 3 FE + 3 CN shared-data) also surfaced two display bugs:

1. **Timezone bug** — `relativeTime.ts` assumed naive timestamps are UTC, but
   StarRocks returns them in the *cluster's* timezone (Asia/Seoul on the test
   cluster). Node start times rendered as `"in 4 hours"`.
2. **Cache colored as alarm** — CN `DataCacheMetrics` disk usage of 99.9%
   rendered as a red "danger" bar, but a full data cache is normal operation.

## Live validation (StarRocks 4.0.8, 2026-06-11)

### Data source candidates for query monitoring

| Source | Verdict | Notes |
|--------|---------|-------|
| `SHOW PROC '/global_current_queries'` | ✅ **primary** | Same columns as `'/current_queries'` but aggregated across **all FEs** — verified visible from every load-balanced connection. |
| `SHOW PROC '/current_queries'` | ⚠️ fallback only | **FE-local**: behind the k8s LB each new backend connection lands on a random FE; a 9 s query was visible from only ~1/3 of fresh connections during live testing. Columns: StartTime, feIp, QueryId, ConnectionId, Database, User, ScanBytes ("13.319 GB"), ScanRows ("1787602878 rows"), MemoryUsage, DiskSpillSize, CPUTime ("0.478 s"), ExecTime, ExecProgress, ExecState ("RUNNING"), Warehouse, CustomQueryId, ResourceGroup. **No SQL text.** FE-only statements (`SELECT SLEEP(n)`) never appear; only queries dispatched to BE/CN do. |
| `SHOW FULL PROCESSLIST` | ✅ **join source** | `Id` = ConnectionId; `Info` = SQL text. Also: IsPending, Warehouse, CNGroup, Catalog, QueryId. Shows connections across all FEs (`ServerName`). |
| `SHOW PROFILELIST` | ❌ env-dependent | Empty on the test cluster (`enable_profile=false`, `big_query_profile_threshold=30s`). Would enable "execution plan summary" via `ANALYZE PROFILE`; deferred. |
| AuditLoader table (`starrocks_audit_db__.starrocks_audit_tbl__`) | ⚠️ deferred | Installed on the test cluster with everything needed for *completed*-query history (queryTime, scanBytes/Rows, cpuCostNs, memCostBytes, full stmt, state/errorCode). Plugin is not installed by default → follow-up issue. |
| `SHOW RUNNING QUERIES` | ❌ | Query-queue feature; empty unless the queue is enabled. |
| `information_schema.task_runs` | ❌ | Async tasks (MV refresh, SUBMIT TASK) only — not interactive queries. |

### Timezone evidence

```
SELECT @@time_zone, @@system_time_zone, now();
-- Asia/Seoul  Asia/Seoul  2026-06-12 01:25:04   (app server clock: 2026-06-11 16:25:04 UTC)
```

Fix: both `/api/cluster/status` and `/api/cluster/queries` return `server_now`
(`SELECT NOW()`, cluster zone). The frontend parses `server_now` and node
timestamps with the same as-if-UTC rule, so the zone offset cancels:
`formatRelativeTime(ts, skewedNow(clockSkewMs(server_now)))`.

## Design decisions

- **v1 scope = running queries only.** Completed-query history (AuditLoader /
  PROFILELIST) is environment-dependent → follow-up issue. Read-only: no KILL.
  "Execution plan summary" from issue #15 needs `enable_profile` → deferred.
- **UI**: new **Cluster Monitor** main tab (full dashboard: summary band, node
  card grid, running-queries table). The header drawer stays as a quick glance
  (summary + alerts) with an "Open Cluster Monitor" link. Node cards are shared
  (`components/cluster/NodeCards.tsx`).
- **Permission model**: same as the rest of `/api/cluster/*` — no backend
  guard; StarRocks gates `SHOW PROC` behind OPERATE, the global errno→403
  handler maps denials. The queries panel renders the 403 in place and stops
  polling (drawer-style limited fallback doesn't apply: there is no partial
  view of other users' queries).
- **Polling**: queries 10 s / status 30 s while the tab is mounted and the
  page visible; the header icon polls the cached `/status` every 60 s for the
  error badge. Queries responses are server-cached 5 s per user.
- **BE CPU gap**: `SHOW BACKENDS` reports no CPU. The backend probes BE
  `/metrics` and computes utilization from the delta of the cumulative
  `starrocks_be_cpu` counter between scrapes (module-level last-sample cache;
  first scrape yields null). Best-effort — metric names could not be verified
  live (the test cluster is CN-only); failures simply leave the field null.
- **Cache bar color**: `UtilBar` gained a `variant`: `pressure` (green→red,
  disk/mem/CPU) vs `info` (constant accent, CN data cache).

## Touched surfaces

- Backend: `routers/cluster.py` (+`/queries`, `server_now`, BE probe wiring),
  `services/cluster_queries.py` (new), `services/be_metrics.py` (new),
  `services/fe_metrics.py` (fetch split), `services/shared/size_utils.py`
  (moved from router), `models/schemas.py`.
- Frontend: `tabs/ClusterTab.tsx` (new), `cluster/QueriesPanel.tsx` (new),
  `cluster/NodeCards.tsx` + `cluster/ClusterSummary.tsx` (extracted),
  `cluster/ClusterDrawer.tsx` (slimmed), `layout/Header.tsx` (badge),
  `utils/relativeTime.ts` (skew), `utils/querySort.ts` (new),
  `api/client.ts` (`ApiError`, `quiet`), `api/cluster.ts`, `types/index.ts`.

## v2.2 additions (cluster-monitor follow-ups)

- **CPU share per query**: `cpu_avg_cores` = cumulative CPU time / wall time
  (average cores busy since start). UI shows it as % of total alive BE/CN
  cores, plus an *instantaneous* value from the poll-to-poll CPUTime delta.
  Accuracy caveats (avg-since-start, ~10s report interval, multi-warehouse
  denominator) are documented in the panel tooltips.
- **Completed-query history (M1)**: `GET /api/cluster/queries/history` reads
  `starrocks_audit_db__.starrocks_audit_tbl__` (AuditLoader). Returns
  `available:false` with a reason when the plugin table is absent, so the
  Recent subtab degrades gracefully. `errors_only` filters `state='ERR'`.
- **KILL query (M6)**: `POST /api/cluster/queries/kill`, **grant-admin only**
  (`require_grant_admin`), audited to `srpm_audit.grant_log` like GRANT/REVOKE.
  **Verified live**: `KILL QUERY '<uuid>'` is cluster-global (succeeds through
  the LB regardless of owning FE); `KILL <connection_id>` is FE-local and
  returns "Unknown thread id (1094)" off the owning FE — so KILL is always by
  query id. The UI hides the action unless `can_kill` (grant-admin).
- **UI**: Running | Recent subtabs, text filter, refresh-interval selector,
  KPI gauge band (status colors + jump-to-section), node cards with
  session-accumulated CPU/heap sparklines and dead-nodes-first ordering. The
  header drawer became a live gauge glance (15s auto-refresh) with a top
  running-queries preview; its KPIs/alerts/preview jump straight to the
  matching section/node in the Cluster Monitor tab.

## Follow-ups (not in this change)

- `SHOW PROFILELIST` / execution-plan summary when profiling is enabled.
- Persisted (cross-session) metric trends; per-warehouse CPU denominator.
