import { defineConfig } from "@playwright/test";

/**
 * E2E tests for the GRANT/REVOKE feature against a live StarRocks cluster.
 *
 * Requires:
 *  - env E2E_SR_PASS (and optionally E2E_SR_HOST/PORT/USER) for the cluster login
 *  - fixture objects on the cluster (see e2e/README.md): srpm_audit.grant_log,
 *    srpm_e2e_db.demo_t, user srpm_e2e_target, role srpm_e2e_role
 *
 * Run: E2E_SR_PASS=... npx playwright test
 */
export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  retries: 0,
  workers: 1, // tests mutate shared cluster state — keep serial
  reporter: [["html", { open: "never" }], ["list"]],
  use: {
    // dedicated E2E port — 5173/5174 are commonly taken by other dev servers
    baseURL: "http://localhost:5199",
    screenshot: "on",
    video: "retain-on-failure",
    trace: "retain-on-failure",
  },
  webServer: [
    {
      command: "../backend/venv/bin/uvicorn app.main:app --port 8888 --app-dir ../backend",
      url: "http://localhost:8888/api/health",
      reuseExistingServer: true,
      timeout: 30_000,
    },
    {
      command: "npm run dev -- --host 0.0.0.0 --port 5199 --strictPort",
      url: "http://localhost:5199",
      reuseExistingServer: true,
      timeout: 30_000,
    },
  ],
});
