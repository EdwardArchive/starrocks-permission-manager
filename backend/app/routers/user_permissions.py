"""Router for /api/user/privileges/my-permissions endpoint.

Uses only SHOW GRANTS + INFORMATION_SCHEMA (no sys.* tables).
Mirrors the existing my_permissions.py router for non-admin access.
"""

from __future__ import annotations

import logging

from fastapi import APIRouter, Depends

from app.dependencies import get_credentials, get_db
from app.models.schemas import PrivilegeGrant
from app.services.common.grant_parser import _parse_show_grants
from app.services.shared.name_utils import normalize_fn_name
from app.services.starrocks_client import execute_query
from app.utils.role_helpers import parse_role_assignments
from app.utils.sql_safety import safe_name

logger = logging.getLogger("privileges")
router = APIRouter()


@router.get("/my-permissions")
def get_my_permissions(
    credentials: dict = Depends(get_credentials),
    conn=Depends(get_db),
):
    """Build the current user's full permission tree using only SHOW GRANTS."""
    username = credentials["username"]

    try:
        execute_query(conn, "SET ROLE ALL")
    except Exception:
        logger.debug("Failed to SET ROLE ALL for user %s", username)

    # Parse SHOW GRANTS → direct grants + role assignments
    user_grants = _parse_show_grants(conn, username, "USER")
    direct_roles: list[str] = []
    direct_privileges: list[PrivilegeGrant] = []
    for g in user_grants:
        if g.object_type == "ROLE_ASSIGNMENT":
            direct_roles.append(g.privilege_type)
        else:
            direct_privileges.append(g)

    # Also parse raw output for comma-separated role assignments
    for role_name in parse_role_assignments(conn, username, "USER"):
        if role_name not in direct_roles:
            direct_roles.append(role_name)

    # BFS through role chain
    role_tree: dict[str, dict] = {}
    visited: set[str] = set()
    queue = list(direct_roles)
    while queue and len(visited) < 100:
        role = queue.pop(0)
        if role in visited:
            continue
        visited.add(role)
        role_grants: list[PrivilegeGrant] = []
        child_roles: list[str] = []
        try:
            for g in _parse_show_grants(conn, role, "ROLE"):
                if g.object_type == "ROLE_ASSIGNMENT":
                    child_roles.append(g.privilege_type)
                else:
                    role_grants.append(g)
        except Exception:
            logger.debug("Cannot access SHOW GRANTS FOR ROLE '%s'", role)
        for rn in parse_role_assignments(conn, role, "ROLE"):
            if rn not in child_roles:
                child_roles.append(rn)
        role_tree[role] = {"grants": role_grants, "parent_roles": child_roles}
        queue.extend(r for r in child_roles if r not in visited)

    # ── Collect accessible catalogs ──
    accessible_catalogs: list[dict] = []
    try:
        rows = execute_query(conn, "SHOW CATALOGS")
        for r in rows:
            cat_name = r.get("Catalog") or r.get("catalog") or ""
            cat_type = r.get("Type") or r.get("type") or "InternalCatalog"
            if cat_name:
                accessible_catalogs.append({"name": cat_name, "type": cat_type})
    except Exception:
        logger.debug("Failed to query SHOW CATALOGS")

    # ── Collect objects/databases across ALL catalogs ──
    accessible_objects: list[dict] = []
    accessible_databases: list[dict] = []

    for cat_info in accessible_catalogs:
        cat_name = cat_info["name"]
        try:
            execute_query(conn, f"SET CATALOG `{cat_name}`")
        except Exception:
            logger.debug("Failed to SET CATALOG %s", cat_name)
            continue

        # Databases in this catalog
        cat_databases: list[str] = []
        try:
            rows = execute_query(
                conn,
                "SELECT SCHEMA_NAME FROM information_schema.schemata "
                "WHERE SCHEMA_NAME NOT IN ('information_schema', '_statistics_', 'sys') ORDER BY SCHEMA_NAME",
            )
            cat_databases = [
                r.get("SCHEMA_NAME") or r.get("schema_name") or ""
                for r in rows
                if r.get("SCHEMA_NAME") or r.get("schema_name")
            ]
        except Exception:
            logger.debug("Failed to query schemata for catalog %s", cat_name)

        for db in cat_databases:
            if not any(d["name"] == db and d["catalog"] == cat_name for d in accessible_databases):
                accessible_databases.append({"name": db, "catalog": cat_name})

        # Tables/Views/MVs from information_schema
        mv_names: set[tuple[str, str]] = set()
        try:
            rows = execute_query(
                conn,
                "SELECT TABLE_SCHEMA, TABLE_NAME, TABLE_TYPE, TABLE_ROWS, DATA_LENGTH "
                "FROM information_schema.tables "
                "WHERE TABLE_TYPE != 'SYSTEM VIEW' AND TABLE_SCHEMA NOT IN ('information_schema', '_statistics_', 'sys')",
            )
            try:
                mv_rows = execute_query(
                    conn, "SELECT TABLE_SCHEMA, TABLE_NAME FROM information_schema.materialized_views"
                )
                mv_names = {(r.get("TABLE_SCHEMA") or "", r.get("TABLE_NAME") or "") for r in mv_rows}
            except Exception:
                logger.debug("Query failed, skipping")
            for r in rows:
                schema = r.get("TABLE_SCHEMA") or ""
                name = r.get("TABLE_NAME") or ""
                ttype = r.get("TABLE_TYPE") or ""
                table_rows = r.get("TABLE_ROWS")
                data_length = r.get("DATA_LENGTH")
                if (schema, name) in mv_names:
                    obj_type = "MATERIALIZED VIEW"
                elif "VIEW" in ttype.upper():
                    obj_type = "VIEW"
                else:
                    obj_type = "BASE TABLE"
                obj: dict = {"catalog": cat_name, "database": schema, "name": name, "type": obj_type}
                if table_rows is not None:
                    obj["rows"] = int(table_rows)
                if data_length is not None:
                    obj["size"] = int(data_length)
                accessible_objects.append(obj)
        except Exception:
            logger.debug("Failed to query tables for catalog %s", cat_name)

        # Functions per database (only for default_catalog — external catalogs rarely support this)
        if cat_name == "default_catalog":
            for db in cat_databases:
                try:
                    fn_rows = execute_query(conn, f"SHOW FULL FUNCTIONS FROM `{safe_name(db)}`")
                    seen_fns: set[str] = set()
                    for r in fn_rows:
                        sig = r.get("Signature") or r.get("Function Name") or ""
                        fn_name = normalize_fn_name(sig)
                        if fn_name and fn_name not in seen_fns:
                            seen_fns.add(fn_name)
                            fn_obj: dict = {
                                "catalog": cat_name,
                                "database": db,
                                "name": fn_name,
                                "type": "FUNCTION",
                                "signature": sig,
                            }
                            ret_type = r.get("Return Type") or ""
                            fn_type = r.get("Function Type") or ""
                            props = r.get("Properties") or ""
                            if ret_type:
                                fn_obj["return_type"] = ret_type
                            if fn_type:
                                fn_obj["function_type"] = fn_type
                            if props:
                                fn_obj["properties"] = props
                            accessible_objects.append(fn_obj)
                except Exception:
                    logger.debug("Query failed, skipping")

    # Restore to default_catalog
    try:
        execute_query(conn, "SET CATALOG `default_catalog`")
    except Exception:
        logger.debug("Query failed, skipping")

    # ── System objects ──
    system_objects: list[dict] = []
    _sys_seen: set[tuple[str, str]] = set()

    def _add_sys(name: str, stype: str, **extra: str) -> None:
        key = (stype, name)
        if name and key not in _sys_seen:
            _sys_seen.add(key)
            obj: dict = {"name": name, "type": stype}
            obj.update(extra)
            system_objects.append(obj)

    # Resource Groups (multiple rows per group — dedup, collect detail)
    try:
        for r in execute_query(conn, "SHOW RESOURCE GROUPS ALL"):
            name = r.get("name") or r.get("Name") or ""
            _add_sys(
                name,
                "RESOURCE_GROUP",
                cpu_weight=str(r.get("cpu_weight") or ""),
                mem_limit=str(r.get("mem_limit") or ""),
                concurrency_limit=str(r.get("concurrency_limit") or ""),
            )
    except Exception:
        logger.debug("Query failed, skipping")

    # Storage Volumes — list then DESC each for detail
    sv_names: list[str] = []
    try:
        for r in execute_query(conn, "SHOW STORAGE VOLUMES"):
            sv_name = r.get("Storage Volume") or r.get("Name") or r.get("name") or ""
            if sv_name:
                sv_names.append(sv_name)
    except Exception:
        logger.debug("Query failed, skipping")
    for sv_name in sv_names:
        try:
            rows = execute_query(conn, f"DESC STORAGE VOLUME `{safe_name(sv_name)}`")
            if rows:
                r = rows[0]
                _add_sys(
                    sv_name,
                    "STORAGE_VOLUME",
                    sv_type=str(r.get("Type") or ""),
                    location=str(r.get("Location") or ""),
                    is_default=str(r.get("IsDefault") or ""),
                    enabled=str(r.get("Enabled") or ""),
                )
        except Exception:
            _add_sys(sv_name, "STORAGE_VOLUME")

    # Resources (key-value rows — collect type + main config)
    _res_data: dict[str, dict] = {}
    try:
        for r in execute_query(conn, "SHOW RESOURCES"):
            name = r.get("Name") or r.get("name") or ""
            if not name:
                continue
            if name not in _res_data:
                _res_data[name] = {"resource_type": r.get("ResourceType") or ""}
            key = r.get("Key") or ""
            val = r.get("Value") or ""
            if key in ("jdbc_uri", "spark.master"):
                _res_data[name][key] = val
    except Exception:
        logger.debug("Query failed, skipping")
    for name, info in _res_data.items():
        _add_sys(name, "RESOURCE", **{k: str(v) for k, v in info.items()})

    # Warehouses — try SHOW WAREHOUSES first (non-admin compatible), fallback to SHOW PROC
    try:
        wh_rows = execute_query(conn, "SHOW WAREHOUSES")
        for r in wh_rows:
            _add_sys(
                r.get("Name") or r.get("name") or "",
                "WAREHOUSE",
                state=str(r.get("State") or ""),
                node_count=str(r.get("NodeCount") or "0"),
                running_sql=str(r.get("RunningSql") or "0"),
                queued_sql=str(r.get("QueuedSql") or "0"),
            )
    except Exception:
        try:
            for r in execute_query(conn, "SHOW PROC '/warehouses'"):
                _add_sys(
                    r.get("Name") or r.get("name") or "",
                    "WAREHOUSE",
                    state=str(r.get("State") or ""),
                    node_count=str(r.get("NodeCount") or "0"),
                    running_sql=str(r.get("RunningSql") or "0"),
                    queued_sql=str(r.get("QueuedSql") or "0"),
                )
        except Exception:
            logger.debug("Query failed, skipping")

    # Global Functions
    try:
        for r in execute_query(conn, "SHOW FULL GLOBAL FUNCTIONS"):
            sig = r.get("Signature") or r.get("Function Name") or ""
            fn_name = normalize_fn_name(sig)
            _add_sys(
                fn_name,
                "GLOBAL_FUNCTION",
                signature=sig,
                return_type=str(r.get("Return Type") or ""),
                function_type=str(r.get("Function Type") or ""),
            )
    except Exception:
        logger.debug("Query failed, skipping")

    # Pipes
    try:
        execute_query(conn, "SET CATALOG `default_catalog`")
        for r in execute_query(conn, "SELECT * FROM information_schema.pipes"):
            pipe_name = r.get("PIPE_NAME") or r.get("pipe_name") or ""
            _add_sys(
                pipe_name,
                "PIPE",
                database=str(r.get("DATABASE_NAME") or r.get("database_name") or ""),
                state=str(r.get("STATE") or r.get("state") or ""),
                table_name=str(r.get("TABLE_NAME") or r.get("table_name") or ""),
                load_status=str(r.get("LOAD_STATUS") or r.get("load_status") or ""),
            )
    except Exception:
        logger.debug("Query failed, skipping")

    # Tasks + latest run state
    _task_states: dict[str, str] = {}
    try:
        for r in execute_query(
            conn,
            "SELECT TASK_NAME, STATE FROM information_schema.task_runs "
            "WHERE (TASK_NAME, CREATE_TIME) IN "
            "(SELECT TASK_NAME, MAX(CREATE_TIME) FROM information_schema.task_runs GROUP BY TASK_NAME)",
        ):
            _task_states[r.get("TASK_NAME") or ""] = r.get("STATE") or ""
    except Exception:
        logger.debug("Query failed, skipping")
    try:
        for r in execute_query(conn, "SELECT * FROM information_schema.tasks"):
            task_name = r.get("TASK_NAME") or ""
            _add_sys(
                task_name,
                "TASK",
                database=str(r.get("DATABASE") or ""),
                schedule=str(r.get("SCHEDULE") or ""),
                state=_task_states.get(task_name, ""),
                creator=str(r.get("CREATOR") or ""),
                definition=str(r.get("DEFINITION") or ""),
            )
    except Exception:
        logger.debug("Query failed, skipping")

    # Flatten effective privileges
    effective_privileges: list[dict] = []
    for g in direct_privileges:
        effective_privileges.append(
            {
                "privilege_type": g.privilege_type,
                "object_type": g.object_type,
                "object_catalog": g.object_catalog,
                "object_database": g.object_database,
                "object_name": g.object_name,
                "source": "direct",
            }
        )

    def _collect(role: str, origin: str, seen: set):
        if role in seen:
            return
        seen.add(role)
        info = role_tree.get(role, {})
        for g in info.get("grants", []):
            effective_privileges.append(
                {
                    "privilege_type": g.privilege_type,
                    "object_type": g.object_type,
                    "object_catalog": g.object_catalog,
                    "object_database": g.object_database,
                    "object_name": g.object_name,
                    "source": f"{origin}" if origin == role else f"{origin} → {role}",
                }
            )
        for parent in info.get("parent_roles", []):
            _collect(parent, origin, seen)

    for role in direct_roles:
        _collect(role, role, set())

    return {
        "username": username,
        "direct_roles": direct_roles,
        "role_tree": {
            k: {
                "grants": [
                    {
                        "privilege_type": g.privilege_type,
                        "object_type": g.object_type,
                        "object_catalog": g.object_catalog,
                        "object_database": g.object_database,
                        "object_name": g.object_name,
                    }
                    for g in v["grants"]
                ],
                "parent_roles": v["parent_roles"],
            }
            for k, v in role_tree.items()
        },
        "effective_privileges": effective_privileges,
        "accessible_databases": accessible_databases,
        "accessible_catalogs": accessible_catalogs,
        "accessible_objects": accessible_objects,
        "system_objects": system_objects,
    }
