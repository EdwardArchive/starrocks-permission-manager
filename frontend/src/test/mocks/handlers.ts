import { http, HttpResponse } from "msw";

export const handlers = [
  // ── Auth ──
  http.post("/api/auth/login", () =>
    HttpResponse.json({
      token: "mock-jwt-token",
      username: "test_user",
      roles: ["role_admin", "db_reader"],
      default_role: "role_admin",
    }),
  ),

  http.post("/api/auth/logout", () =>
    HttpResponse.json({ detail: "Logged out" }),
  ),

  http.get("/api/auth/me", () =>
    HttpResponse.json({
      username: "test_user",
      roles: ["role_admin", "db_reader"],
      default_role: "role_admin",
      is_user_admin: true,
    }),
  ),

  // ── User Objects ──
  http.get("/api/user/objects/catalogs", () =>
    HttpResponse.json([{ name: "default_catalog", catalog_type: "Internal" }]),
  ),

  http.get("/api/user/objects/databases", () =>
    HttpResponse.json([{ name: "analytics_db", catalog: "default_catalog" }]),
  ),

  // ── User Permissions ──
  http.get("/api/user/my-permissions", () =>
    HttpResponse.json({
      username: "test_user",
      direct_roles: ["role_admin"],
      role_tree: {},
      effective_privileges: [],
      accessible_databases: [],
      accessible_catalogs: [],
      accessible_objects: [],
      system_objects: [],
    }),
  ),

  // ── User Roles ──
  http.get("/api/user/roles", () =>
    HttpResponse.json([{ name: "role_admin", is_builtin: false }]),
  ),

  // ── User DAG ──
  http.get("/api/user/dag/role-hierarchy", () =>
    HttpResponse.json({ nodes: [], edges: [] }),
  ),

  http.get("/api/user/dag/object-hierarchy", () =>
    HttpResponse.json({ nodes: [], edges: [] }),
  ),

  // ── User Search ──
  http.get("/api/user/search", () => HttpResponse.json([])),
];
