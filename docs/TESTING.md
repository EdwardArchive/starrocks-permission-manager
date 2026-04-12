# Testing Guide

## Prerequisites

- Python 3.10+ with venv
- Node.js 24+ (see `.nvmrc`)
- (Optional) A running StarRocks instance for integration tests

## Running Tests

### Backend Unit Tests

71 tests using mock DB — no StarRocks connection required:

```bash
cd backend
source venv/bin/activate
python -m pytest tests/ -v --ignore=tests/test_integration.py
```

With coverage:

```bash
python -m pytest tests/ -v --ignore=tests/test_integration.py --cov=app
```

### Integration Tests

Requires a running StarRocks instance:

```bash
export SR_TEST_HOST=your-starrocks-host
export SR_TEST_PORT=9030
export SR_TEST_USER=admin
export SR_TEST_PASS=your-password
python -m pytest tests/test_integration.py -v -s
```

### Frontend Tests

```bash
cd frontend
npm test              # run once
npm run test:watch    # watch mode
npm run test:coverage # with coverage report
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

## Environment Variables

### Backend

| Variable | Default | Description |
|----------|---------|-------------|
| `SRPM_JWT_SECRET` | `change-me-...` | JWT signing key (**must change in production**) |
| `SRPM_JWT_EXPIRE_MINUTES` | `60` | Token expiration time (minutes) |
| `SRPM_CACHE_TTL_SECONDS` | `60` | Server-side cache TTL |

### Integration Tests

| Variable | Description |
|----------|-------------|
| `SR_TEST_HOST` | StarRocks FE host |
| `SR_TEST_PORT` | MySQL protocol port (default 9030) |
| `SR_TEST_USER` | Test username |
| `SR_TEST_PASS` | Test password |
