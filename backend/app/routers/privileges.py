from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, Query

from app.dependencies import get_credentials, get_db
from app.models.schemas import PrivilegeGrant
from app.routers.my_permissions import router as my_perms_router
from app.services.bfs_resolver import (
    _bfs_child_roles,
    _bfs_user_privs,
    _fetch_role_child_map,
    _finalize,
    _find_ancestors_with_grants,
)
from app.services.grant_classifier import (
    ObjectQuery,
    Relevance,
    classify_grant,
    _make_inherited_grant,
    _BUILTIN_ROLES,
)
from app.services.grant_parser import (
    _parse_show_grants,
    _row_to_grants,
)
from app.services.starrocks_client import execute_query
from app.utils.role_helpers import get_parent_roles, get_user_roles
from app.utils.sql_safety import safe_name

logger = logging.getLogger("privileges")
router = APIRouter()
router.include_router(my_perms_router)


# ══════════════════════════════════════════════════════════════════════
# API Endpoints
# ══════════════════════════════════════════════════════════════════════


@router.get("/user/{username}", response_model=list[PrivilegeGrant])
def get_user_privileges(username: str, conn=Depends(get_db)):
    return _query_grants_for(conn, username, "USER")


@router.get("/role/{rolename}", response_model=list[PrivilegeGrant])
def get_role_privileges(rolename: str, conn=Depends(get_db)):
    """Get privileges for a role, including inherited from parent roles."""
    direct = _query_grants_for(conn, rolename, "ROLE")
    direct_parents = get_parent_roles(conn, rolename)
    visited = {rolename}
    queue: list[tuple[str, str]] = [(p, p) for p in direct_parents]
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
        queue.extend((gp, origin) for gp in get_parent_roles(conn, parent))
    return direct + inherited


@router.get("/role/{rolename}/raw")
def get_role_privileges_raw(rolename: str, conn=Depends(get_db)):
    """Debug: return raw SHOW GRANTS output for a role."""
    results: dict = {"sys_grants_to_roles": [], "show_grants": []}
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
    direct = _query_grants_for(conn, username, "USER")
    direct_roles = get_user_roles(conn, username)
    # All users implicitly have the 'public' role
    if "public" not in direct_roles:
        direct_roles.append("public")
    visited: set[str] = set()
    queue: list[tuple[str, str]] = [(r, r) for r in direct_roles]
    role_origin: dict[str, str] = {}
    while queue and len(visited) < 100:
        role, origin = queue.pop(0)
        if role in visited:
            continue
        visited.add(role)
        role_origin[role] = origin
        queue.extend((p, origin) for p in get_parent_roles(conn, role))
    inherited = []
    for role, origin in role_origin.items():
        grants = _query_grants_for(conn, role, "ROLE")
        for g in grants:
            g.source = origin if origin != role else role
        inherited.extend(grants)
    return direct + inherited


# ──────────────────────────────────────────────────────────────────────
# /object endpoint — 6-step pipeline
# ──────────────────────────────────────────────────────────────────────


@router.get("/object", response_model=list[PrivilegeGrant])
def get_object_privileges(
    catalog: str = Query(None),
    database: str = Query(None),
    name: str = Query(None),
    object_type: str = Query(None, description="Object type: TABLE, VIEW, MATERIALIZED VIEW, FUNCTION, SYSTEM"),
    credentials: dict = Depends(get_credentials),
    conn=Depends(get_db),
):
    """Get all grants on a specific object, including inherited from parent scopes."""
    q = ObjectQuery(catalog=catalog, database=database, name=name, object_type=object_type)

    # Non-admin fast path
    if not credentials.get("is_admin", False):
        return _object_privs_via_grants(conn, credentials["username"], q)

    # ── Step 1: Collect raw grants from sys tables ──
    raw = _collect_sys_grants(conn, q)

    # ── Step 2: Supplement builtin roles + users via SHOW GRANTS ──
    _supplement_builtins(conn, raw, q)

    # ── Step 3: Classify & filter ──
    classified: list[tuple[PrivilegeGrant, Relevance]] = []
    for g in raw:
        rel = classify_grant(g, q)
        if rel != Relevance.IRRELEVANT:
            classified.append((g, rel))

    # ── Step 4: BFS — find inheriting roles ──
    role_privs: dict[str, set[str]] = {}
    # Track original object_type for each privilege (for inherited grant creation)
    priv_orig_type: dict[str, str] = {}
    for g, _ in classified:
        if g.grantee_type == "ROLE":
            role_privs.setdefault(g.grantee, set()).add(g.privilege_type)
            priv_orig_type.setdefault(g.privilege_type, g.object_type or "")

    if role_privs:
        children_of = _fetch_role_child_map(conn)
        inherited = _bfs_child_roles(role_privs, children_of)
        existing_roles = {g.grantee for g, _ in classified if g.grantee_type == "ROLE"}
        for child, (privs, origin) in inherited.items():
            if child in existing_roles:
                continue
            existing_roles.add(child)
            role_privs[child] = privs
            for priv in privs:
                ig = _make_inherited_grant(
                    child, "ROLE", priv, q, source=origin, original_object_type=priv_orig_type.get(priv)
                )
                classified.append((ig, classify_grant(ig, q)))

    # ── Step 5: BFS — find users with inherited access ──
    if role_privs:
        from app.services.user_service import get_all_users

        existing_users = {g.grantee for g, _ in classified if g.grantee_type == "USER"}
        for user in get_all_users(conn) - existing_users:
            user_privs = _bfs_user_privs(conn, user, role_privs)
            for priv, src in user_privs.items():
                ig = _make_inherited_grant(
                    user, "USER", priv, q, source=src, original_object_type=priv_orig_type.get(priv)
                )
                classified.append((ig, classify_grant(ig, q)))

    # ── Step 6: Post-process + deduplicate ──
    results = _finalize(classified, q)
    return results


def _collect_sys_grants(conn, q: ObjectQuery) -> list[PrivilegeGrant]:
    """Query sys.grants_to_users + sys.grants_to_roles at all scope levels."""
    results: list[PrivilegeGrant] = []
    filters = [_build_object_filter(q.catalog, q.database, q.name)]
    if q.name and q.database:
        clauses, params = [], []
        if q.catalog:
            clauses.append("OBJECT_CATALOG = %s")
            params.append(q.catalog)
        clauses.append("OBJECT_DATABASE = %s")
        params.append(q.database)
        clauses.append("OBJECT_NAME IS NULL")
        filters.append((" AND ".join(clauses), tuple(params)))
    if q.database and q.catalog:
        filters.append(("OBJECT_CATALOG = %s AND OBJECT_DATABASE IS NULL AND OBJECT_NAME IS NULL", (q.catalog,)))
    filters.append(("OBJECT_NAME IS NULL AND OBJECT_DATABASE IS NULL AND OBJECT_CATALOG IS NULL", ()))

    for table, gtype in [("sys.grants_to_users", "USER"), ("sys.grants_to_roles", "ROLE")]:
        for where, params in filters:
            try:
                rows = execute_query(conn, f"SELECT * FROM {table} WHERE {where}", params)
                for r in rows:
                    results.extend(_row_to_grants(r, gtype))
            except Exception:
                logger.debug("Failed to query %s", table)
    return results


def _supplement_builtins(conn, results: list[PrivilegeGrant], q: ObjectQuery) -> None:
    """Add grants from builtin roles/users that don't appear in sys tables."""
    # For SYSTEM queries: only count roles that already have SYSTEM grants as "found"
    if q.is_system:
        found_roles = {
            r.grantee for r in results if r.grantee_type == "ROLE" and (r.object_type or "").upper() == "SYSTEM"
        }
    else:
        found_roles = {r.grantee for r in results if r.grantee_type == "ROLE"}

    for role in _BUILTIN_ROLES - found_roles:
        try:
            for g in _parse_show_grants(conn, role, "ROLE"):
                if classify_grant(g, q) != Relevance.IRRELEVANT:
                    results.append(g)
        except Exception:
            logger.debug("Failed to get SHOW GRANTS for builtin role %s", role)

    found_users = {r.grantee for r in results if r.grantee_type == "USER"}
    try:
        from app.services.user_service import get_all_users

        for u in get_all_users(conn) - found_users:
            try:
                for g in _parse_show_grants(conn, u, "USER"):
                    if classify_grant(g, q) != Relevance.IRRELEVANT:
                        results.append(g)
            except Exception:
                logger.debug("Failed to get SHOW GRANTS for user %s", u)
    except Exception:
        logger.debug("Failed to get all users for privilege supplement")


# ──────────────────────────────────────────────────────────────────────
# /object — Non-admin path (SHOW GRANTS only)
# ──────────────────────────────────────────────────────────────────────


def _object_privs_via_grants(conn, username: str, q: ObjectQuery) -> list[PrivilegeGrant]:
    """Build object privilege list for non-admin using SHOW GRANTS."""
    classified: list[tuple[PrivilegeGrant, Relevance]] = []

    # BFS through user's role chain
    role_grants_map: dict[str, list[PrivilegeGrant]] = {}
    role_origin: dict[str, str] = {}
    visited: set[str] = set()
    queue: list[tuple[str, str]] = [(r, r) for r in get_user_roles(conn, username)]
    while queue and len(visited) < 100:
        role, origin = queue.pop(0)
        if role in visited:
            continue
        visited.add(role)
        role_origin[role] = origin
        for g in _parse_show_grants(conn, role, "ROLE"):
            rel = classify_grant(g, q)
            if rel != Relevance.IRRELEVANT:
                classified.append((g, rel))
                role_grants_map.setdefault(role, []).append(g)
        queue.extend((p, origin) for p in get_parent_roles(conn, role))

    # Add intermediate roles that inherit from grant-holding roles
    for role in visited:
        if role in role_grants_map:
            continue
        for ancestor in _find_ancestors_with_grants(conn, role, role_grants_map):
            for g in role_grants_map[ancestor]:
                ig = _make_inherited_grant(
                    role, "ROLE", g.privilege_type, q, source=ancestor, original_object_type=g.object_type
                )
                classified.append((ig, classify_grant(ig, q)))

    # Add user as inherited grantee
    all_privs: dict[str, tuple[str, str]] = {}  # priv → (source_role, original_object_type)
    for role, grants in role_grants_map.items():
        for g in grants:
            all_privs.setdefault(g.privilege_type, (role_origin.get(role, role), g.object_type or ""))
    for priv, (src, orig_type) in all_privs.items():
        ig = _make_inherited_grant(username, "USER", priv, q, source=src, original_object_type=orig_type)
        classified.append((ig, classify_grant(ig, q)))

    # User's direct grants
    for g in _parse_show_grants(conn, username, "USER"):
        rel = classify_grant(g, q)
        if rel != Relevance.IRRELEVANT:
            classified.append((g, rel))

    return _finalize(classified, q)


# ══════════════════════════════════════════════════════════════════════
# Low-level helpers (sys table row conversion, filter building)
# ══════════════════════════════════════════════════════════════════════


def _query_grants_for(conn, grantee: str, grantee_type: str) -> list[PrivilegeGrant]:
    """Get grants for a grantee. Merges sys table results with SHOW GRANTS scope-level grants.
    sys.grants_to_* expands wildcards (e.g. ALL TABLES IN DB → individual table rows),
    so we also parse SHOW GRANTS to capture the original scope-level grants (object_name=None)."""
    table = "sys.grants_to_users" if grantee_type == "USER" else "sys.grants_to_roles"
    sys_grants: list[PrivilegeGrant] = []
    try:
        rows = execute_query(conn, f"SELECT * FROM {table} WHERE GRANTEE = %s", (grantee,))
        if rows:
            sys_grants = [g for r in rows for g in _row_to_grants(r, grantee_type)]
    except Exception:
        logger.debug("Query failed, skipping")
    if not sys_grants:
        return _parse_show_grants(conn, grantee, grantee_type)
    # Supplement: merge SHOW GRANTS results that are NOT already covered by sys results.
    # sys.grants_to_* has exact data for TABLE/DATABASE/CATALOG types but misses
    # SYSTEM, GLOBAL FUNCTION, STORAGE VOLUME, RESOURCE GROUP, WAREHOUSE, RESOURCE, etc.
    show_grants = _parse_show_grants(conn, grantee, grantee_type)
    # Types that sys already covers well — skip individual object grants from SHOW GRANTS for these
    _sys_covered_types = {"TABLE", "DATABASE", "CATALOG"}

    # Build dedup key set (normalize function signatures: strip param details)
    def _norm_name(n: str) -> str:
        return n.split("(")[0] if "(" in n else n

    existing = {(g.object_type, _norm_name(g.object_name or ""), g.privilege_type) for g in sys_grants}
    for g in show_grants:
        # For sys-covered types, only add scope-level (wildcard) grants not individual objects
        if g.object_type in _sys_covered_types and g.object_name:
            continue
        key = (g.object_type, _norm_name(g.object_name or ""), g.privilege_type)
        if key not in existing:
            sys_grants.append(g)
            existing.add(key)
    return sys_grants


def _build_object_filter(catalog, database, name):
    clauses, params = [], []
    if catalog:
        clauses.append("OBJECT_CATALOG = %s")
        params.append(catalog)
    if database:
        clauses.append("OBJECT_DATABASE = %s")
        params.append(database)
    if name:
        clauses.append("OBJECT_NAME = %s")
        params.append(name)
    return " AND ".join(clauses) if clauses else "1=1", tuple(params)
