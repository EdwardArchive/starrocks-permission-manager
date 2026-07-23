"""Layer 1 service: build the current user's permission tree.

Collects the user's roles, catalog objects, and cluster-level system objects for
the my-permissions endpoint using only privilege-listing commands and
INFORMATION_SCHEMA reads (no sys.* tables).
"""

from __future__ import annotations

import json
import logging
from collections.abc import Callable

from app.models.schemas import PrivilegeGrant
from app.services.common.grant_parser import _parse_show_grants
from app.services.shared.name_utils import normalize_fn_name
from app.services.shared.row_utils import col
from app.services.starrocks_client import execute_query
from app.utils.role_helpers import parse_role_assignments
from app.utils.sql_safety import restore_default_catalog, safe_identifier, set_catalog

logger = logging.getLogger(__name__)


def collect_role_chain(conn, username: str) -> tuple[list[str], list[PrivilegeGrant], dict[str, dict]]:
    """Parse the user's direct grants and BFS the role chain.

    Returns ``(direct_roles, direct_privileges, role_tree)``.
    """
    # Parse SHOW GRANTS → direct privilege grants. Role assignments are emitted
    # only by parse_role_assignments (the parser below never produces them).
    direct_roles: list[str] = []
    direct_privileges: list[PrivilegeGrant] = _parse_show_grants(conn, username, "USER")

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
            role_grants = _parse_show_grants(conn, role, "ROLE")
        except Exception:
            logger.debug("Cannot access SHOW GRANTS FOR ROLE '%s'", role)
        for rn in parse_role_assignments(conn, role, "ROLE"):
            if rn not in child_roles:
                child_roles.append(rn)
        role_tree[role] = {"grants": role_grants, "parent_roles": child_roles}
        queue.extend(r for r in child_roles if r not in visited)

    return direct_roles, direct_privileges, role_tree


def collect_catalogs(conn) -> list[dict]:
    """Enumerate accessible catalogs via SHOW CATALOGS."""
    accessible_catalogs: list[dict] = []
    try:
        rows = execute_query(conn, "SHOW CATALOGS")
        for r in rows:
            cat_name = col(r, "Catalog") or ""
            cat_type = col(r, "Type") or "InternalCatalog"
            if cat_name:
                accessible_catalogs.append({"name": cat_name, "type": cat_type})
    except Exception:
        logger.debug("Failed to query SHOW CATALOGS")
    return accessible_catalogs


def _collect_tables(conn, cat_name: str) -> list[dict]:
    """Tables/Views/MVs from information_schema for the active catalog."""
    objects: list[dict] = []
    mv_names: set[tuple[str, str]] = set()
    try:
        rows = execute_query(
            conn,
            "SELECT TABLE_SCHEMA, TABLE_NAME, TABLE_TYPE, TABLE_ROWS, DATA_LENGTH "
            "FROM information_schema.tables "
            "WHERE TABLE_TYPE != 'SYSTEM VIEW' AND TABLE_SCHEMA NOT IN ('information_schema', '_statistics_', 'sys')",
        )
        try:
            mv_rows = execute_query(conn, "SELECT TABLE_SCHEMA, TABLE_NAME FROM information_schema.materialized_views")
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
            objects.append(obj)
    except Exception:
        logger.debug("Failed to query tables for catalog %s", cat_name)
    return objects


def _collect_functions(conn, cat_name: str, cat_databases: list[str]) -> list[dict]:
    """Per-database functions (default_catalog only — external catalogs rarely support this)."""
    objects: list[dict] = []
    for db in cat_databases:
        try:
            fn_rows = execute_query(conn, f"SHOW FULL FUNCTIONS FROM `{safe_identifier(db)}`")
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
                    objects.append(fn_obj)
        except Exception:
            logger.debug("Query failed, skipping")
    return objects


def collect_catalog_objects(conn, accessible_catalogs: list[dict]) -> tuple[list[dict], list[dict]]:
    """Enumerate databases and objects across all accessible catalogs.

    Returns ``(accessible_databases, accessible_objects)``.
    """
    accessible_objects: list[dict] = []
    accessible_databases: list[dict] = []

    for cat_info in accessible_catalogs:
        cat_name = cat_info["name"]
        try:
            set_catalog(conn, cat_name)
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
            cat_databases = [col(r, "SCHEMA_NAME") or "" for r in rows if col(r, "SCHEMA_NAME")]
        except Exception:
            logger.debug("Failed to query schemata for catalog %s", cat_name)

        for db in cat_databases:
            if not any(d["name"] == db and d["catalog"] == cat_name for d in accessible_databases):
                accessible_databases.append({"name": db, "catalog": cat_name})

        # Tables/Views/MVs from information_schema
        accessible_objects.extend(_collect_tables(conn, cat_name))

        # Functions per database (only for default_catalog — external catalogs rarely support this)
        if cat_name == "default_catalog":
            accessible_objects.extend(_collect_functions(conn, cat_name, cat_databases))

    # Restore to default_catalog
    try:
        restore_default_catalog(conn)
    except Exception:
        logger.debug("Query failed, skipping")

    return accessible_databases, accessible_objects


def _rg_defaults(r: dict) -> dict:
    """A resource group's static config fields (classifiers appended by the caller)."""
    return {
        "cpu_weight": str(r.get("cpu_weight") or ""),
        "mem_limit": str(r.get("mem_limit") or ""),
        "concurrency_limit": str(r.get("concurrency_limit") or ""),
        "exclusive_cpu_cores": str(r.get("exclusive_cpu_cores") or ""),
        "big_query_cpu_second_limit": str(r.get("big_query_cpu_second_limit") or ""),
        "big_query_scan_rows_limit": str(r.get("big_query_scan_rows_limit") or ""),
        "big_query_mem_limit": str(r.get("big_query_mem_limit") or ""),
        "spill_mem_limit_threshold": str(r.get("spill_mem_limit_threshold") or ""),
        "classifiers": [],
    }


def _collect_resource_groups(conn, is_admin: bool, add_sys: Callable[..., None]) -> None:
    """Resource Groups — aggregate classifiers across multiple rows per group."""
    try:
        rg_sql = "SHOW RESOURCE GROUPS ALL" if is_admin else "SHOW RESOURCE GROUPS"
        _rg_data: dict[str, dict] = {}
        for r in execute_query(conn, rg_sql):
            name = r.get("name") or r.get("Name") or ""
            if not name:
                continue
            if name not in _rg_data:
                _rg_data[name] = _rg_defaults(r)
            classifier = str(r.get("classifiers") or r.get("Classifiers") or "").strip()
            if classifier:
                _rg_data[name]["classifiers"].append(classifier)
        for rg_name, rg_info in _rg_data.items():
            classifiers_list = rg_info.pop("classifiers")
            add_sys(rg_name, "RESOURCE_GROUP", classifiers=json.dumps(classifiers_list), **rg_info)
    except Exception:
        logger.debug("Query failed, skipping")


def _collect_storage_volumes(conn, add_sys: Callable[..., None]) -> None:
    """Storage Volumes — list then DESC each for detail."""
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
            rows = execute_query(conn, f"DESC STORAGE VOLUME `{safe_identifier(sv_name)}`")
            if rows:
                r = rows[0]
                add_sys(
                    sv_name,
                    "STORAGE_VOLUME",
                    sv_type=str(r.get("Type") or ""),
                    location=str(r.get("Location") or ""),
                    is_default=str(r.get("IsDefault") or ""),
                    enabled=str(r.get("Enabled") or ""),
                )
        except Exception:
            add_sys(sv_name, "STORAGE_VOLUME")


def _collect_resources(conn, add_sys: Callable[..., None]) -> None:
    """Resources (key-value rows — collect type + main config)."""
    _res_data: dict[str, dict] = {}
    try:
        for r in execute_query(conn, "SHOW RESOURCES"):
            name = col(r, "Name") or ""
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
        add_sys(name, "RESOURCE", **{k: str(v) for k, v in info.items()})


def _add_warehouse(add_sys: Callable[..., None], r: dict) -> None:
    """Emit one WAREHOUSE system object from a SHOW WAREHOUSES / SHOW PROC row."""
    add_sys(
        col(r, "Name") or "",
        "WAREHOUSE",
        state=str(r.get("State") or ""),
        node_count=str(r.get("NodeCount") or "0"),
        running_sql=str(r.get("RunningSql") or "0"),
        queued_sql=str(r.get("QueuedSql") or "0"),
    )


def _collect_warehouses(conn, add_sys: Callable[..., None]) -> None:
    """Warehouses — try SHOW WAREHOUSES first (non-admin compatible), fallback to SHOW PROC."""
    try:
        wh_rows = execute_query(conn, "SHOW WAREHOUSES")
        for r in wh_rows:
            _add_warehouse(add_sys, r)
    except Exception:
        try:
            for r in execute_query(conn, "SHOW PROC '/warehouses'"):
                _add_warehouse(add_sys, r)
        except Exception:
            logger.debug("Query failed, skipping")


def _collect_global_functions(conn, add_sys: Callable[..., None]) -> None:
    """Global Functions."""
    try:
        for r in execute_query(conn, "SHOW FULL GLOBAL FUNCTIONS"):
            sig = r.get("Signature") or r.get("Function Name") or ""
            fn_name = normalize_fn_name(sig)
            add_sys(
                fn_name,
                "GLOBAL_FUNCTION",
                signature=sig,
                return_type=str(r.get("Return Type") or ""),
                function_type=str(r.get("Function Type") or ""),
            )
    except Exception:
        logger.debug("Query failed, skipping")


def _collect_pipes(conn, add_sys: Callable[..., None]) -> None:
    """Pipes."""
    try:
        restore_default_catalog(conn)
        for r in execute_query(conn, "SELECT * FROM information_schema.pipes"):
            pipe_name = col(r, "PIPE_NAME") or ""
            add_sys(
                pipe_name,
                "PIPE",
                database=str(col(r, "DATABASE_NAME") or ""),
                state=str(col(r, "STATE") or ""),
                table_name=str(col(r, "TABLE_NAME") or ""),
                load_status=str(col(r, "LOAD_STATUS") or ""),
            )
    except Exception:
        logger.debug("Query failed, skipping")


def _collect_tasks(conn, add_sys: Callable[..., None]) -> None:
    """Tasks + latest run state."""
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
            add_sys(
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


def collect_system_objects(conn, is_admin: bool) -> list[dict]:
    """Collect cluster-level objects (resource groups, volumes, tasks, ...).

    Dedup lives in a single shared ``_add_sys`` closure over ``_sys_seen`` so the
    per-section helpers cannot re-emit an already-seen ``(type, name)``.
    """
    system_objects: list[dict] = []
    _sys_seen: set[tuple[str, str]] = set()

    def _add_sys(name: str, stype: str, **extra: str) -> None:
        key = (stype, name)
        if name and key not in _sys_seen:
            _sys_seen.add(key)
            obj: dict = {"name": name, "type": stype}
            obj.update(extra)
            system_objects.append(obj)

    _collect_resource_groups(conn, is_admin, _add_sys)
    _collect_storage_volumes(conn, _add_sys)
    _collect_resources(conn, _add_sys)
    _collect_warehouses(conn, _add_sys)
    _collect_global_functions(conn, _add_sys)
    _collect_pipes(conn, _add_sys)
    _collect_tasks(conn, _add_sys)

    return system_objects


def flatten_effective_privileges(
    direct_privileges: list[PrivilegeGrant],
    direct_roles: list[str],
    role_tree: dict[str, dict],
) -> list[dict]:
    """Flatten direct + role-inherited grants into effective-privilege rows."""
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

    return effective_privileges
