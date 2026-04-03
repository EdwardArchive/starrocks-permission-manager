from __future__ import annotations

import logging
import re

from fastapi import APIRouter, Depends, Query

from app.dependencies import get_db
from app.models.schemas import PrivilegeGrant
from app.services.starrocks_client import execute_query
from app.utils.sql_safety import safe_name

# ── Compiled regex patterns for GRANT statement parsing ──
_RE_GRANT_ON = re.compile(r"GRANT\s+(.+?)\s+ON\s+(.+?)\s+TO\s+", re.I)
_RE_ALL_IN_DB = re.compile(r"ALL\s+(\w+(?:\s+\w+)*?)S?\s+IN\s+(?:ALL\s+DATABASES|DATABASE\s+(\S+))", re.I)
_RE_TYPE_PATH = re.compile(r"(\w+(?:\s+\w+)*?)\s+(`[^`]+`(?:\.`[^`]+`)*|[\w.*]+(?:\.[\w.*]+)*)", re.I)

logger = logging.getLogger("privileges")

router = APIRouter()


@router.get("/user/{username}", response_model=list[PrivilegeGrant])
def get_user_privileges(username: str, conn=Depends(get_db)):
    return _query_grants_for(conn, username, "USER")


@router.get("/role/{rolename}", response_model=list[PrivilegeGrant])
def get_role_privileges(rolename: str, conn=Depends(get_db)):
    """Get privileges for a role, including inherited from parent roles."""
    # Direct grants
    direct = _query_grants_for(conn, rolename, "ROLE")

    # BFS through parent role hierarchy — track immediate parent for source
    direct_parents = _get_parent_roles(conn, rolename)
    visited = {rolename}
    queue: list[tuple[str, str]] = [(p, p) for p in direct_parents]  # (role, direct_parent)
    inherited = []
    while queue and len(visited) < 100:
        parent, origin = queue.pop(0)
        if parent in visited:
            continue
        visited.add(parent)
        grants = _query_grants_for(conn, parent, "ROLE")
        for g in grants:
            g.source = origin
        inherited.extend(grants)
        queue.extend((gp, origin) for gp in _get_parent_roles(conn, parent))

    return direct + inherited


@router.get("/role/{rolename}/raw")
def get_role_privileges_raw(rolename: str, conn=Depends(get_db)):
    """Debug: return raw SHOW GRANTS output for a role."""
    results = {"sys_grants_to_roles": [], "show_grants": []}
    try:
        rows = execute_query(conn, "SELECT * FROM sys.grants_to_roles WHERE GRANTEE = %s", (rolename,))
        results["sys_grants_to_roles"] = [dict(r) for r in rows]
    except Exception as e:
        results["sys_grants_to_roles_error"] = str(e)
    try:
        rows = execute_query(conn, f"SHOW GRANTS FOR ROLE '{safe_name(rolename)}'")
        results["show_grants"] = [dict(r) for r in rows]
    except Exception as e:
        results["show_grants_error"] = str(e)
    return results


@router.get("/user/{username}/effective", response_model=list[PrivilegeGrant])
def get_user_effective_privileges(username: str, conn=Depends(get_db)):
    """Resolve all privileges including inherited through roles."""
    # Direct grants
    direct = _query_grants_for(conn, username, "USER")

    # Get directly assigned roles
    direct_roles = _get_user_roles(conn, username)

    # BFS through role hierarchy — track which direct role each inherited role came from
    visited: set[str] = set()
    queue: list[tuple[str, str]] = [(r, r) for r in direct_roles]  # (role, originating_direct_role)
    role_origin: dict[str, str] = {}  # role → direct role it was inherited through
    while queue and len(visited) < 100:
        role, origin = queue.pop(0)
        if role in visited:
            continue
        visited.add(role)
        role_origin[role] = origin
        parents = _get_parent_roles(conn, role)
        queue.extend((p, origin) for p in parents)

    # Collect grants for all roles — source = the direct role the user was assigned
    inherited = []
    for role, origin in role_origin.items():
        grants = _query_grants_for(conn, role, "ROLE")
        for g in grants:
            g.source = origin if origin != role else role
        inherited.extend(grants)

    return direct + inherited


@router.get("/object", response_model=list[PrivilegeGrant])
def get_object_privileges(
    catalog: str = Query(None),
    database: str = Query(None),
    name: str = Query(None),
    conn=Depends(get_db),
):
    """Get all grants on a specific object, including inherited from parent scopes."""
    results = []

    # Build filters for exact match + parent scope matches
    # e.g. for table "cat.db.tbl": also match grants on "cat.db.*" and "cat.*.*" and SYSTEM
    filters = [_build_object_filter(catalog, database, name)]
    if name and database:
        # Database-level grants (OBJECT_NAME IS NULL) apply to all tables in that DB
        clauses, params = [], []
        if catalog:
            clauses.append("OBJECT_CATALOG = %s")
            params.append(catalog)
        clauses.append("OBJECT_DATABASE = %s")
        params.append(database)
        clauses.append("OBJECT_NAME IS NULL")
        filters.append((" AND ".join(clauses), tuple(params)))
    if database and catalog:
        # Catalog-level grants (OBJECT_DATABASE IS NULL) apply to all DBs
        filters.append(("OBJECT_CATALOG = %s AND OBJECT_DATABASE IS NULL AND OBJECT_NAME IS NULL", (catalog,)))
    # System-level grants
    filters.append(("OBJECT_NAME IS NULL AND OBJECT_DATABASE IS NULL AND OBJECT_CATALOG IS NULL", ()))

    # Query grants_to_users + grants_to_roles (all scope levels)
    for table_name, gtype in [("sys.grants_to_users", "USER"), ("sys.grants_to_roles", "ROLE")]:
        for where, params in filters:
            try:
                rows = execute_query(conn, f"SELECT * FROM {table_name} WHERE {where}", params)
                for r in rows:
                    results.extend(_row_to_grants(r, gtype))
            except Exception:
                logger.debug("Failed to query %s for object privileges", table_name)

    # Supplement: builtin roles may not appear in sys.grants_to_roles
    # but have grants visible via SHOW GRANTS
    found_roles = {r.grantee for r in results if r.grantee_type == "ROLE"}
    builtin_roles = {"root", "db_admin", "user_admin", "cluster_admin", "security_admin"}
    for role in builtin_roles - found_roles:
        try:
            role_grants = _parse_show_grants(conn, role, "ROLE")
            for g in role_grants:
                if _grant_matches_object(g, catalog, database, name):
                    results.append(g)
        except Exception:
            logger.debug("Failed to get SHOW GRANTS for builtin role %s", role)

    # Supplement: builtin users (root) via SHOW GRANTS
    found_users = {r.grantee for r in results if r.grantee_type == "USER"}
    try:
        from app.services.user_service import get_all_users

        all_users = get_all_users(conn)
        for u in all_users - found_users:
            try:
                user_grants = _parse_show_grants(conn, u, "USER")
                for g in user_grants:
                    if _grant_matches_object(g, catalog, database, name):
                        results.append(g)
            except Exception:
                logger.debug("Failed to get SHOW GRANTS for user %s", u)
    except Exception:
        logger.debug("Failed to get all users for privilege supplement")

    # Supplement: roles and users who have access via role inheritance
    # Build a map: role → set of privilege_types on this object (direct grants only)
    # Exclude SYSTEM-level grants (REPOSITORY, NODE, etc.) as they don't apply to specific objects
    _SYSTEM_ONLY_PRIVS = {
        "REPOSITORY",
        "NODE",
        "BLACKLIST",
        "FILE",
        "OPERATE",
        "PLUGIN",
        "CREATE RESOURCE GROUP",
        "CREATE RESOURCE",
        "CREATE EXTERNAL CATALOG",
        "CREATE GLOBAL FUNCTION",
        "CREATE STORAGE VOLUME",
        "SECURITY",
    }
    role_privs: dict[str, set[str]] = {}
    for r in results:
        if r.grantee_type == "ROLE":
            if (r.object_type or "").upper() == "SYSTEM" or r.privilege_type.upper() in _SYSTEM_ONLY_PRIVS:
                continue
            role_privs.setdefault(r.grantee, set()).add(r.privilege_type)

    if role_privs:
        # 1. Find intermediate roles that inherit from roles with privileges
        #    e.g. platform_admin inherits db_admin → platform_admin also has access
        try:
            all_role_edges = execute_query(
                conn, "SELECT FROM_ROLE, TO_ROLE FROM sys.role_edges WHERE TO_ROLE IS NOT NULL AND TO_ROLE != ''"
            )
        except Exception:
            all_role_edges = []

        # Build child map: parent → [child roles]
        children_of: dict[str, list[str]] = {}
        for edge in all_role_edges:
            parent = edge.get("FROM_ROLE") or ""
            child = edge.get("TO_ROLE") or ""
            if parent and child:
                children_of.setdefault(parent, []).append(child)

        # BFS downward from roles with privileges to find all inheriting roles
        # Collect ALL privileges each role can access (direct + inherited from parents)
        inherited_role_privs: dict[str, tuple[set[str], str]] = {}  # role → (privs, source_role)
        bfs_queue: list[tuple[str, str]] = [(r, r) for r in role_privs]  # (role, origin)
        bfs_visited: set[str] = set()
        while bfs_queue:
            role, origin = bfs_queue.pop(0)
            if role in bfs_visited:
                continue
            bfs_visited.add(role)
            # Determine privs this role has (direct or inherited from origin)
            role_has_privs = role_privs.get(role) or role_privs.get(origin, set())
            for child in children_of.get(role, []):
                if child not in bfs_visited:
                    if child not in inherited_role_privs:
                        inherited_role_privs[child] = (set(role_has_privs), origin)
                    else:
                        # Merge privileges from multiple parent paths
                        inherited_role_privs[child][0].update(role_has_privs)
                    bfs_queue.append((child, origin))

        # Add intermediate roles to results
        if results:
            # Pick a TABLE-type grant as sample for catalog/db/name context (avoid SYSTEM/VIEW/FUNCTION)
            sample = next((r for r in results if (r.object_type or "").upper() == "TABLE"), results[0])
            existing_roles = {r.grantee for r in results if r.grantee_type == "ROLE"}
            for role, (privs, source) in inherited_role_privs.items():
                if role in existing_roles:
                    continue
                existing_roles.add(role)
                for priv in privs:
                    results.append(
                        PrivilegeGrant(
                            grantee=role,
                            grantee_type="ROLE",
                            object_catalog=sample.object_catalog,
                            object_database=sample.object_database,
                            object_name=sample.object_name,
                            object_type=sample.object_type,
                            privilege_type=priv,
                            is_grantable=False,
                            source=source,
                        )
                    )
                # Also add to role_privs so user BFS can find them
                role_privs[role] = privs

        # 2. Find users who have access via role inheritance
        from app.services.user_service import get_all_users

        all_users = get_all_users(conn)
        existing_users = {r.grantee for r in results if r.grantee_type == "USER"}

        for user in all_users:
            if user in existing_users:
                continue
            # Get this user's direct roles
            user_roles = _get_user_roles(conn, user)
            if not user_roles:
                continue
            # BFS upward from user's roles to find which privileges they inherit
            user_privs: dict[str, str] = {}  # priv → source_role
            visited: set[str] = set()
            queue: list[tuple[str, str]] = [(r, r) for r in user_roles]  # (role, direct_role)
            while queue:
                role, origin = queue.pop(0)
                if role in visited:
                    continue
                visited.add(role)
                # If this role has privileges on the object, collect them
                if role in role_privs:
                    for priv in role_privs[role]:
                        if priv not in user_privs:
                            user_privs[priv] = origin
                # Continue BFS upward
                parents = _get_parent_roles(conn, role)
                queue.extend((p, origin) for p in parents)

            if user_privs:
                existing_users.add(user)
                sample = next((r for r in results if (r.object_type or "").upper() == "TABLE"), results[0])
                for priv, source_role in user_privs.items():
                    results.append(
                        PrivilegeGrant(
                            grantee=user,
                            grantee_type="USER",
                            object_catalog=sample.object_catalog,
                            object_database=sample.object_database,
                            object_name=sample.object_name,
                            object_type=sample.object_type,
                            privilege_type=priv,
                            is_grantable=False,
                            source=source_role,
                        )
                    )

    # Filter out grants that don't actually apply to the queried object
    # e.g. DB-level DDL (CREATE TABLE, CREATE MV) and SYSTEM grants (REPOSITORY, NODE)
    if name:
        # Querying a specific table/view — only keep grants that affect table-level access
        _DB_ONLY_PRIVS = {
            "CREATE TABLE",
            "CREATE VIEW",
            "CREATE FUNCTION",
            "CREATE MATERIALIZED VIEW",
            "CREATE PIPE",
            "CREATE MASKING POLICY",
            "CREATE ROW ACCESS POLICY",
            "ALTER",
            "DROP",
        }
        filtered = []
        for r in results:
            otype = (r.object_type or "").upper()
            if otype == "SYSTEM":
                continue
            # DB-level DDL privileges don't apply to individual tables
            if otype == "DATABASE" and r.privilege_type.upper() in _DB_ONLY_PRIVS:
                continue
            filtered.append(r)
        results = filtered

    # Deduplicate
    seen = set()
    unique = []
    for r in results:
        key = (
            r.grantee,
            r.grantee_type,
            r.object_type,
            r.object_catalog or "",
            r.object_database or "",
            r.object_name or "",
            r.privilege_type,
        )
        if key not in seen:
            seen.add(key)
            unique.append(r)

    return unique


def _query_grants_for(conn, grantee: str, grantee_type: str) -> list[PrivilegeGrant]:
    table = "sys.grants_to_users" if grantee_type == "USER" else "sys.grants_to_roles"
    try:
        rows = execute_query(conn, f"SELECT * FROM {table} WHERE GRANTEE = %s", (grantee,))
        logger.debug(f"{table} WHERE GRANTEE={grantee}: {len(rows)} rows")
        if rows:
            return [g for r in rows for g in _row_to_grants(r, grantee_type)]
    except Exception as e:
        logger.debug(f"{table} query failed: {e}")
    # Fallback: parse SHOW GRANTS
    logger.debug(f"Falling back to SHOW GRANTS FOR {grantee_type} '{grantee}'")
    result = _parse_show_grants(conn, grantee, grantee_type)
    logger.debug(f"SHOW GRANTS parsed: {len(result)} grants")
    return result


def _grant_matches_object(g: PrivilegeGrant, catalog: str | None, database: str | None, name: str | None) -> bool:
    """Check if a grant applies to the given object (exact match or parent scope).
    Only includes grants whose object_type is relevant (e.g. TABLE grants for tables)."""
    gc, gd, gn = g.object_catalog, g.object_database, g.object_name
    otype = (g.object_type or "").upper()

    # SYSTEM-level grants (NODE, OPERATE, etc.) don't apply to specific objects
    if otype == "SYSTEM":
        return False
    # Wildcard grants like "ALL TABLES IN ALL DATABASES" (cat=None, db=None, name=None, type=TABLE)
    if not gc and not gd and not gn and otype:
        # Only match if the grant type is relevant: TABLE grants for table queries, etc.
        return True
    # Catalog-level grant → applies if catalog matches
    if gc and not gd and not gn:
        return not catalog or gc == catalog
    # Database-level grant → applies if catalog+db match
    if gc and gd and not gn:
        return (not catalog or gc == catalog) and (not database or gd == database)
    # Object-level grant → exact match
    if gc and gd and gn:
        return (not catalog or gc == catalog) and (not database or gd == database) and (not name or gn == name)
    return False


def _row_to_grants(r: dict, grantee_type: str) -> list[PrivilegeGrant]:
    """Convert a DB row to PrivilegeGrant(s). Splits comma-separated PRIVILEGE_TYPE."""

    def _get(keys):
        for k in keys:
            if k in r and r[k] is not None:
                return str(r[k])
        return None

    priv_str = _get(["PRIVILEGE_TYPE", "privilege_type"]) or ""
    privs = [p.strip() for p in priv_str.split(",") if p.strip()]
    if not privs:
        privs = [priv_str]

    base = dict(
        grantee=_get(["GRANTEE", "grantee"]) or "",
        grantee_type=grantee_type,
        object_catalog=_get(["OBJECT_CATALOG", "object_catalog"]),
        object_database=_get(["OBJECT_DATABASE", "object_database"]),
        object_name=_get(["OBJECT_NAME", "object_name"]),
        object_type=_get(["OBJECT_TYPE", "object_type"]) or "",
        is_grantable=str(_get(["IS_GRANTABLE", "is_grantable"])).upper() == "YES",
    )
    return [PrivilegeGrant(**base, privilege_type=p) for p in privs]


def _build_object_filter(catalog, database, name):
    clauses = []
    params = []
    if catalog:
        clauses.append("OBJECT_CATALOG = %s")
        params.append(catalog)
    if database:
        clauses.append("OBJECT_DATABASE = %s")
        params.append(database)
    if name:
        clauses.append("OBJECT_NAME = %s")
        params.append(name)
    where = " AND ".join(clauses) if clauses else "1=1"
    return where, tuple(params)


def _get_user_roles(conn, username: str) -> list[str]:
    roles = []
    try:
        rows = execute_query(conn, "SELECT FROM_ROLE FROM sys.role_edges WHERE TO_USER = %s", (username,))
        for r in rows:
            role = r.get("FROM_ROLE") or r.get("ROLE_NAME")
            if role:
                roles.append(role)
    except Exception:
        logger.debug("Failed to query role_edges for user %s", username)
    return roles


def _get_parent_roles(conn, role_name: str) -> list[str]:
    parents = []
    try:
        rows = execute_query(
            conn,
            "SELECT FROM_ROLE FROM sys.role_edges WHERE TO_ROLE = %s",
            (role_name,),
        )
        for r in rows:
            p = r.get("FROM_ROLE") or r.get("PARENT_ROLE_NAME")
            if p:
                parents.append(p)
    except Exception:
        logger.debug("Failed to query parent roles for role %s", role_name)
    return parents


def _parse_show_grants(conn, grantee: str, grantee_type: str) -> list[PrivilegeGrant]:
    """Fallback: parse SHOW GRANTS output."""
    results = []
    try:
        if grantee_type == "USER":
            # grantee may already be quoted like 'root'@'%'
            if "@" in grantee:
                rows = execute_query(conn, f"SHOW GRANTS FOR {safe_name(grantee)}")
            else:
                rows = execute_query(conn, f"SHOW GRANTS FOR '{safe_name(grantee)}'")
        else:
            rows = execute_query(conn, f"SHOW GRANTS FOR ROLE '{safe_name(grantee)}'")
        for row in rows:
            for val in row.values():
                s = str(val)
                if s.upper().startswith("GRANT"):
                    parsed = _parse_grant_statement(s, grantee, grantee_type)
                    results.extend(parsed)
                    if not parsed:
                        logger.debug(f"Could not parse: {s}")
    except Exception as e:
        logger.warning(f"SHOW GRANTS failed for {grantee_type} {grantee}: {e}")
    return results


def _parse_grant_statement(stmt: str, grantee: str, grantee_type: str) -> list[PrivilegeGrant]:
    """Best-effort parse of various GRANT statement formats."""
    grants = []

    # Pattern 1: GRANT priv[, priv] ON object_type path TO ...
    # e.g. "GRANT SELECT ON TABLE default_catalog.db.tbl TO ROLE 'analyst'"
    m = _RE_GRANT_ON.match(stmt)
    if not m:
        return grants

    priv_str = m.group(1).strip()
    on_part = m.group(2).strip()

    # Parse privileges (comma separated)
    privs = [p.strip() for p in priv_str.split(",")]

    # Parse ON part: "TABLE db.tbl" or "ALL TABLES IN ALL DATABASES" or "SYSTEM" etc.
    obj_type = "SYSTEM"
    obj_path = ""

    # Handle "ALL <TYPE>S IN ALL DATABASES" or "ALL <TYPE>S IN DATABASE db" patterns first
    all_match = _RE_ALL_IN_DB.match(on_part)
    if all_match:
        obj_type = all_match.group(1).upper()
        db_name = all_match.group(2)
        obj_path = ""
        if db_name:
            obj_path = db_name.replace("`", "")
    else:
        # Try: TYPE path
        on_match = _RE_TYPE_PATH.match(on_part)
        if on_match:
            obj_type = on_match.group(1).upper()
            obj_path = on_match.group(2).strip().replace("`", "")
        else:
            # Just a single word like "SYSTEM"
            obj_type = on_part.upper()

    # Clean up obj_type
    if "TABLE" in obj_type:
        obj_type = "TABLE"
    elif "DATABASE" in obj_type:
        obj_type = "DATABASE"
    elif "MATERIALIZED VIEW" in obj_type:
        obj_type = "MATERIALIZED VIEW"
    elif "VIEW" in obj_type:
        obj_type = "VIEW"
    elif "FUNCTION" in obj_type:
        obj_type = "FUNCTION"
    elif "CATALOG" in obj_type:
        obj_type = "CATALOG"
    elif "RESOURCE GROUP" in obj_type:
        obj_type = "RESOURCE GROUP"
    elif "RESOURCE" in obj_type:
        obj_type = "RESOURCE"
    elif "WAREHOUSE" in obj_type:
        obj_type = "WAREHOUSE"
    elif "STORAGE VOLUME" in obj_type:
        obj_type = "STORAGE VOLUME"
    elif "USER" in obj_type:
        obj_type = "USER"
    elif "MASKING" in obj_type or "ROW ACCESS" in obj_type:
        obj_type = "POLICY"
    elif "FAILOVER" in obj_type:
        obj_type = "FAILOVER GROUP"
    elif "GLOBAL FUNCTION" in obj_type:
        obj_type = "GLOBAL FUNCTION"

    parts = obj_path.split(".") if obj_path else []
    catalog = parts[0] if len(parts) >= 1 and parts[0] != "*" else None
    database = parts[1] if len(parts) >= 2 and parts[1] != "*" else None
    name = parts[2] if len(parts) >= 3 and parts[2] != "*" else None

    for priv in privs:
        priv = priv.strip()
        if priv:
            grants.append(
                PrivilegeGrant(
                    grantee=grantee,
                    grantee_type=grantee_type,
                    object_catalog=catalog,
                    object_database=database,
                    object_name=name,
                    object_type=obj_type,
                    privilege_type=priv,
                )
            )
    return grants
