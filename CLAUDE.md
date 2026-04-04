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
│   ├── app/
│   │   ├── main.py            # FastAPI entry, CORS, router registration, lifespan
│   │   ├── config.py          # pydantic-settings (env: SRPM_*)
│   │   ├── dependencies.py    # JWT auth + DB connection DI (includes is_admin in credentials)
│   │   ├── routers/
│   │   │   ├── auth.py        # POST /api/auth/login|logout, GET /api/auth/me
│   │   │   ├── objects.py     # GET /api/objects/catalogs|databases|tables|table-detail
│   │   │   ├── privileges.py  # GET /api/privileges/* (refactored: ObjectQuery + classify_grant pipeline)
│   │   │   ├── roles.py       # GET /api/roles|hierarchy|{name}/users|inheritance-dag
│   │   │   ├── dag.py         # GET /api/dag/object-hierarchy|role-hierarchy|full
│   │   │   └── search.py      # GET /api/search|search/users-roles
│   │   ├── services/
│   │   │   ├── starrocks_client.py  # MySQL connector wrapper + parallel_queries
│   │   │   └── user_service.py      # get_all_users (cached)
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
│       ├── conftest.py        # FakeConnection mock + fixtures
│       ├── test_*.py          # Unit tests (57+)
│       └── test_integration.py # Integration tests (26, requires real SR)
└── frontend/
    ├── package.json
    ├── vite.config.ts          # Tailwind + API proxy → localhost:8001
    ├── icons/                  # Customizable SVG icons (single source)
    │   ├── app-logo.svg ~ role.svg  # Per-node-type icons (stroke-based, 24x24)
    │   └── README.md
    └── src/
        ├── main.tsx / index.css
        ├── App.tsx              # Main layout (tabs + filter + DAG + panel)
        ├── types/index.ts       # All TypeScript types
        ├── api/                 # API clients (client, auth, objects, privileges, dag, search)
        ├── stores/              # Zustand (authStore, dagStore)
        ├── utils/
        │   ├── grantDisplay.ts  # buildGrantDisplay() — unified grant grouping + implicit USAGE
        │   ├── privColors.ts    # Privilege tag color map
        │   ├── scopeConfig.ts   # SCOPE_ORDER, SCOPE_ICONS
        │   └── toast.ts         # Deduplicating toast
        └── components/
            ├── auth/LoginForm.tsx
            ├── layout/Header.tsx, Sidebar.tsx
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
            │   ├── PermissionDetailTab.tsx  # Permission Focus (admin only)
            │   └── InventoryTab.tsx         # My Inventory (sub-tabs + list + detail panel)
            └── panels/
                ├── ObjectDetailPanel.tsx  # Permission matrix + Details
                ├── UserDetailPanel.tsx    # GrantTreeView effective privileges
                └── GroupDetailPanel.tsx   # Child objects list
```

## Tech Stack
- **Backend**: Python 3.10+, FastAPI, mysql-connector-python, PyJWT, pydantic-settings
- **Frontend**: React 18, Vite, TypeScript, React Flow (@xyflow/react), @dagrejs/dagre, Tailwind CSS, Zustand
- **Linting**: Ruff (backend), ESLint (frontend), Bandit (security)

## Key Design Decisions
- **Auth**: StarRocks credentials → server-side session + JWT token. `is_admin` determined at login via `can_access_sys()` and stored in session.
- **Admin vs Non-Admin**: Backend detects `credentials["is_admin"]` on each request. Admin path uses `sys.*` tables. Non-admin falls back to `SHOW GRANTS` parsing with BFS role chain traversal.
- **Privilege Resolution**: 6-step pipeline in `get_object_privileges()`:
  1. `_collect_sys_grants()` — query sys.grants_to_users/roles
  2. `_supplement_builtins()` — SHOW GRANTS for builtin roles
  3. `classify_grant()` — single-pass relevance classification (EXACT/PARENT_SCOPE/IMPLICIT_USAGE/IRRELEVANT)
  4. `_bfs_child_roles()` — downward BFS for inheriting roles
  5. `_bfs_user_privs()` — find users with inherited access
  6. `_finalize()` — USAGE conversion + dedup
- **Implicit USAGE**: TABLE-level grant → implicit DATABASE USAGE + CATALOG USAGE (StarRocks behavior)
- **SHOW GRANTS Parsing**: Extracts catalog context from row's `Catalog` column. Handles `ON DATABASE X` (X=database, not catalog), comma-separated roles, wildcard patterns.
- **Grant Display**: `buildGrantDisplay()` in `grantDisplay.ts` — single utility for all 4 privilege display locations. Consistent displayName rules + implicit USAGE injection.
- **DAG**: 3 views (Object Hierarchy TB, Role Hierarchy TB, Full Permission Graph LR). `SET ROLE ALL` before object-hierarchy queries.
- **Icons**: `frontend/icons/` is the single source. All SVGs are stroke-based 24x24 with `width`/`height` attributes.
- **Scope v1**: Read-only (GRANT/REVOKE planned for v2).

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

## API Endpoints (20)
- Auth: login, logout, me
- Objects: catalogs, databases, tables, table-detail
- Privileges: user/{name}, user/{name}/effective, role/{name}, role/{name}/raw, object, my-permissions
- Roles: list, hierarchy, {name}/users, inheritance-dag
- DAG: object-hierarchy, role-hierarchy, full
- Search: /api/search, /api/search/users-roles
- Health: /api/health
