"""sys.role_edges → SHOW GRANTS fallback must fire only when the sys query fails,
not when it succeeds with zero rows."""
from __future__ import annotations

from app.utils.role_helpers import get_parent_roles, get_user_roles


class _Cursor:
    def __init__(self, conn):
        self._conn = conn
        self._rows: list[dict] = []

    def execute(self, sql, params=()):
        self._conn.queries.append(sql)
        self._rows = self._conn.handler(sql, params)  # may raise

    def fetchall(self):
        return self._rows

    def close(self):
        pass


class _Conn:
    """Connection driven by a handler(sql, params) -> rows (or raising)."""

    def __init__(self, handler):
        self.handler = handler
        self.queries: list[str] = []

    def cursor(self, dictionary=False):
        return _Cursor(self)

    def close(self):
        pass


def test_parent_roles_empty_success_does_not_fall_back():
    def handler(sql, params):
        if "sys.role_edges" in sql:
            return []  # success, no parents
        raise AssertionError(f"unexpected fallback query: {sql}")

    conn = _Conn(handler)
    assert get_parent_roles(conn, "leaf_role") == []
    assert not any("SHOW GRANTS" in q for q in conn.queries)


def test_parent_roles_fall_back_when_sys_raises():
    def handler(sql, params):
        if "sys.role_edges" in sql:
            raise PermissionError("access denied")
        if "SHOW GRANTS FOR ROLE" in sql:
            return [{"Grants": "GRANT 'parent_role' TO ROLE 'leaf_role'"}]
        return []

    conn = _Conn(handler)
    assert get_parent_roles(conn, "leaf_role") == ["parent_role"]
    assert any("SHOW GRANTS" in q for q in conn.queries)


def test_user_roles_empty_success_does_not_fall_back():
    def handler(sql, params):
        if "sys.role_edges" in sql:
            return []
        raise AssertionError(f"unexpected fallback query: {sql}")

    conn = _Conn(handler)
    assert get_user_roles(conn, "loner") == []
    assert not any("SHOW GRANTS" in q for q in conn.queries)


def test_user_roles_fall_back_when_sys_raises():
    def handler(sql, params):
        if "sys.role_edges" in sql:
            raise PermissionError("access denied")
        if "SHOW GRANTS FOR" in sql:
            return [{"Grants": "GRANT 'analyst_role' TO USER 'kim'"}]
        return []

    conn = _Conn(handler)
    assert get_user_roles(conn, "kim") == ["analyst_role"]
