# StarRocks Permission Management Web UI - PRD

## 1. Overview

### 1.1 Product Name
**StarRocks Permission Manager**

### 1.2 Purpose
Provides a web UI for **visually querying** the privilege relationships between users, roles, catalogs, and database objects in a StarRocks cluster. Through DAG (Directed Acyclic Graph)-based visualization, users can intuitively understand complex permission structures, with bidirectional exploration supported from both object-centric and user-centric perspectives.

### 1.3 Target Users
- **DBA / Platform Engineer**: Understanding and auditing the overall cluster permission structure
- **Data Engineer / Analyst**: Checking accessible objects for themselves
- **Security / Compliance Team**: Permission auditing and detecting excessive privileges

### 1.4 Scope (v1.0)
- **Read-only**: Only permission querying/visualization is provided (GRANT/REVOKE deferred to v2.0)
- **Authentication**: Uses StarRocks native user credentials
- **3 DAG Views**: Object Hierarchy, Role Hierarchy, Full Permission Graph

---

## 2. Background: StarRocks Privilege Model

### 2.1 Access Control Model
StarRocks uses a dual model of **RBAC (Role-Based Access Control)** + **IBAC (Identity-Based Access Control)**.

- Users hold both direct privileges (IBAC) + assigned role privileges (RBAC)
- User identifier: `username@'userhost'`
- Role inheritance: Maximum **16 levels** deep, no bidirectional cycles allowed

### 2.2 Object Hierarchy
```
SYSTEM (Top-level)
  ├── CATALOG (default_catalog, external catalogs)
  │     ├── DATABASE
  │     │     ├── TABLE
  │     │     ├── VIEW
  │     │     ├── MATERIALIZED VIEW
  │     │     └── FUNCTION
  │     └── (USAGE, CREATE DATABASE, DROP)
  ├── RESOURCE GROUP
  ├── RESOURCE
  ├── STORAGE VOLUME
  ├── GLOBAL FUNCTION
  └── USER
```

### 2.3 Privilege Types by Object

| Object Type | Privileges |
|-------------|-----------|
| **SYSTEM** | NODE, GRANT, CREATE RESOURCE GROUP, CREATE RESOURCE, CREATE EXTERNAL CATALOG, PLUGIN, REPOSITORY, BLACKLIST, FILE, OPERATE, CREATE GLOBAL FUNCTION, CREATE STORAGE VOLUME, SECURITY |
| **CATALOG** | USAGE, CREATE DATABASE, DROP |
| **DATABASE** | CREATE TABLE, CREATE VIEW, CREATE FUNCTION, CREATE MATERIALIZED VIEW, ALTER, DROP, ALL |
| **TABLE** | SELECT, INSERT, UPDATE, DELETE, ALTER, DROP, EXPORT, ALL |
| **VIEW** | SELECT, ALTER, DROP, ALL |
| **MATERIALIZED VIEW** | SELECT, ALTER, REFRESH, DROP, ALL |
| **FUNCTION** | EXECUTE |
| **RESOURCE GROUP** | USAGE, ALTER, DROP |
| **USER** | OPERATE |
| **STORAGE VOLUME** | USAGE, MODIFY |

### 2.4 Built-in Roles

| Role | Description | Scope |
|------|------------|-------|
| `root` | Full cluster privileges | SYSTEM-level, all privileges |
| `cluster_admin` | Node management | NODE operations |
| `db_admin` | Database object management | Full DB/Table/View access |
| `user_admin` | User/role management | SYSTEM-level GRANT |
| `security_admin` | Security configuration management | SYSTEM-level SECURITY, OPERATE |
| `public` | Default role for all users (modifiable) | Administrators can add privileges |

### 2.5 Key SQL Commands
```sql
-- Privilege queries
SHOW GRANTS;                              -- Own privileges
SHOW GRANTS FOR user_or_role;             -- Specific user/role privileges (requires user_admin)
SHOW ROLES;                               -- Full role list
SELECT CURRENT_ROLE();                    -- Current active role

-- System views (StarRocks 3.x+)
SELECT * FROM sys.grants_to_users;        -- Privileges by user
SELECT * FROM sys.grants_to_roles;        -- Privileges by role
SELECT * FROM sys.role_edges;             -- Role inheritance relationships

-- Object enumeration
SHOW CATALOGS;
SHOW DATABASES [FROM catalog];
SHOW TABLES [FROM database];
SHOW VIEWS [FROM database];
SHOW MATERIALIZED VIEWS [FROM database];
```

---

## 3. Functional Requirements

### 3.1 Authentication

| ID | Requirement |
|----|------------|
| AUTH-01 | Login via StarRocks MySQL protocol (port 9030) |
| AUTH-02 | Login requires host, port, username, password input |
| AUTH-03 | UI access scope determined by the logged-in user's StarRocks privileges |
| AUTH-04 | Users without the `user_admin` role can only view their own privileges (graceful degradation) |
| AUTH-05 | Session-based authentication (JWT), re-login required after timeout |

### 3.2 DAG Visualization

#### 3.2.1 Object Hierarchy View
| ID | Requirement |
|----|------------|
| DAG-OBJ-01 | Display SYSTEM → CATALOG → DATABASE → TABLE/VIEW/MV/FUNCTION hierarchy as a Top-to-Bottom DAG |
| DAG-OBJ-02 | Each node shows object type icon + name + privilege count badge |
| DAG-OBJ-03 | Clicking a node opens the permission detail panel for that object |
| DAG-OBJ-04 | Lazy loading: child tables/views load on DB node click |
| DAG-OBJ-05 | Collapse/Expand: DB nodes collapsed by default |
| DAG-OBJ-06 | **Type Group Nodes**: Instead of displaying individual objects directly under a DB, add an intermediate level of group nodes for Tables / Views / MVs / Functions. Structure: `DATABASE → Tables(N) → individual tables`, `DATABASE → Views(N) → individual views`, etc. Ensures readability when the number of objects is large |

#### 3.2.2 Role Hierarchy View
| ID | Requirement |
|----|------------|
| DAG-ROLE-01 | Display role inheritance relationships as a **Top-to-Bottom** Hierarchy DAG (root at the top) |
| DAG-ROLE-02 | Order: root → built-in roles (db_admin, user_admin, cluster_admin, security_admin) → custom roles → users |
| DAG-ROLE-03 | Distinct colors for built-in roles (root=red, built-in=indigo, public=gray, custom=orange) |
| DAG-ROLE-04 | Show the number of assigned users on role nodes |
| DAG-ROLE-05 | Clicking a role displays detailed privileges for that role |

#### 3.2.3 Full Permission Graph View
| ID | Requirement |
|----|------------|
| DAG-FULL-01 | Display users → roles → objects in a single unified graph |
| DAG-FULL-02 | Edge colors distinguish privilege types (SELECT=green, INSERT=blue, DROP=red, etc.) |
| DAG-FULL-03 | Filters: filter by specific user, role, object type, or privilege type |
| DAG-FULL-04 | Large cluster support: virtualization + viewport culling |

#### 3.2.4 Common DAG Features
| ID | Requirement |
|----|------------|
| DAG-COM-01 | Zoom in/out, Pan, Fit-to-view controls |
| DAG-COM-02 | Node search: find nodes by name + focus navigation |
| DAG-COM-03 | Minimap: show current viewport position within the full graph |
| DAG-COM-04 | Tooltip on node hover (summary information) |
| DAG-COM-05 | **Checkbox Filters**: Toggle node visibility by object type (Catalog, Database, Table, View, MV, Function, User, Role) via checkboxes |
| DAG-COM-06 | **DAG Export**: Download the current DAG view as a PNG or JPG image |
| DAG-COM-07 | Export reflects the current checkbox filter state (hidden nodes are excluded from the image) |
| DAG-COM-08 | **Groups Only Mode**: Checkbox to show only virtual group nodes (SYSTEM, CATALOG, DATABASE, Type Groups). Quickly grasp the structure in large clusters |
| DAG-COM-09 | **Re-layout Button**: Restore original dagre layout alignment after dragging nodes (bottom-left controls) |
| DAG-COM-10 | **Sidebar ↔ DAG Synchronization**: Clicking a sidebar item highlights the corresponding node in the DAG + moves the camera. Auto-focus when search results narrow down to a single item |
| DAG-COM-11 | **Node Selection Highlighting**: Highlight the clicked node and its neighbor nodes with their type-specific colors, dim the rest (opacity 0.15) |
| DAG-COM-12 | **Group Node Click**: Clicking a virtual group (Tables, Views, etc.) shows a child object list card instead of the permission matrix (including Row Count, Size, privilege badges) |

### 3.3 Object-Centric Detail Panel

| ID | Requirement |
|----|------------|
| OBJ-01 | Right detail panel slides in when an object node is clicked in the DAG |
| OBJ-02 | Object information display: name, type, parent path (catalog.database.object) |
| OBJ-03 | **Permission Matrix Table**: rows = users/roles, columns = privilege types (SELECT, INSERT, ALTER...) |
| OBJ-04 | Each cell shows privilege source: `[D]` Direct grant / `[I]` Inherited from role |
| OBJ-05 | For role-inherited privileges, tooltip shows which role the privilege was inherited from |
| OBJ-06 | User/role filter and sort functionality |
| OBJ-07 | **Details Sub-tab**: Display object-type-specific metadata (see 3.3.1 below) |

#### 3.3.1 Details Tab - Data Source Strategy

> **Core Principle**: Since available metadata varies by External Catalog type (Hive, Iceberg, Elasticsearch, JDBC, etc.),
> use **`information_schema` as the primary data source**, and display Internal Catalog-specific information as additional sections.
> Unsupported sections are gracefully hidden without errors.

**INFORMATION_SCHEMA Support by Catalog Type** (StarRocks v3.2+)

| information_schema view | Internal | Hive | Iceberg | JDBC (MySQL/PG) | Elasticsearch |
|----------------------|----------|------|---------|-----------------|---------------|
| `tables` | O | O | O | O | O |
| `columns` | O | O | O | O | O |
| `schemata` | O | O | O | O | O |
| `views` | O | O | O | O | - |
| `partitions_meta` | O | **X** | **X** | **X** | **X** |
| `materialized_views` | O | **X** | **X** | **X** | **X** |
| `user_privileges` | O | O | O | O | O |
| `applicable_roles` | O | O | O | O | O |

#### 3.3.2 Details Tab - Display Items by Object Type

**TABLE**

*Common (All Catalogs) - `information_schema.tables` + `information_schema.columns`*
| Item | Source | Description |
|------|--------|------|
| Table Name | `tables.TABLE_NAME` | Table name |
| Table Type | `tables.TABLE_TYPE` | BASE TABLE / VIEW / SYSTEM VIEW |
| Engine | `tables.ENGINE` | StarRocks, MySQL, Hive, etc. |
| Row Count | `tables.TABLE_ROWS` | Approximate row count |
| Data Size | `tables.DATA_LENGTH` | Size in bytes |
| Avg Row Length | `tables.AVG_ROW_LENGTH` | Average row size |
| Created | `tables.CREATE_TIME` | Creation timestamp |
| Updated | `tables.UPDATE_TIME` | Last modification timestamp |
| Comment | `tables.TABLE_COMMENT` | Table description |
| Columns | `columns.*` | COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT, COLUMN_KEY, COLUMN_COMMENT |

```sql
-- Common query (works on all catalogs)
SELECT * FROM information_schema.tables
WHERE TABLE_CATALOG = ? AND TABLE_SCHEMA = ? AND TABLE_NAME = ?;

SELECT COLUMN_NAME, ORDINAL_POSITION, COLUMN_TYPE, COLUMN_KEY,
       IS_NULLABLE, COLUMN_DEFAULT, COLUMN_COMMENT
FROM information_schema.columns
WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
ORDER BY ORDINAL_POSITION;
```

*Internal Catalog Only - `information_schema.partitions_meta` + `SHOW CREATE TABLE`*
| Item | Source | Description |
|------|--------|------|
| Key Type | `SHOW CREATE TABLE` parsing | DUPLICATE KEY / PRIMARY KEY / AGGREGATE KEY / UNIQUE KEY |
| Sort Keys | `SHOW CREATE TABLE` parsing | Sort key columns |
| Distribution Type | `SHOW CREATE TABLE` parsing | Hash / Random |
| Bucket Keys | `SHOW CREATE TABLE` parsing | DISTRIBUTED BY HASH columns |
| Bucket Count | `partitions_meta.BucketNum` | Number of buckets |
| Partition Method | `SHOW CREATE TABLE` parsing | Range / List / Expression |
| Partition Key | `partitions_meta.PartitionKey` | Partition key column |
| Partition Count | `COUNT(*) FROM partitions_meta` | Number of partitions |
| Distribution Key | `partitions_meta.DistributionKey` | Distribution key |
| Replication Num | `partitions_meta.ReplicationNum` | Replication count |
| Storage Medium | `partitions_meta.StorageMedium` | SSD / HDD |
| Cooldown Time | `partitions_meta.CooldownTime` | SSD to HDD transition time |
| Compression | `SHOW CREATE TABLE` (PROPERTIES) | LZ4 / ZSTD / ZLIB / SNAPPY |
| Bloom Filter | `SHOW CREATE TABLE` (PROPERTIES) | Bloom filter columns |
| Colocate Group | `SHOW CREATE TABLE` (PROPERTIES) | Colocate group |
| DDL | `SHOW CREATE TABLE` | Full CREATE statement (collapsible) |

```sql
-- Internal Catalog only (graceful skip on External)
SELECT PartitionName, PartitionKey, DistributionKey, BucketNum,
       ReplicationNum, StorageMedium, CooldownTime, DataSize, RowCount
FROM information_schema.partitions_meta
WHERE DB_NAME = ? AND TABLE_NAME = ?;

SHOW CREATE TABLE catalog.database.table;
```

**VIEW**
| Item | Source | Catalog Support |
|------|--------|-------------|
| View Name | `views.TABLE_NAME` | All catalogs |
| Definition | `views.VIEW_DEFINITION` | All catalogs |
| Is Updatable | `views.IS_UPDATABLE` | All catalogs |
| Definer | `views.DEFINER` | All catalogs |
| DDL | `SHOW CREATE VIEW` | Internal preferred |

```sql
SELECT VIEW_DEFINITION, IS_UPDATABLE, DEFINER
FROM information_schema.views
WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?;
```

**MATERIALIZED VIEW** (Internal Catalog Only)
| Item | Source | Description |
|------|--------|------|
| Refresh Type | `materialized_views.REFRESH_TYPE` | ASYNC / MANUAL / ROLLUP |
| Is Active | `materialized_views.IS_ACTIVE` | Whether active |
| Inactive Reason | `materialized_views.INACTIVE_REASON` | Reason for being inactive |
| Last Refresh Time | `materialized_views.LAST_REFRESH_FINISHED_TIME` | Last refresh timestamp |
| Last Refresh Duration | `materialized_views.LAST_REFRESH_DURATION` | Refresh duration (ms) |
| Last Refresh State | `materialized_views.LAST_REFRESH_STATE` | SUCCESS / FAILED |
| Row Count | `materialized_views.TABLE_ROWS` | Row count |
| Query Rewrite | `materialized_views.QUERY_REWRITE_STATUS` | Automatic query rewrite status |
| Creator | `materialized_views.CREATOR` | Creator |
| Definition | `materialized_views.MATERIALIZED_VIEW_DEFINITION` | MV definition query |

```sql
SELECT REFRESH_TYPE, IS_ACTIVE, INACTIVE_REASON,
       LAST_REFRESH_FINISHED_TIME, LAST_REFRESH_DURATION, LAST_REFRESH_STATE,
       TABLE_ROWS, QUERY_REWRITE_STATUS, CREATOR,
       MATERIALIZED_VIEW_DEFINITION
FROM information_schema.materialized_views
WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?;
```

**DATABASE**
| Item | Source | Catalog Support |
|------|--------|-------------|
| Schema Name | `schemata.SCHEMA_NAME` | All catalogs |
| Character Set | `schemata.DEFAULT_CHARACTER_SET_NAME` | All catalogs |
| Collation | `schemata.DEFAULT_COLLATION_NAME` | All catalogs |
| Table Count | `COUNT(*) FROM tables WHERE TABLE_SCHEMA=?` | All catalogs |
| Object Breakdown | `GROUP BY TABLE_TYPE FROM tables` | All catalogs |

```sql
SELECT TABLE_TYPE, COUNT(*) as cnt
FROM information_schema.tables
WHERE TABLE_CATALOG = ? AND TABLE_SCHEMA = ?
GROUP BY TABLE_TYPE;
```

**CATALOG**
| Item | Source | Description |
|------|--------|------|
| Type | `SHOW CATALOGS` | Internal / External (Iceberg, Hive, JDBC, etc.) |
| Database Count | `COUNT(*) FROM schemata WHERE CATALOG_NAME=?` | Number of databases |
| Properties | `SHOW CREATE CATALOG` (External only) | Connection properties (URI, warehouse, etc.) |

**ROLE**
| Item | Source | Description |
|------|--------|------|
| Built-in | metadata | Whether it is a system built-in role |
| Assigned Users | `sys.role_edges` / `SHOW GRANTS` | List and count of assigned users |
| Parent Roles | `sys.role_edges` | Parent roles (roles inherited from) |
| Child Roles | `sys.role_edges` | Child roles (roles that inherit from this role) |
| Total Privileges | `sys.grants_to_roles` | Total number of granted privileges |

#### 3.3.3 Details Tab - UI Behavior Rules

| Rule | Description |
|------|------|
| **Graceful Degradation** | Hide the section when a query fails (no error displayed). If `partitions_meta` query fails on External Catalog, the Distribution/Partition section is automatically hidden |
| **Catalog Type Detection** | Cache each catalog's `CatalogType` via `SHOW CATALOGS` at login. Skip unnecessary queries in advance based on the type |
| **Common → Specific Order** | Always execute `information_schema` common queries first, then run Internal-specific queries after success |
| **Caching** | Server-side TTL cache for metadata query results (60 seconds). Prevents StarRocks load on repeated clicks of the same object |

### 3.4 User-Centric Side Panel

| ID | Requirement |
|----|------------|
| USR-01 | Right side panel slides in when a user is clicked in the sidebar or DAG |
| USR-02 | User information: name, assigned role list, default role |
| USR-03 | **Object Permission Tree**: Display accessible objects in Catalog → Database → Table hierarchy |
| USR-04 | Privilege type badges next to each object (SELECT, INSERT, etc.) |
| USR-05 | Privilege source display: Direct grant vs role name |
| USR-06 | Effective privileges calculation: aggregate direct privileges + all role-inherited privileges |

### 3.5 Sidebar Navigation

| ID | Requirement |
|----|------------|
| NAV-01 | **Catalog Tree**: Collapsible Catalog → DB → Table tree |
| NAV-02 | **User List**: Full user list (when user_admin role is available) |
| NAV-03 | **Role List**: Full role list |
| NAV-04 | **Search**: Search objects/users/roles within the sidebar |
| NAV-05 | Clicking a sidebar item highlights the corresponding node in the DAG + moves the camera + opens the detail panel |
| NAV-06 | **Catalog Tree Type Groups**: Display Tables / Views / MVs / Functions groups under each DB (same structure as DAG) |
| NAV-07 | **Sidebar Icon Consistency**: Use the same SVG icons as DAG nodes (auto-injected based on ICON_CONFIG) |

### 3.6 Icon and Logo Customization

| ID | Requirement |
|----|------------|
| ICON-01 | **ICON_CONFIG**: SVG icon + color definitions for 9 node types (system, catalog, database, table, view, mv, function, user, role). Managed in a single location in code |
| ICON-02 | **APP_LOGO**: App main logo (Login screen 48px + Header 24px). Default: StarRocks official SVG logo |
| ICON-03 | **Icon color = Node border color** synchronization. Background color transparent |
| ICON-04 | **Icon Replacement**: Can be changed by modifying ICON_CONFIG paths values or replacing SVG files in the icons/ folder |
| ICON-05 | **Auto Resize**: Any SVG of any size/viewBox is normalized to a square to fit within nodes |

### 3.7 DAG Controls (Bottom-Left)

| ID | Requirement |
|----|------------|
| CTL-01 | **Zoom In/Out** buttons |
| CTL-02 | **Fit to View** button: Automatically adjust so all nodes fit on screen |
| CTL-03 | **Re-layout Button**: Restore dagre layout alignment after manually dragging nodes (with animation) |

---

## 4. Non-Functional Requirements

| ID | Requirement |
|----|------------|
| NFR-01 | **Performance**: DAG rendering within 3 seconds for clusters with 1000+ objects (leveraging lazy loading) |
| NFR-02 | **Caching**: Server-side TTL cache (60 seconds) - prevents StarRocks load on repeated clicks |
| NFR-03 | **Security**: Data access controlled by StarRocks native privileges, JWT httpOnly cookies |
| NFR-04 | **Compatibility**: StarRocks 3.x+ (uses sys views), modern browsers (Chrome, Firefox, Edge) |
| NFR-05 | **Responsive**: Minimum 1280px width supported |

---

## 5. Tech Stack

| Layer | Technology | Justification |
|-------|-----------|---------------|
| **Backend** | Python FastAPI | Existing project is Python-based, reuses mysql-connector-python patterns |
| **DB Driver** | mysql-connector-python | StarRocks MySQL protocol compatible, proven driver |
| **Auth** | PyJWT | Lightweight JWT token management |
| **Frontend** | React 18 + Vite + TypeScript | Optimal for SPA interactive UI |
| **DAG Library** | React Flow (@xyflow/react) + dagre | Industry standard for node-based DAG UI |
| **State** | Zustand | Lightweight state management |
| **Styling** | Tailwind CSS | Rapid UI development |

---

## 6. UI/UX Design

### 6.1 Layout
3-column layout:
- **Left Sidebar** (300px): Catalog tree + User/Role list
- **Main Content** (flexible): DAG visualization + Tab navigation
- **Right Detail Panel** (350px, conditional): Object/User detail information

### 6.2 Color Coding

**Colors by Privilege Type:**
| Privilege | Color | Usage |
|-----------|-------|-------|
| SELECT | `#22c55e` (green) | Read privilege |
| INSERT | `#3b82f6` (blue) | Write privilege |
| UPDATE | `#f59e0b` (amber) | Modify privilege |
| DELETE | `#ef4444` (red) | Delete privilege |
| ALTER | `#a855f7` (purple) | DDL privilege |
| DROP | `#dc2626` (dark red) | Dangerous privilege |
| ALL | `#6366f1` (indigo) | Full privilege |
| USAGE | `#64748b` (slate) | Access privilege |

**Icons/Colors by Node Type:**
| Object Type | Icon | Border Color |
|------------|------|-------------|
| SYSTEM | ⚙️ | gray |
| CATALOG | 📚 | blue |
| DATABASE | 🗄️ | green |
| TABLE | 📋 | indigo |
| VIEW | 👁️ | purple |
| MATERIALIZED VIEW | ⚡ | amber |
| FUNCTION | 𝑓(x) | teal |
| USER | 👤 | sky |
| ROLE | 🛡️ | orange |

### 6.3 Interaction Flow
```
Login → Main Dashboard
  ├── Tab: Object Hierarchy → Click Object → Right Panel (Permission Matrix)
  ├── Tab: Role Map → Click Role → Right Panel (Role Details + Privileges)
  └── Tab: Full Graph → Click User/Object → Right Panel (Context-specific)

Sidebar:
  ├── Catalog Tree → Click Item → Highlight in DAG + Open Detail Panel
  ├── Users List → Click User → Open User Side Panel
  └── Roles List → Click Role → Highlight in DAG + Open Detail Panel
```

---

## 7. Reference: Best Practices from Industry

### 7.1 Snowflake
- **Roles Graph**: Displays role inheritance as a top-down DAG, visualizing inheritance paths
- Applied: Same pattern used in the Role Hierarchy View

### 7.2 Databricks Unity Catalog
- **Object → Permissions Tab**: Permission management UI when clicking an object
- Applied: Permission matrix in the Object Detail Panel

### 7.3 Apache Ranger
- **Policy-Based Management**: Resource-level policy UI per service
- Applied: Filtering and policy view concepts

### 7.4 Collibra
- **Responsibilities Tab**: Role assignment display on domain/community pages
- Applied: User/role list in the Object Detail Panel

### 7.5 UX Best Practices
- **Dual View** (Object-centric + User-centric) bidirectional exploration support
- **Progressive Disclosure**: Gradual information exposure through node expand/collapse
- **Permission Matrix**: At-a-glance overview with rows = subjects, columns = privileges
- **Direct vs Inherited Distinction**: Clear display of privilege sources

---

## 8. Future Roadmap (v2.0+)

| Version | Feature |
|---------|---------|
| v2.0 | GRANT/REVOKE UI (privilege granting/revocation) |
| v2.0 | Bulk Operations (mass privilege management) |
| v2.0 | Implicit DB Access Display - Show whether users with table-level privileges have implicit access (USE) to the corresponding database |
| v2.0 | Per-user Connection Pooling - JWT credentials-based per-user TTL connection pool (current: new TCP connection per request) |
| v2.0 | Async Migration - Full migration to aiomysql + async def endpoints (current: sync + ThreadPoolExecutor parallelism) |

---

## 9. API Specification Summary

**Base URL**: `http://localhost:8001/api`

### Authentication
- `POST /auth/login` → `{token, user_info}`
- `POST /auth/logout`
- `GET /auth/me` → `{username, roles, default_role}`

### Objects
- `GET /objects/catalogs` → `[{name, type}]`
- `GET /objects/databases?catalog=X` → `[{name}]`
- `GET /objects/tables?catalog=X&database=Y` → `[{name, type}]`

### Privileges
- `GET /privileges/user/{name}` → `[{object, privilege, is_grantable}]`
- `GET /privileges/user/{name}/effective` → `[{object, privilege, source}]`
- `GET /privileges/object?catalog=X&database=Y&name=Z` → `[{grantee, privilege, source}]`

### Roles
- `GET /roles` → `[{name, is_builtin}]`
- `GET /roles/hierarchy` → `{nodes, edges}`
- `GET /roles/{name}/users` → `[{username}]`

### DAG
- `GET /dag/object-hierarchy?catalog=X` → `{nodes, edges}`
- `GET /dag/role-hierarchy` → `{nodes, edges}`
- `GET /dag/full?catalog=X` → `{nodes, edges}`

---

## 10. Glossary

| Term | Definition |
|------|-----------|
| **RBAC** | Role-Based Access Control - Access control based on roles |
| **IBAC** | Identity-Based Access Control - Direct privilege assignment to users |
| **DAG** | Directed Acyclic Graph - A directed graph with no cycles |
| **Effective Privileges** | Combined effective privileges from direct grants + role-inherited privileges |
| **Grantable** | Privileges that can be delegated to other users/roles |
| **role_edges** | StarRocks system view that stores role inheritance relationships |
