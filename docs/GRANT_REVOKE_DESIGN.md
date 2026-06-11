# GRANT/REVOKE UI — Design (v2.0 First Cut)

**Issue**: [#22 GRANT/REVOKE UI for privilege management](https://github.com/EdwardArchive/starrocks-permission-manager/issues/22)
**Status**: **Implemented (2026-06-11)** — authorization model and all statement families validated against a live StarRocks 4.0.8 cluster; E2E suite (7 Playwright tests) green. Screenshots: `docs/screenshots/manage-privileges-wizard.png`, `revoke-direct-grants.png`, `grant-audit-tab.png`
**Scope**: First write-capable feature. v1.x is read-only; this introduces GRANT/REVOKE.

---

## 1. Scope

Two StarRocks statement families are in scope:

| Family | Statement |
|--------|-----------|
| **Object privilege** | `GRANT/REVOKE <priv_list> ON <object> TO/FROM <grantee> [WITH GRANT OPTION]` |
| **Role assignment** | `GRANT/REVOKE <role> TO/FROM <user\|role>` |

Out of scope for the first cut (tracked separately): bulk operations (`ON ALL TABLES IN ...`), object ownership transfer, password/user lifecycle management.

First-cut **object types** (decided 2026-06-11): **CATALOG, DATABASE, TABLE, VIEW, MATERIALIZED
VIEW, FUNCTION** + role assignment. **External catalogs are included** (see "Catalog context"
in §3). Deferred: SYSTEM-level privileges, USER (IMPERSONATE), RESOURCE GROUP, STORAGE VOLUME.

### Authorization model — capability gate `can_manage_grants` (VALIDATED)

- **Gate signal**: at login, after the existing admin detection (`can_access_sys()`), the backend
  BFS-walks the user's role chain via `sys.role_edges` and sets
  `can_manage_grants = ("user_admin" in chain)` in the server-side session.
  This is capability-based, mirroring the `can_access_sys()` philosophy: in StarRocks, the
  `GRANT ON SYSTEM` privilege (carried by `user_admin`) is the *only* mechanism that allows
  granting/revoking privileges on arbitrary objects. Other users can only re-grant privileges
  they hold `WITH GRANT OPTION`.
- `require_admin` is necessary but **not sufficient**: a `security_admin`-only user passes
  `require_admin` but gets `can_manage_grants = false` — the Manage Privileges button and the
  Audit tab are hidden, and the new routes are guarded by **`require_grant_admin`**
  (= `require_admin` + session `can_manage_grants`).
- `GET /api/auth/me` returns `can_manage_grants` for the frontend.
- Statements still run under the **logged-in user's own StarRocks credentials**; StarRocks
  remains the final authorization gate. Denials surface through the existing errno → HTTP 403
  mapping (`{1044, 1045, 1142, 1227}`).
- **root-only gating was considered and rejected**: it destroys per-actor audit attribution
  (every `actor` becomes `'root'@'%'`) and institutionalizes root credential sharing.

#### Validation evidence (StarRocks 4.0.8, 2026-06-11)

| Test | Result |
|------|--------|
| `GRANT user_admin TO ROLE <custom>` | ✅ built-in roles **can** be nested into custom roles |
| `GRANT ... TO ROLE user_admin` | ❌ `role user_admin is not mutable!` — built-in roles cannot receive grants |
| `user_admin` definition | `GRANT ON SYSTEM` + `IMPERSONATE ON ALL USERS` only |
| GRANT/REVOKE on a table the grantor **cannot SELECT** | ✅ succeeds — `GRANT ON SYSTEM` is a meta-privilege, decoupled from data access (not MySQL-style) |
| `SHOW ROLES` / `SHOW USERS` / GRANT / REVOKE through the nested role | ✅ privileges inherit through role nesting |
| `sys.role_edges` read with **only** `user_admin` (direct or nested) | ❌ denied — sys.* requires explicit `SELECT` grants (`ON TABLE`, not `ON VIEW`) |
| `GRANT NODE ON SYSTEM TO USER ...` | ❌ `'NODE' cannot be granted to user or role directly` — exclude from allowlist |
| `INSERT ... VALUES (NOW(), CURRENT_USER(), ...)` | ✅ works for audit rows; actor recorded as `'user'@'host'` |
| `GRANT SELECT ON TABLE <catalog>.<db>.<table>` (3-part name) | ❌ **syntax error** (`Unexpected input '.'`) — the GRANT parser only accepts 2-part names |
| `SET CATALOG <ext_catalog>; GRANT SELECT ON TABLE db.t TO ...` | ✅ works — grant registers under that catalog (visible in `SHOW GRANTS` Catalog column) |
| `GRANT USAGE ON CATALOG <ext_catalog>` | ✅ works on external catalogs |
| GRANT on a **nonexistent** external-catalog table | ⚠️ succeeds — StarRocks does not validate object existence for external catalogs (typos are not caught) |
| `GRANT/REVOKE USAGE ON FUNCTION db.fn(int,int)` (real UDF) | ✅ **end-to-end validated** — registers, revokes cleanly; **function existence IS validated** at grant time (unlike external tables), and the **signature must match exactly** (`(bigint,bigint)` against an `(INT,INT)` function → `cannot find function`) |
| `GRANT USAGE ON FUNCTION db.fn` (no signature) | ❌ syntax error — **the signature is mandatory** |
| `GRANT EXECUTE ON FUNCTION ...` | ❌ `No viable statement` — `EXECUTE` is not a privilege keyword at all (PRD §2.3 is wrong) |
| `GRANT/REVOKE USAGE ON GLOBAL FUNCTION fn(int,int)` (real UDF) | ✅ end-to-end validated (global functions live in pseudo-db `__global_udf_db__`) |
| FUNCTION grant display shapes | `SHOW GRANTS` → `GRANT USAGE ON FUNCTION fn(INT,INT) in DATABASE db TO ...` (input syntax `db.fn(sig)` is NOT what is displayed); `sys.grants_to_users` → `OBJECT_NAME = "fn(INT, INT)"` (**space after comma**, vs no space in SHOW GRANTS — `normalize_fn_name()` exists for exactly this) |
| `GRANT/REVOKE USAGE ON ALL FUNCTIONS IN DATABASE db` | ✅ works end-to-end — but ⚠️ the grant does **not appear in `sys.grants_to_users`** (only in `SHOW GRANTS`); specific-function grants DO appear. Affects the existing admin read tier for clusters using bulk function grants |

---

## 2. UI

### Entry point
A **`⚙ Manage Privileges`** button in the Header opens the wizard modal — visible only when
`can_manage_grants` (not merely `is_admin`). When launched from the Permission Focus tab, the
currently-viewed user/role is pre-filled as the grantee. The Permission Matrix and detail
panels are **not** modified.

### Manage Privileges wizard (modal)
A single modal with two axes — `Action (Grant / Revoke)` × `Type (Privilege / Role)`:

```
Action:  (•) Grant   ( ) Revoke
Type:    (•) Privilege on object   ( ) Role assignment
─────────────────────────────────────────────
[Privilege mode]
  Grantee:    [user|role search·select ▾]
  Object:     object_type ▾ → catalog ▾ → db ▾ → object ▾
  Privileges: ☑ checkboxes  (filtered by object_type via server spec endpoint)
  [ ] WITH GRANT OPTION
[Role mode]
  Role (to grant):     [role ▾]
  Grantee (recipient): [user|role ▾]
─────────────────────────────────────────────
SQL preview (live):
  GRANT SELECT ON TABLE `sales`.`orders` TO USER 'alice'@'%'
                        [Cancel]  [Execute]
```

- **Revoke mode**: after a grantee is selected, the wizard loads that grantee's **direct (D)
  grants** (privilege mode) or **assigned roles** (role mode) so the user can only revoke
  something that actually exists. Inherited (I) privileges are not revocable here — they must
  be revoked at the source role.
- **SQL preview** is fetched live from the `/preview` endpoint so the displayed SQL is exactly
  what will run. When the target catalog is not `default_catalog`, the preview shows **both**
  statements (`SET CATALOG ...;` + the GRANT/REVOKE) since both will be executed (see §3
  "Catalog context").
- **FUNCTION mode**: the object picker lists functions with their full signatures (from
  `accessible_objects` / `normalize_fn_name`); the signature is part of the statement
  (`GRANT USAGE ON FUNCTION fn(type)`), so free-text entry is not offered for functions.
- **Confirmation dialog** warns that execution may still be denied by StarRocks, and adds a
  **self-lockout warning** when the grantee is the current user and the action is REVOKE
  (e.g. revoking your own `user_admin` removes your access to this feature).
- After a successful **role** grant, show a hint that the target user's other sessions may need
  `SET DEFAULT ROLE` / role activation for the change to take effect outside this app.

### Audit tab (read-only)
A table view of recent GRANT/REVOKE history: `ts | actor | action | sql | result`, with `actor`
and `action` filters. Backed by `GET /api/admin/grants/audit`. Visible only when
`can_manage_grants` (matches who can actually SELECT the audit table — see §4).

---

## 3. Backend

### New router category: `admin_grants.py`
Write operations do not fit the Layer 1 (common / `SHOW`) vs Layer 2 (admin / `sys.*`) **read**
split. They form a new write category behind **`require_grant_admin`** — analogous to how
`/api/cluster/*` was added as a third route category.

```
GET  /api/admin/grants/spec      → { object_type: [privileges...] }     # server allowlist, single source for UI
POST /api/admin/grants/preview   GrantRequest → { sql, warnings }       # builds SQL, does NOT execute
POST /api/admin/grants/execute   GrantRequest → { sql, status, audit }  # rebuild + execute + audit + cache invalidation
GET  /api/admin/grants/audit?limit&actor&action → [ AuditEntry ]        # parameterized filters
```

### Login-time detection
`auth.login` flow gains one step: if the user is admin, BFS the role chain from
`sys.role_edges` (existing `bfs_resolver` / `role_helpers` machinery) and store
`can_manage_grants` in the session next to `is_admin`. Non-admin → always `false`.

### Request schema (`GrantRequest`)
Discriminated on `type`:

```jsonc
// type = "PRIVILEGE"
{
  "action": "GRANT" | "REVOKE",
  "type": "PRIVILEGE",
  "grantee": { "name": "alice", "type": "USER" | "ROLE" },
  "object":  { "object_type": "TABLE", "catalog": "...", "database": "...", "name": "..." },
  "privileges": ["SELECT", "INSERT"],
  "with_grant_option": false
}

// type = "ROLE"
{
  "action": "GRANT" | "REVOKE",
  "type": "ROLE",
  "role": "role_analyst",
  "grantee": { "name": "alice", "type": "USER" | "ROLE" }
}
```

Validation rules (server-side, 422 on violation):
- `privileges` must be non-empty and every entry must be in the allowlist for `object_type`.
- `with_grant_option = true` is rejected when `action = REVOKE` (no such clause in StarRocks).
- `object` fields are shaped per `object_type` (e.g. CATALOG-level grants take no db/name).
- For `object_type = FUNCTION`, `object.name` carries the full normalized signature
  (e.g. `my_udf(string)`); the signature's parentheses/types are validated structurally
  (identifier + allowlisted type tokens), not passed through as free text.

### Privilege allowlist (`grant_spec.py`)
- Authored from the **official StarRocks GRANT documentation**, NOT PRD §2.3 — the PRD map has
  errors (FUNCTION privileges are `USAGE | DROP`, not `EXECUTE`; the USER-object privilege is
  `IMPERSONATE`, not `OPERATE`). PRD §2.3 to be corrected separately.
- **`NODE` is excluded** — StarRocks rejects granting it directly (validated; it is only
  obtainable via the `cluster_admin` built-in role).
- Served to the frontend via `GET /api/admin/grants/spec` so there is **no duplicated
  frontend copy** to keep in sync.

### SQL safety
- **The client never sends raw SQL.** Only structured parameters.
- `privilege_type` and `object_type` are enum values validated against the server allowlist —
  never string-interpolated.
- **`safe_name` is NOT reused on the write path.** Its allowlist (quotes, spaces, dashes —
  designed for read-only `SHOW GRANTS FOR 'alice'@'%'`) would let a crafted grantee like
  `alice'@'%' WITH GRANT OPTION` pass validation and escalate. Instead, `grant_writer`:
  - parses a user identity into `(user, host)`, validates each part against a strict pattern
    (`user`: `^[A-Za-z0-9_.-]+$`, `host`: `^[A-Za-z0-9_.%-]+$`), and reconstructs
    `'user'@'host'`;
  - validates role names against the same strict user pattern and backtick-quotes object
    identifiers via `safe_identifier`.
- `preview` and `execute` call the **same builder** — `preview` returns the SQL string without
  running it; `execute` rebuilds from the structured params and runs it. No "previewed SQL ≠
  executed SQL" divergence.
- A new `execute_statement` helper runs writes without `fetchall()` (GRANT/REVOKE return no
  result set).

### Catalog context (VALIDATED)
The GRANT/REVOKE parser **rejects 3-part qualified names** (`catalog.db.table` → syntax error,
verified on 4.0.8). The builder therefore emits a **statement pair** whenever the object
carries a catalog:

```sql
SET CATALOG `<catalog>`;          -- safe_identifier-quoted, run on the same connection
GRANT SELECT ON TABLE `db`.`t` TO USER 'alice'@'%';
```

- Always emit `SET CATALOG` (including for `default_catalog`) so behavior is deterministic
  regardless of the connection's current catalog.
- Verified against a dummy external catalog: the grant registers under that catalog and is
  visible in `SHOW GRANTS` with the correct Catalog column.
- ⚠️ StarRocks does **not** validate object existence for external-catalog grants (a grant on
  a nonexistent table succeeds silently). The wizard's pickers keep input valid; the preview
  response includes a warning when the object cannot be found in the loaded hierarchy.

### Reused reads
- Grantee / object pickers reuse `/admin/search/users-roles`, `/admin/roles`, and the
  object-hierarchy endpoints.
- **User picker gap fix**: `get_all_users()` only sees `sys.role_edges` + `sys.grants_to_users`,
  so a freshly created user with zero grants — the primary target of this feature — is
  invisible. Supplement with `SHOW USERS` (validated: available to bundle-role users), plus a
  manual-entry fallback in the picker UI.
- Revoke target lists reuse `getUserPrivileges` / `getRolePrivileges`, filtered to
  `source == "direct"`.

### Role cycle prevention
StarRocks rejects cyclic role assignments itself; the backend relies on StarRocks as the
validator and surfaces the error. (An optional client-side warning using the already-loaded
role graph is a nice-to-have, not required.)

### Cache invalidation
On a successful GRANT/REVOKE, `clear_all_caches()` (`utils/cache.py`) is called so the UI
reflects the change immediately. Note: caches are per-process — in multi-worker deployments
other workers serve stale data until TTL (same constraint as the session store; documented
alongside it).

---

## 4. Audit trail — StarRocks table

The app is stateless and the container may run on a read-only filesystem (Rapidfort hardening),
so a local audit file is not viable. Audit records are written to a dedicated StarRocks table.

### One-time setup (run by root / db_admin; documented, not auto-created by the app)

**Validated end-to-end on StarRocks 4.0.8.** Granting directly to built-in roles fails
(`role user_admin is not mutable!`), so a **bundle role** carries everything an operator of
this feature needs — one assignment per administrator:

```sql
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
PROPERTIES ("replication_num" = "1");  -- match cluster replication

-- Bundle role: UI visibility + execution capability + audit access in one grant.
CREATE ROLE srpm_grant_admin;

-- GRANT/REVOKE capability (GRANT ON SYSTEM, inherited through nesting — validated)
GRANT user_admin TO ROLE srpm_grant_admin;

-- App admin detection (user_admin alone CANNOT read sys.* — validated).
-- NOTE: must be ON TABLE; ON VIEW fails with "cannot find view".
GRANT SELECT ON TABLE sys.role_edges      TO ROLE srpm_grant_admin;
GRANT SELECT ON TABLE sys.grants_to_users TO ROLE srpm_grant_admin;
GRANT SELECT ON TABLE sys.grants_to_roles TO ROLE srpm_grant_admin;

-- Audit trail read/write
GRANT INSERT, SELECT ON TABLE srpm_audit.grant_log TO ROLE srpm_grant_admin;

-- Per administrator:
GRANT srpm_grant_admin TO USER 'alice'@'%';
```

A user holding `srpm_grant_admin` passes the app's admin detection, gets
`can_manage_grants = true`, can execute GRANT/REVOKE, and can read/write the audit log — all
from this single role.

### Execution + audit flow (best-effort audit, failures included)

1. Execute the GRANT/REVOKE under the user's credentials.
2. **Always** attempt the audit `INSERT` — on success `result = 'ok'`; on a denied/failed
   execution `result = 'error'` with `error_msg`. Denied attempts are the most audit-worthy
   events, so failures are logged too (previously only successes were logged — inconsistent
   with the schema's `result`/`error_msg` columns).
3. If the audit INSERT itself fails, the operation outcome is unchanged; the `execute` response
   carries `"audit": "ok" | "failed"` so the UI can surface "executed, but not audited"
   (toast warning), with a stdout log as fallback.

`actor` uses `CURRENT_USER()` (validated to work inside `INSERT ... VALUES`).

Rationale: StarRocks DDL (GRANT) auto-commits, so the privilege change and the audit write
cannot be wrapped in one rollback-able transaction. Privilege dependencies are made explicit
via the documented setup SQL, keeping the requirement under operator control.

---

## 5. Implementation checklist (✅ all done — kept for traceability)

**Backend**
- [ ] `services/shared/grant_spec.py` — docs-derived object_type → privilege allowlist
      (NODE excluded) + validation
- [ ] `services/admin/grant_writer.py` — SQL builder (privilege + role families), strict
      identity parsing/validation, `SET CATALOG` statement-pair emission, FUNCTION signature
      handling, shared by preview/execute
- [ ] `services/admin/audit.py` — always-log `grant_log` INSERT (ok/error) + query
- [ ] `routers/admin_grants.py` — spec / preview / execute / audit endpoints (behind
      `require_grant_admin`)
- [ ] `dependencies.py` — `require_grant_admin` guard
- [ ] Login flow — `can_manage_grants` detection (BFS `user_admin` in role chain) + session
      storage + `/api/auth/me` exposure
- [ ] `models/schemas.py` — `GrantRequest`, `GrantResponse` (incl. `audit` flag), `AuditEntry`
- [ ] `execute_statement` helper in `starrocks_client.py` (+ FakeConnection support in
      `conftest.py`)
- [ ] Cache invalidation on execute
- [ ] pytest: SQL builder, allowlist rejection, **identity injection attempts (e.g.
      `WITH GRANT OPTION` smuggling)**, 403 guards (non-admin AND grant-incapable admin),
      audit best-effort fallback
- [ ] Integration tests (`test_integration.py`): real-SR scenario — GRANT → verify via SHOW
      GRANTS → REVOKE → cleanup; external-catalog grant via `SET CATALOG` pair; **FUNCTION
      grant syntax** (needs a real UDF on the test cluster — the one statement family not yet
      empirically validated)

**Frontend**
- [ ] `authStore` — `can_manage_grants` from `/api/auth/me`
- [ ] `api/admin.ts` — `getGrantSpec`, `previewGrant`, `executeGrant`, `getAuditLog`
- [ ] `ManagePrivilegesModal.tsx` — wizard (Action × Type, live preview, confirm/execute,
      self-lockout warning, audit-failed toast); privilege checkboxes driven by the spec
      endpoint (no local copy of the map)
- [ ] Header `⚙ Manage Privileges` button (gated by `can_manage_grants`) + Permission Focus
      prefill
- [ ] Audit tab/view (gated by `can_manage_grants`, read-only)

**Docs**
- [ ] Correct PRD §2.3 (FUNCTION: `USAGE | DROP`; USER: `IMPERSONATE`; NODE not directly
      grantable)
- [ ] Update PRD §8 roadmap (mark v2.0 GRANT/REVOKE delivered)
- [ ] Add the bundle-role + audit setup SQL to README / operator docs (incl. multi-worker
      cache/session note)
- [ ] Update `docs/API.md` with the new endpoints

---

## 6. UX revision 2 (2026-06-11, shipped same day)

Post-first-cut usability pass, all E2E-verified (11 tests):
1. **Contextual entry points** — Permission Matrix "D" badges are click-to-revoke
   (fully prefilled), Object/User detail panels gained Grant…/Manage… buttons, DAG nodes
   have a right-click "Manage privileges…" menu.
2. **Already-granted badges** — privileges the grantee already holds on the selected object
   are marked `granted` in the checkbox list.
3. **Keep open after execute** — consecutive operations in one wizard session with an
   inline per-statement result log.
4. **Privilege presets** — Read-only / Read-write / Full chips (intersected with the
   object type's allowlist).
5. **Multi-select revoke** — the direct-grants helper is a checkbox list with bulk revoke;
   inherited grants are shown greyed with a "via {role} →" jump to the source role.
6. **Polish** — custom grantee suggestion dropdown (auto-sets USER/ROLE), ⚠ HIGH IMPACT
   badge for WITH GRANT OPTION / ALL, Audit tab failures-only filter + SQL copy, Esc closes.

## 7. Decisions (2026-06-11)

1. **First-cut object types**: CATALOG, DATABASE, TABLE, VIEW, MATERIALIZED VIEW,
   **FUNCTION** + role assignment. Deferred: SYSTEM-level privileges, USER (IMPERSONATE),
   RESOURCE GROUP, STORAGE VOLUME (different statement shapes / pickers; lower demand).
2. **External catalogs included.** Validated: 3-part names are a syntax error; the builder
   emits a `SET CATALOG` + GRANT/REVOKE statement pair on the same connection (§3 "Catalog
   context").
3. **Authorization gate**: capability-based `can_manage_grants` (user_admin in role chain);
   operator setup via the `srpm_grant_admin` bundle role (§1, §4). root-only gating rejected.

### Remaining verification (during implementation)
- ~~FUNCTION grant registration end-to-end~~ — **DONE (2026-06-11)**: validated against real
  UDFs (`enable_udf=true` now on the test cluster; reference global functions
  `udf_add(INT,INT)` / `py_add(INT,INT)` kept for future tests). See the evidence table —
  exact-signature matching is required, and display shapes differ between `SHOW GRANTS`
  (`fn(INT,INT) in DATABASE db`, no space) and `sys.grants_to_users` (`fn(INT, INT)`, space) —
  the builder must emit the signature exactly as provided by the object picker
  (`normalize_fn_name()` handles shape differences on the read side).
- **GLOBAL FUNCTION**: statement family validated end-to-end, but the wizard's
  `catalog → db → object` cascade has no db level for it — **deferred** from the first cut
  (trivial to add later as a special object_type with its own picker).
- **Bulk function grants invisible to sys.grants_to_users** (observed twice; specific-function
  grants DO appear): out of scope for v2.0 (bulk ops deferred), but the v1.x admin read tier
  (`sys_collector`) will miss `ON ALL FUNCTIONS IN DATABASE` grants while `SHOW GRANTS` shows
  them — consider a separate issue.
