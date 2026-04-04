# StarRocks Permission Manager - CLAUDE.md

## Project Overview
StarRocks permission management Web UI. Visualizes user/role/object permission structures via DAG. Supports both admin and non-admin users with automatic fallback (sys.* tables → SHOW GRANTS).

## Rules

### Auto-Update Documentation
When code or project structure changes, run a sub-agent after completing the task to check whether `README.md` and `CLAUDE.md` need updates.

**Trigger conditions:**
- Files/folders added, deleted, or moved
- API endpoints added/changed
- Dependencies (requirements.txt, package.json) changed
- Environment variables added/changed
- Build/run instructions changed
- Architecture changes (new modules, routers, components, etc.)

## Architecture
```
├── Dockerfile                 # Multi-stage Docker build
├── PRD.md                     # Product Requirements Document
├── README.md                  # Setup/run/API guide
├── pyproject.toml             # Ruff + Bandit + mypy config
├── backend/
│   ├── requirements.txt       # Python dependencies
│   ├── pytest.ini             # Test config
│   ├── API.md                 # Detailed API documentation
│   ├── app/
│   │   ├── main.py            # FastAPI entry, CORS, router registration, lifespan
│   │   ├── config.py          # pydantic-settings (env: SRPM_*)
│   │   ├── dependencies.py    # JWT auth + DB connection DI + require_admin guard
│   │   ├── routers/
│   │   │   ├── auth.py              # POST /api/auth/login|logout, GET /api/auth/me
│   │   │   ├── user_objects.py      # GET /api/user/objects/* (Layer 1, all users)
│   │   │   ├── user_permissions.py  # GET /api/user/my-permissions (Layer 1, all users)
│   │   │   ├── user_roles.py        # GET /api/user/roles/* (Layer 1, all users)
│   │   │   ├── user_dag.py          # GET /api/user/dag/* (Layer 1, all users)
│   │   │   ├── user_search.py       # GET /api/user/search (Layer 1, all users)
│   │   │   ├── admin_privileges.py  # GET /api/admin/privileges/* (Layer 1+2, admin only)
│   │   │   ├── admin_roles.py       # GET /api/admin/roles/* (Layer 1+2, admin only)
│   │   │   ├── admin_dag.py         # GET /api/admin/dag/* (Layer 1+2, admin only)
│   │   │   └── admin_search.py      # GET /api/admin/search/* (Layer 1+2, admin only)
│   │   ├── services/
│   │   │   ├── starrocks_client.py        # MySQL connector wrapper + parallel_queries
│   │   │   ├── grant_collector.py         # Facade: delegates to common or admin collector
│   │   │   ├── shared/                    # Shared constants and utilities
│   │   │   │   ├── constants.py           # BUILTIN_ROLES, BFS_MAX_DEPTH
│   │   │   │   ├── name_utils.py          # normalize_fn_name()
│   │   │   │   └── role_graph.py          # fetch_role_child_map()
│   │   │   ├── common/                    # Layer 1: SHOW + INFORMATION_SCHEMA only
│   │   │   │   ├── grant_parser.py        # SHOW GRANTS parsing → PrivilegeGrant objects
│   │   │   │   ├── grant_classifier.py    # ObjectQuery + Relevance + classify_grant()
│   │   │   │   ├── grant_resolver.py      # Resolve grants for user/role/object queries
│   │   │   │   └── show_grants_collector.py # Non-admin grant collection
│   │   │   ├── admin/                     # Layer 2: sys.* tables (admin only)
│   │   │   │   ├── sys_collector.py       # Admin grant collection via sys.*
│   │   │   │   ├── bfs_resolver.py        # BFS traversal: child roles, user privs, ancestors
│   │   │   │   └── user_service.py        # get_all_users (cached)
│   │   ├── models/
│   │   │   └── schemas.py     # Pydantic request/response models
│   │   └── utils/
│   │       ├── session.py     # JWT encode/decode
│   │       ├── session_store.py # In-memory server-side session store (includes is_admin)
│   │       ├── sql_safety.py  # SQL injection protection (safe_name, safe_identifier)
│   │       ├── cache.py       # Central cache clearing utility
│   │       ├── sys_access.py  # can_access_sys() — checks sys.role_edges access
│   │       └── role_helpers.py # Shared: get_user_roles, get_parent_roles, parse_role_assignments
│   └── tests/
│       ├── conftest.py           # FakeConnection mock + fixtures
│       ├── test_*.py             # Unit tests (57 original)
│       ├── test_admin_guard.py   # Admin route 403 guard tests (14 parametrized cases)
│       └── test_integration.py   # Integration tests (26, requires real SR)
└── frontend/
    ├── package.json
    ├── vite.config.ts          # Tailwind + API proxy → localhost:8001
    ├── icons/                  # Customizable SVG icons (single source)
    │   ├── app-logo.svg ~ role.svg  # Per-node-type icons (stroke-based, 24x24)
    │   └── README.md
    └── src/
        ├── main.tsx / index.css
        ├── App.tsx              # Main layout (tabs + filter + DAG + panel, isAdmin-conditional API)
        ├── types/index.ts       # All TypeScript types
        ├── api/
        │   ├── client.ts            # Axios instance + interceptors
        │   ├── auth.ts              # Auth API
        │   ├── user.ts              # /api/user/* endpoints (all users)
        │   └── admin.ts             # /api/admin/* endpoints (admin only)
        ├── stores/              # Zustand (authStore, dagStore)
        ├── utils/
        │   ├── grantDisplay.ts      # buildGrantDisplay() — unified grant grouping + implicit USAGE
        │   ├── inventory-helpers.ts  # SubTab/AllTab types, SUB_TAB_META, formatSQL/Bytes
        │   ├── privColors.ts        # Privilege tag color map
        │   ├── scopeConfig.ts       # SCOPE_ORDER, SCOPE_ICONS
        │   └── toast.ts             # Deduplicating toast
        └── components/
            ├── auth/LoginForm.tsx
            ├── layout/Header.tsx, Sidebar.tsx  # Sidebar uses isAdmin-conditional APIs
            ├── common/
            │   ├── InlineIcon.tsx     # SVG icon renderer
            │   ├── GrantTreeView.tsx  # Unified privilege display (scope-grouped)
            │   └── ExportPngBtn.tsx
            ├── dag/
            │   ├── DAGView.tsx       # React Flow + dagre + filters + re-layout
            │   ├── CustomNode.tsx    # SVG icon node (20x20, FIXED_W=168)
            │   ├── GroupNode.tsx     # Dashed container (16x16 icon)
            │   ├── dagLayout.ts     # dagre layout (3-col grid, cluster overlap correction)
            │   └── nodeIcons.ts     # SVG import + colorizedSvg()
            ├── tabs/
            │   ├── PermissionDetailTab.tsx  # Permission Focus (admin API only)
            │   ├── PermissionMatrix.tsx     # GranteeName, PermissionMatrixView, ObjectPrivilegesPane
            │   ├── InventoryTab.tsx         # My Inventory (isAdmin-conditional API for roles/users)
            │   ├── InventoryDetailPanel.tsx # Detail panel for inventory items (privs, members, objects)
            │   └── inventory-ui.tsx         # Shared UI: SearchInput, Chip, Badge, SortTH, etc.
            └── panels/
                ├── ObjectDetailPanel.tsx  # Permission matrix + Details
                ├── UserDetailPanel.tsx    # GrantTreeView effective privileges
                └── GroupDetailPanel.tsx   # Child objects list
```

## Tech Stack
- **Backend**: Python 3.10+, FastAPI, mysql-connector-python, PyJWT, pydantic-settings
- **Frontend**: React 19, Vite, TypeScript, React Flow (@xyflow/react), @dagrejs/dagre, Tailwind CSS, Zustand
- **Linting**: Ruff (backend), ESLint (frontend), Bandit (security)

## Key Design Decisions

- **Auth**: StarRocks credentials → server-side session + JWT token. `is_admin` determined at login via `can_access_sys()` and stored in session.

- **3-Tier Data Access Architecture**: ← CHANGED (replaces previous "Admin vs Non-Admin")
  - **Common Tier**: `services/common/` — Uses only `INFORMATION_SCHEMA` and `SHOW` commands. StarRocks performs per-user permission filtering automatically, so no additional backend filtering is required. Used by all users, including admins.
  - **Admin Tier**: `services/admin/` — Queries `sys.grants_to_users`, `sys.grants_to_roles`, `sys.role_edges`. Used exclusively for "viewing other users'/roles' permissions." May import Common Tier services for supplemental data.
  - **Shared**: `services/shared/` — `grant_parser.py`, `constants.py`, and other code imported by both tiers.

- **API Route Separation**: ← NEW
  - `/api/auth/*`: Shared (login, session, logout)
  - `/api/user/*`: Calls Common Tier only. Accessible by all users (including non-admin). Returns data scoped to the current user.
  - `/api/admin/*`: Calls Common + Admin Tier. Requires `require_admin` middleware for authorization. Returns organization-wide data.

- **Privilege Resolution Pipeline**: ← CHANGED (replaces previous "2-layer" description)
  - **Admin path** (`services/admin/grant_collector.py`):
    - Collects all grants from `sys.grants_to_users` + `sys.grants_to_roles`
    - Maps full role hierarchy from `sys.role_edges`
    - Supplements builtin role/user grants via `SHOW GRANTS`
    - → `GrantResolver` interprets collected grants per query type (`for_user()`, `for_user_effective()`, `for_role()`, `for_object()`)
  - **User path** (`services/common/grant_service.py`):
    - Collects current user's grants via `SHOW GRANTS FOR {current_user}`
    - Traverses role chain via `SHOW GRANTS FOR ROLE {role}` with BFS
    - Enumerates accessible objects via `INFORMATION_SCHEMA`
    - No additional permission checks needed — StarRocks handles filtering natively

  - **classify_grant()** in `grant_classifier.py`: Single-pass relevance classification (EXACT/PARENT_SCOPE/IMPLICIT_USAGE/IRRELEVANT) via `ObjectQuery` dataclass. (unchanged)
  - **BFS helpers** in `bfs_resolver.py`: `_bfs_child_roles()`, `_bfs_user_privs()`, `_find_ancestors_with_grants()`, `_finalize()` for role inheritance traversal. (unchanged, except `_fetch_role_child_map()` deduplication — now imported from a single location)

- **Implicit USAGE**: TABLE-level grant → implicit DATABASE USAGE + CATALOG USAGE (StarRocks behavior). (unchanged)

- **SHOW GRANTS Parsing**: Consolidated into a single parser at `services/shared/grant_parser.py`. ← CHANGED
  - `_parse_show_grants()`: Converts `SHOW GRANTS` output → `PrivilegeGrant` objects
  - `_row_to_grants()`: Converts `sys.*` table rows → `PrivilegeGrant` objects
  - Handles catalog context extraction, comma-separated roles, and wildcard patterns
  - Previously scattered grant parsing logic (in `my_permissions.py`, `roles.py`) is now consolidated here

- **Grant Display**: `buildGrantDisplay()` in `grantDisplay.ts` — single utility for all privilege display locations. Consistent displayName rules + implicit USAGE injection. (unchanged)

- **Centralized Constants**: ← NEW
  - `services/shared/constants.py`:
    - `BUILTIN_ROLES`: frozenset (previously hardcoded in 4 separate files → now single source)
    - `BFS_MAX_DEPTH`: 100 (previously hardcoded in 2 files → now single source)
  - `utils/normalize.py`:
    - `normalize_fn_name()`: Function signature normalization (previously duplicated in 4 files → now single source)

- **Frontend API Pattern**: ← NEW
  - `api/user.ts`: Calls `/api/user/*` endpoints (all users)
  - `api/admin.ts`: Calls `/api/admin/*` endpoints (admin only)
  - Each tab selects the appropriate API module based on `isAdmin` flag
  - Response schemas remain identical (`DAGGraph`, `PrivilegeGrant`, etc.) — only scope differs

- **DAG**: 3 views (Object Hierarchy TB, Role Hierarchy TB, Full Permission Graph LR). `SET ROLE ALL` before object-hierarchy queries. (unchanged)

- **Icons**: `frontend/icons/` is the single source. All SVGs are stroke-based 24×24 with `width`/`height` attributes. (unchanged)

- **Scope v1**: Read-only (GRANT/REVOKE planned for v2). (unchanged)

## Refactoring Rules

### Layer Architecture
- Layer 1 (Common): INFORMATION_SCHEMA + SHOW commands only. No sys.* tables.
- Layer 2 (Admin): sys.* tables. Must be in services/admin/ directory.
- Shared: grant_parser.py, constants.py — importable by both layers.

### API Route Rules
- /api/user/* routes must ONLY call Layer 1 services
- /api/admin/* routes may call Layer 1 + Layer 2 services
- /api/admin/* routes must verify is_admin via middleware
- /api/auth/* routes are shared (no layer restriction)

### Code Quality
- No duplicate grant parsing logic — use services/shared/grant_parser.py
- No hardcoded builtin roles — use constants.BUILTIN_ROLES
- No duplicate function name normalization — use utils/normalize.py
- All new endpoints must have pytest tests
- Router files must NOT contain business logic (delegate to services)

## Tabs
| Tab | Description | Admin Only |
|-----|-------------|-----------|
| Object Hierarchy | SYSTEM → Catalog → DB → Objects DAG | No |
| Role Map | Role inheritance DAG with full BFS child traversal | No |
| Permission Focus | Search user/role → inheritance DAG + privilege list | Yes |
| My Inventory | Sub-tab browser: Roles/Users/Catalogs/DBs/Tables/MVs/Views/Functions + detail panel | No |
| Full Permission Graph | Combined graph (coming soon) | - |

## My Inventory Sub-tabs
| Sub-tab | Data Source | Detail Panel |
|---------|-----------|-------------|
| Roles | Admin: `/api/roles` (all). Non-admin: `getMyPermissions()` roles | GrantTreeView + Members |
| Users | Admin: role-hierarchy DAG users. Non-admin: hidden (0) | GrantTreeView + Assigned Roles |
| Catalogs | `getMyPermissions().accessible_catalogs` | Permission Matrix + Databases list |
| Databases | `getMyPermissions().accessible_databases` | Permission Matrix + Objects list |
| Tables | `accessible_objects` (BASE TABLE) | Permission Matrix + Column/DDL detail |
| MVs | `accessible_objects` (MATERIALIZED VIEW) | Permission Matrix + Column/DDL detail |
| Views | `accessible_objects` (VIEW) | Permission Matrix + Column/DDL detail |
| Functions | `accessible_objects` (FUNCTION) | Permission Matrix |

## Running (Development)
```bash
# Backend (Terminal 1)
cd backend
source venv/bin/activate
uvicorn app.main:app --reload --port 8001

# Frontend (Terminal 2)
cd frontend
npm run dev
# → http://localhost:5173 (API proxy → localhost:8001)
```

## Linting
```bash
# Backend
ruff check backend/app/
ruff format backend/app/ --check

# Frontend
cd frontend
npx tsc --noEmit
npx eslint src/ --max-warnings 0
```

## Testing
```bash
cd backend
python -m pytest tests/ -v --ignore=tests/test_integration.py  # Unit tests
python -m pytest tests/test_integration.py -v -s               # Integration (needs SR env vars)
```

## Environment Variables
| Variable | Default | Description |
|----------|---------|-------------|
| `SRPM_JWT_SECRET` | change-me... | JWT signing key (must change in production) |
| `SRPM_JWT_EXPIRE_MINUTES` | 60 | Token TTL (minutes) |
| `SRPM_CACHE_TTL_SECONDS` | 60 | Server-side cache TTL |
| `SR_TEST_HOST` | - | Integration test StarRocks host |
| `SR_TEST_PORT` | 9030 | Integration test port |
| `SR_TEST_USER` | - | Integration test username |
| `SR_TEST_PASS` | - | Integration test password |

## API Endpoints

### Shared
- Auth: POST /api/auth/login, POST /api/auth/logout, GET /api/auth/me
- Health: GET /api/health

### User Routes (`/api/user/*` — all users, Layer 1 only)
- Objects: GET /api/user/objects/catalogs, databases, tables, table-detail
- Permissions: GET /api/user/my-permissions
- Roles: GET /api/user/roles, /api/user/roles/hierarchy
- DAG: GET /api/user/dag/object-hierarchy, /api/user/dag/role-hierarchy
- Search: GET /api/user/search

### Admin Routes (`/api/admin/*` — admin only, Layer 1+2, `require_admin` enforced)
- Privileges: GET /api/admin/privileges/user/{name}, user/{name}/effective, role/{name}, role/{name}/raw, object
- Roles: GET /api/admin/roles, hierarchy, inheritance-dag, {name}/users
- DAG: GET /api/admin/dag/object-hierarchy, role-hierarchy, full
- Search: GET /api/admin/search, /api/admin/search/users-roles

