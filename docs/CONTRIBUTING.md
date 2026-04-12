# Contributing to StarRocks Permission Manager

## Architecture

```
├── Dockerfile           # Multi-stage build (frontend + backend)
├── docs/
│   ├── API.md               # Full API documentation
│   ├── CONTRIBUTING.md      # Contributing guide
│   ├── TESTING.md           # Testing guide
│   └── screenshots/         # UI screenshots
├── backend/             # Python FastAPI server
│   ├── requirements.txt
│   └── app/
│       ├── main.py
│       ├── config.py
│       ├── dependencies.py     # JWT auth + DB connection DI + require_admin guard
│       ├── routers/
│       │   ├── auth.py              # /api/auth/* (shared)
│       │   ├── user_*.py            # /api/user/* (all users, Layer 1 only)
│       │   └── admin_*.py           # /api/admin/* (admin only, Layer 1+2)
│       ├── services/
│       │   ├── starrocks_client.py  # MySQL connector wrapper
│       │   ├── grant_collector.py   # Facade (delegates to common or admin)
│       │   ├── shared/              # Constants, name_utils, role_graph
│       │   ├── common/              # Layer 1: SHOW + INFORMATION_SCHEMA
│       │   └── admin/               # Layer 2: sys.* tables (admin only)
│       ├── models/             # Pydantic schemas
│       └── utils/              # JWT session, session store, cache, role_helpers, sys_access
└── frontend/            # React 19 + Vite + TypeScript
    ├── icons/           # Customizable SVG icons (single source of truth)
    └── src/
        ├── api/         # API clients (client.ts, auth.ts, user.ts, admin.ts)
        ├── stores/      # Zustand state management
        ├── utils/       # grantDisplay, inventory-helpers, privColors, scopeConfig, toast
        └── components/
            ├── auth/    # Login form
            ├── layout/  # Header, Sidebar (isAdmin-conditional APIs)
            ├── common/  # InlineIcon, GrantTreeView, ExportPngBtn
            ├── dag/     # React Flow + dagre layout
            ├── tabs/    # PermissionDetailTab, PermissionMatrix, InventoryTab, InventoryDetailPanel, inventory-ui
            └── panels/  # Object / User / Group detail panels
```

## Prerequisites

- Python 3.10+
- Node.js 24+ (see `.nvmrc`)
- A running StarRocks instance (for integration tests)

## Development Setup

```bash
# Backend
cd backend
python -m venv venv && source venv/bin/activate
pip install -r requirements.txt

# Frontend
cd frontend
npm install
```

## Running Tests

```bash
# Backend unit tests (with coverage)
cd backend
python -m pytest tests/ -v --ignore=tests/test_integration.py --cov=app

# Frontend unit tests (with coverage)
cd frontend
npm test              # run once
npm run test:watch    # watch mode
npm run test:coverage # with coverage report
```

For detailed testing instructions (unit, integration, environment variables, linting), see [TESTING.md](TESTING.md).

## Code Quality

All checks must pass before merging:

```bash
# Backend linting
ruff check backend/app/
ruff format backend/app/ --check

# Frontend linting
cd frontend
npx tsc --noEmit
npx eslint src/ --max-warnings 0
```

## Pull Request Guidelines

1. Create a feature branch from `main` (`feature/your-feature` or `fix/your-fix`)
2. Write tests for new functionality (backend: pytest, frontend: Vitest)
3. Ensure all CI checks pass (lint, type check, tests)
4. Coverage for new code should be 80%+ (enforced by Codecov patch check)
5. Keep PRs focused — one feature or fix per PR

## Project Conventions

- **Backend**: Router files must NOT contain business logic (delegate to services)
- **Backend**: No duplicate grant parsing — use `services/shared/grant_parser.py`
- **Backend**: No hardcoded builtin roles — use `constants.BUILTIN_ROLES`
- **Frontend**: Use `api/user.ts` for user-scoped endpoints, `api/admin.ts` for admin endpoints
- **Frontend**: Test pure utility functions first, then stores, then components
