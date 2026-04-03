# StarRocks Permission Manager - CLAUDE.md

## Project Overview
StarRocks permission management Web UI. Visualizes user/role/object permission structures via DAG.

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
├── backend/
│   ├── requirements.txt       # Python dependencies
│   ├── pytest.ini             # Test config
│   ├── app/
│   │   ├── main.py            # FastAPI entry, CORS, router registration, lifespan
│   │   ├── config.py          # pydantic-settings (env: SRPM_*)
│   │   ├── dependencies.py    # JWT auth + DB connection DI
│   │   ├── routers/
│   │   │   ├── auth.py        # POST /api/auth/login|logout, GET /api/auth/me
│   │   │   ├── objects.py     # GET /api/objects/catalogs|databases|tables|table-detail
│   │   │   ├── privileges.py  # GET /api/privileges/user/{name}|effective|object
│   │   │   ├── roles.py       # GET /api/roles|hierarchy|{name}/users
│   │   │   └── dag.py         # GET /api/dag/object-hierarchy|role-hierarchy|full
│   │   ├── services/
│   │   │   ├── starrocks_client.py  # MySQL connector wrapper
│   │   │   └── search.py           # Unified search service
│   │   ├── models/
│   │   │   └── schemas.py     # Pydantic request/response models
│   │   └── utils/
│   │       ├── session.py     # JWT encode/decode
│   │       ├── session_store.py # In-memory server-side session store
│   │       └── cache.py       # Central cache clearing utility
│   ├── tests/
│   │   ├── conftest.py        # FakeConnection mock + fixtures
│   │   ├── test_health.py     # 1 test
│   │   ├── test_auth.py       # 5 tests
│   │   ├── test_objects.py    # 6 tests
│   │   ├── test_privileges.py # 4 tests
│   │   ├── test_roles.py      # 3 tests
│   │   ├── test_dag.py        # 5 tests
│   │   ├── test_search.py     # 5 tests
│   │   ├── test_session_store.py # 6 tests
│   │   └── test_integration.py # 12 tests (requires real SR + env vars)
│   └── API.md                 # Detailed API documentation
└── frontend/
    ├── package.json
    ├── vite.config.ts          # Tailwind + API proxy → localhost:8001
    ├── icons/                  # Customizable SVG icons (single source)
    │   ├── app-logo.svg        # StarRocks logo
    │   ├── system.svg ~ role.svg  # Per-node-type icons
    │   └── README.md           # Icon replacement guide
    └── src/
        ├── main.tsx / index.css
        ├── App.tsx              # Main layout (tabs + filter + DAG + panel)
        ├── types/index.ts       # All TypeScript types
        ├── api/                 # API clients (client, auth, objects, privileges, dag)
        ├── stores/              # Zustand (authStore, dagStore)
        └── components/
            ├── auth/LoginForm.tsx
            ├── layout/Header.tsx, Sidebar.tsx
            ├── dag/
            │   ├── DAGView.tsx       # React Flow + dagre + filters + re-layout
            │   ├── CustomNode.tsx    # SVG icon node (icons/ import)
            │   ├── dagLayout.ts      # dagre layout utility
            │   └── nodeIcons.ts      # icons/ SVG import + colors + colorizedSvg()
            └── panels/
                ├── ObjectDetailPanel.tsx  # Permission matrix + Details
                ├── UserDetailPanel.tsx    # Effective privileges tree
                └── GroupDetailPanel.tsx   # Child objects list
```

## Tech Stack
- **Backend**: Python 3.10+, FastAPI, mysql-connector-python, PyJWT
- **Frontend**: React 18, Vite, TypeScript, React Flow (@xyflow/react), @dagrejs/dagre, Tailwind CSS, Zustand

## Key Design Decisions
- **Auth**: StarRocks credentials → server-side session + JWT token (session_id only, no passwords in token). Per-user StarRocks connection for automatic permission control.
- **Data Source**: `information_schema` as primary (External Catalog compatible). Internal-only data supplemented via `partitions_meta` + DDL parsing. Unsupported sections gracefully skipped.
- **DAG**: 3 views (Object Hierarchy TB, Role Hierarchy TB, Full Permission Graph LR).
- **Icons**: `frontend/icons/` is the single source. React loads SVGs via `?raw` import. `colorizedSvg()` synchronizes with node colors.
- **Scope v1**: Read-only (GRANT/REVOKE planned for v2).

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

## Running (Production Build)
```bash
cd frontend
npm run build   # → dist/

cd backend
uvicorn app.main:app --host 0.0.0.0 --port 8001
# Recommended: serve dist/ via Nginx + proxy /api/ to backend
```

## Testing
```bash
cd backend
source venv/bin/activate
python -m pytest tests/ -v                    # Unit tests (45 tests, mock)
python -m pytest tests/test_integration.py -v -s  # Integration tests (requires SR env vars)
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

## API Auth Flow
1. `POST /api/auth/login` with `{host, port, username, password}`
2. Credentials stored in server-side session; returns JWT token containing session_id
3. All subsequent requests: `Authorization: Bearer <token>`
4. Backend resolves session_id → credentials, opens per-request StarRocks connection
5. `POST /api/auth/logout` invalidates the server-side session

## API Endpoints (18)
- Auth: login, logout, me
- Objects: catalogs, databases, tables, table-detail
- Privileges: user/{name}, user/{name}/effective, object
- Roles: list, hierarchy, {name}/users
- DAG: object-hierarchy, role-hierarchy, full
- Search: /api/search
- Health: /api/health

See `backend/API.md` for detailed specs.
