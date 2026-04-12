# StarRocks Permission Manager - API Documentation

**Base URL**: `http://localhost:8001`
**Interactive Docs**: `http://localhost:8001/docs` (Swagger UI)

---

## Quick Start

```bash
# Login
curl -X POST http://localhost:8001/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"host":"your-starrocks-host","port":9030,"username":"admin","password":"pwd"}'

# Extract token from response
TOKEN="eyJhbG..."

# --- User routes (all users) ---

# My permissions + accessible objects
curl http://localhost:8001/api/user/my-permissions \
  -H "Authorization: Bearer $TOKEN"

# Object Hierarchy DAG (user-scoped)
curl "http://localhost:8001/api/user/dag/object-hierarchy?catalog=default_catalog" \
  -H "Authorization: Bearer $TOKEN"

# --- Admin routes (admin only, returns 403 for non-admin) ---

# Object privileges (permission matrix)
curl "http://localhost:8001/api/admin/privileges/object?catalog=default_catalog&database=mydb&name=mytable&object_type=TABLE" \
  -H "Authorization: Bearer $TOKEN"

# All roles in cluster
curl http://localhost:8001/api/admin/roles \
  -H "Authorization: Bearer $TOKEN"
```

---

## Endpoint Summary

### Authentication & Health
| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/auth/login` | Login with StarRocks credentials |
| POST | `/api/auth/logout` | Invalidate server-side session |
| GET | `/api/auth/me` | Current user info + roles + is_user_admin |
| GET | `/api/health` | Server health check (no auth required) |

### User Routes (`/api/user/*` — all users, Layer 1 only)
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/user/objects/catalogs` | List accessible catalogs |
| GET | `/api/user/objects/databases?catalog=X` | List accessible databases |
| GET | `/api/user/objects/tables?catalog=X&database=Y` | List accessible tables/views/MVs/functions |
| GET | `/api/user/objects/table-detail?catalog=X&database=Y&table=Z` | Detailed metadata |
| GET | `/api/user/my-permissions` | Current user's permission tree + accessible objects |
| GET | `/api/user/roles` | Current user's roles |
| GET | `/api/user/roles/hierarchy` | Current user's role hierarchy DAG |
| GET | `/api/user/dag/object-hierarchy?catalog=X` | Object hierarchy DAG (user-scoped) |
| GET | `/api/user/dag/role-hierarchy` | Role hierarchy DAG (user-scoped) |
| GET | `/api/user/search?q=keyword&limit=50` | Search accessible objects |

### Admin Routes (`/api/admin/*` — admin only, requires `require_admin`)
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/admin/privileges/user/{name}` | User direct privileges |
| GET | `/api/admin/privileges/user/{name}/effective` | Effective privileges (including inherited) |
| GET | `/api/admin/privileges/role/{name}` | Role privileges (including inherited) |
| GET | `/api/admin/privileges/role/{name}/raw` | Raw role grants |
| GET | `/api/admin/privileges/object?catalog=X&database=Y&name=Z&object_type=T` | Privileges on an object |
| GET | `/api/admin/roles` | All roles in cluster |
| GET | `/api/admin/roles/hierarchy` | Full role inheritance DAG |
| GET | `/api/admin/roles/inheritance-dag?name=X&type=role` | Focused inheritance DAG (BFS up + down) |
| GET | `/api/admin/roles/{name}/users` | Users assigned to a role |
| GET | `/api/admin/dag/object-hierarchy?catalog=X` | Object hierarchy DAG (all objects) |
| GET | `/api/admin/dag/role-hierarchy` | Role hierarchy DAG (all roles) |
| GET | `/api/admin/search?q=keyword&limit=50` | Unified search (all objects/users/roles) |
| GET | `/api/admin/search/users-roles?q=keyword` | Fast user/role search |

---

## Authentication

All APIs require JWT Bearer token authentication (except login and logout).
The JWT token contains only a `session_id` and `username` — credentials are stored server-side in an in-memory session store. Each request resolves the session to obtain StarRocks credentials and opens a per-request connection.

**JWT Payload Structure:**
```json
{
  "session_id": "a1b2c3d4...",
  "username": "admin",
  "exp": 1712345678
}
```

> **Note:** Passwords are never included in the JWT token. They are stored only in the server-side session store.

```
Authorization: Bearer <token>
```

---

## 1. Auth API

### POST `/api/auth/login`

Tests the StarRocks connection, creates a server-side session, and issues a JWT token.

**Request Body**
```json
{
  "host": "starrocks-host.internal",
  "port": 9030,
  "username": "admin",
  "password": "your-password"
}
```

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| host | string | Yes | - | StarRocks FE host |
| port | integer | No | 9030 | MySQL protocol port |
| username | string | Yes | - | StarRocks username |
| password | string | Yes | - | Password |

**Response** `200 OK`
```json
{
  "token": "eyJhbGciOiJIUzI1NiIs...",
  "username": "admin",
  "roles": ["root", "db_admin", "public"],
  "default_role": "root"
}
```

**Error** `401 Unauthorized`
```json
{ "detail": "Failed to connect to StarRocks" }
```

---

### GET `/api/auth/me`

Returns the currently authenticated user's info.

**Response** `200 OK`
```json
{
  "username": "admin",
  "roles": ["root", "db_admin", "public"],
  "default_role": "root",
  "is_user_admin": true
}
```

| Field | Type | Description |
|-------|------|-------------|
| username | string | StarRocks username |
| roles | string[] | Assigned role list |
| default_role | string\|null | Currently active role |
| is_user_admin | boolean | Whether user has root or user_admin role. If true, can query other users' privileges |

---

### POST `/api/auth/logout`

Invalidates the server-side session associated with the JWT token. The token becomes unusable after logout.

**Headers**
```
Authorization: Bearer <token>
```

**Response** `200 OK`
```json
{ "detail": "Logged out" }
```

> **Note:** Returns 200 even if no valid token is provided (graceful logout).

---

## 2. Objects API

### GET `/api/objects/catalogs`

Returns the full list of catalogs.

**Response** `200 OK`
```json
[
  { "name": "default_catalog", "catalog_type": "InternalCatalog" },
  { "name": "iceberg_catalog", "catalog_type": "IcebergCatalog" },
  { "name": "hive_catalog", "catalog_type": "HiveCatalog" }
]
```

---

### GET `/api/objects/databases`

Returns the list of databases in a specific catalog.

**Query Parameters**
| Param | Type | Required | Description |
|-------|------|----------|-------------|
| catalog | string | Yes | Catalog name |

**Response** `200 OK`
```json
[
  { "name": "analytics_db", "catalog": "default_catalog" },
  { "name": "sales_db", "catalog": "default_catalog" }
]
```

---

### GET `/api/objects/tables`

Returns objects (tables, views, MVs, functions) in a specific database.

**Query Parameters**
| Param | Type | Required | Description |
|-------|------|----------|-------------|
| catalog | string | Yes | Catalog name |
| database | string | Yes | Database name |

**Response** `200 OK`
```json
[
  { "name": "user_events", "object_type": "TABLE", "catalog": "default_catalog", "database": "analytics_db" },
  { "name": "daily_summary", "object_type": "VIEW", "catalog": "default_catalog", "database": "analytics_db" },
  { "name": "hourly_agg_mv", "object_type": "MATERIALIZED VIEW", "catalog": "default_catalog", "database": "analytics_db" },
  { "name": "parse_ua", "object_type": "FUNCTION", "catalog": "default_catalog", "database": "analytics_db" }
]
```

---

### GET `/api/objects/table-detail`

Returns detailed metadata for an object. Uses `information_schema` as the primary source for External Catalog compatibility.
For Internal Catalogs, additional fields (key_type, distribution, partition, etc.) are provided via DDL parsing.

**Query Parameters**
| Param | Type | Required | Description |
|-------|------|----------|-------------|
| catalog | string | Yes | Catalog name |
| database | string | Yes | Database name |
| table | string | Yes | Table/view name |

**Response** `200 OK`
```json
{
  "table_name": "user_events",
  "table_type": "BASE TABLE",
  "engine": "StarRocks",
  "row_count": 12847293,
  "data_size": 2576980377,
  "create_time": "2025-03-15 09:22:41",
  "update_time": "2026-04-01 22:00:00",
  "comment": "User event tracking table",
  "columns": [
    {
      "name": "event_id",
      "column_type": "bigint",
      "ordinal_position": 1,
      "is_nullable": "NO",
      "column_default": null,
      "column_key": "DUP",
      "comment": "Primary event identifier"
    }
  ],
  "ddl": "CREATE TABLE ...",
  "key_type": "DUPLICATE KEY",
  "distribution_type": "Hash",
  "bucket_keys": ["event_id"],
  "bucket_count": 16,
  "partition_method": "RANGE",
  "partition_key": "event_date",
  "partition_count": 365,
  "replication_num": 3,
  "storage_medium": "SSD",
  "compression": "LZ4"
}
```

| Field | Type | Common | Internal Only | Description |
|-------|------|--------|---------------|-------------|
| table_name | string | Yes | | Table name |
| table_type | string | Yes | | BASE TABLE / VIEW / SYSTEM VIEW |
| engine | string\|null | Yes | | StarRocks / Iceberg / Hive etc. |
| row_count | int\|null | Yes | | Approximate row count |
| data_size | int\|null | Yes | | Size in bytes |
| create_time | string\|null | Yes | | Creation timestamp |
| update_time | string\|null | Yes | | Last modification timestamp |
| comment | string\|null | Yes | | Table comment |
| columns | ColumnInfo[] | Yes | | Column list |
| ddl | string\|null | Yes | | CREATE TABLE/VIEW DDL |
| key_type | string\|null | | Yes | DUPLICATE/PRIMARY/AGGREGATE/UNIQUE KEY |
| distribution_type | string\|null | | Yes | Hash / Random |
| bucket_keys | string[]\|null | | Yes | DISTRIBUTED BY HASH columns |
| bucket_count | int\|null | | Yes | Number of buckets |
| partition_method | string\|null | | Yes | RANGE / LIST / EXPRESSION |
| partition_key | string\|null | | Yes | Partition key column |
| partition_count | int\|null | | Yes | Current partition count |
| replication_num | int\|null | | Yes | Replication factor |
| storage_medium | string\|null | | Yes | SSD / HDD |
| compression | string\|null | | Yes | LZ4 / ZSTD / ZLIB / SNAPPY |

---

## 3. Privileges API

### GET `/api/privileges/user/{username}`

Returns directly granted privileges for a specific user.

**Path Parameters**
| Param | Type | Description |
|-------|------|-------------|
| username | string | StarRocks username |

**Response** `200 OK`
```json
[
  {
    "grantee": "analyst_kim",
    "grantee_type": "USER",
    "object_catalog": "default_catalog",
    "object_database": "sales_db",
    "object_name": "orders",
    "object_type": "TABLE",
    "privilege_type": "SELECT",
    "is_grantable": false,
    "source": "direct"
  }
]
```

---

### GET `/api/privileges/user/{username}/effective`

Returns the user's effective privileges (direct + role-inherited).
Traverses the role hierarchy (up to 16 levels) via BFS to collect all inherited privileges.

**Path Parameters**
| Param | Type | Description |
|-------|------|-------------|
| username | string | StarRocks username |

**Response** `200 OK`
```json
[
  {
    "grantee": "analyst_kim",
    "grantee_type": "USER",
    "object_name": "orders",
    "object_type": "TABLE",
    "privilege_type": "SELECT",
    "source": "direct"
  },
  {
    "grantee": "analyst_role",
    "grantee_type": "ROLE",
    "object_name": "user_events",
    "object_type": "TABLE",
    "privilege_type": "SELECT",
    "source": "analyst_role"
  }
]
```

| Field | Type | Description |
|-------|------|-------------|
| grantee | string | Entity the privilege is granted to (username or role name) |
| grantee_type | string | `USER` or `ROLE` |
| object_catalog | string\|null | Target catalog |
| object_database | string\|null | Target database |
| object_name | string\|null | Target object name |
| object_type | string | SYSTEM / CATALOG / DATABASE / TABLE / VIEW etc. |
| privilege_type | string | SELECT / INSERT / ALTER / DROP / ALL etc. |
| is_grantable | boolean | Whether the privilege can be delegated to others |
| source | string | `"direct"` (directly granted) or role name (inheritance source) |

---

### GET `/api/privileges/role/{rolename}/raw`

Debug endpoint: returns raw `SHOW GRANTS` and `sys.grants_to_roles` output for a role.

**Path Parameters**
| Param | Type | Description |
|-------|------|-------------|
| rolename | string | Role name |

**Response** `200 OK`
```json
{
  "sys_grants_to_roles": [ ... ],
  "show_grants": [ ... ]
}
```

---

### GET `/api/privileges/my-permissions`

Returns the current user's full permission tree and all accessible objects. Uses SHOW GRANTS with BFS role chain traversal.

**Response** `200 OK`
```json
{
  "role_tree": { ... },
  "accessible_catalogs": [ ... ],
  "accessible_databases": [ ... ],
  "accessible_objects": [ ... ],
  "system_objects": [ ... ]
}
```

---

### GET `/api/privileges/object`

Returns all privilege grants on a specific object (users + roles).

**Query Parameters**
| Param | Type | Required | Description |
|-------|------|----------|-------------|
| catalog | string | No | Catalog filter |
| database | string | No | Database filter |
| name | string | No | Object name filter |

**Response** `200 OK` - `PrivilegeGrant[]` (same schema as above)

---

## 4. Roles API

### GET `/api/roles`

Returns the full list of roles.

**Response** `200 OK`
```json
[
  { "name": "root", "is_builtin": true },
  { "name": "db_admin", "is_builtin": true },
  { "name": "user_admin", "is_builtin": true },
  { "name": "cluster_admin", "is_builtin": true },
  { "name": "security_admin", "is_builtin": true },
  { "name": "public", "is_builtin": true },
  { "name": "analyst_role", "is_builtin": false },
  { "name": "etl_role", "is_builtin": false }
]
```

---

### GET `/api/roles/hierarchy`

Returns the role inheritance structure as a DAG. Used directly by the Role Map tab.

**Response** `200 OK` - `DAGGraph` (see DAG schema below)

---

### GET `/api/roles/inheritance-dag`

Returns a focused inheritance DAG for a specific role or user, with full BFS traversal up (parents) and down (children).

**Query Parameters**
| Param | Type | Required | Description |
|-------|------|----------|-------------|
| name | string | Yes | Role or user name |
| type | string | No | `role` (default) or `user` |

**Response** `200 OK` - `DAGGraph`

---

### GET `/api/roles/{role_name}/users`

Returns the list of users assigned to a specific role.

**Path Parameters**
| Param | Type | Description |
|-------|------|-------------|
| role_name | string | Role name |

**Response** `200 OK`
```json
["admin", "analyst_kim", "etl_service"]
```

---

## 5. DAG API

Returns `{nodes, edges}` structures that can be directly fed to React Flow.

### Common DAG Schema

**DAGNode**
| Field | Type | Description |
|-------|------|-------------|
| id | string | Unique identifier (e.g., `c_default_catalog`, `r_analyst_role`, `u_admin`) |
| label | string | Display name |
| type | string | `system` / `catalog` / `database` / `table` / `view` / `mv` / `function` / `user` / `role` |
| color | string\|null | Node color (hex) |
| node_role | string\|null | `"group"` = virtual group node (Tables, Views, etc.) |
| metadata | object\|null | Additional metadata |

**DAGEdge**
| Field | Type | Description |
|-------|------|-------------|
| id | string | Unique identifier |
| source | string | Source node ID |
| target | string | Target node ID |
| edge_type | string | Edge type (see table below) |

**Edge Types**
| edge_type | Color | Description |
|-----------|-------|-------------|
| `hierarchy` | gray dashed | Object hierarchy containment (CATALOG→DB→TABLE) |
| `assignment` | sky blue | Role→User assignment |
| `inheritance` | orange | Role→Role inheritance |
| `select` | green (#22c55e) | SELECT privilege |
| `insert` | blue (#3b82f6) | INSERT privilege |
| `delete` | red (#ef4444) | DELETE privilege |
| `alter` | purple (#a855f7) | ALTER privilege |
| `usage` | gray dashed | USAGE privilege |

---

### GET `/api/dag/object-hierarchy`

Returns the object hierarchy DAG. Structure: SYSTEM → CATALOG → DATABASE → [Type Group] → Objects.

**Query Parameters**
| Param | Type | Required | Description |
|-------|------|----------|-------------|
| catalog | string | No | Filter to a specific catalog (all if omitted) |

**Response** `200 OK` - `DAGGraph`

---

### GET `/api/dag/role-hierarchy`

Returns the role hierarchy DAG. Structure: root (top) → built-in roles → custom roles → users.

**Response** `200 OK` - `DAGGraph`

---

## 6. Health Check

### GET `/api/health`

Checks server status. No authentication required.

**Response** `200 OK`
```json
{ "status": "ok" }
```

---

## Error Responses

All errors follow this format:

```json
{ "detail": "Error message here" }
```

| Status | Description |
|--------|-------------|
| 401 | Authentication failure (invalid token, expired, StarRocks connection failed) |
| 422 | Request parameter validation failure |
| 500 | Internal server error |

---

## Data Source Strategy

| Data | Source | External Catalog Compatible |
|------|--------|-----------------------------|
| Catalog list | `SHOW CATALOGS` | Yes |
| DB list | `SHOW DATABASES` | Yes |
| Object list | `information_schema.tables` | Yes |
| MV detection | `information_schema.materialized_views` | Internal Only |
| Column info | `information_schema.columns` | Yes |
| DDL | `SHOW CREATE TABLE` | Yes |
| Partitions/Buckets | `information_schema.partitions_meta` + DDL parsing | Internal Only |
| User privileges | `sys.grants_to_users` | Yes |
| Role privileges | `sys.grants_to_roles` | Yes |
| Role hierarchy | `sys.role_edges` | Yes |
| Role list | `SHOW ROLES` | Yes |

When unsupported views fail on External Catalogs, those fields return `null` and the frontend automatically hides the corresponding sections.
