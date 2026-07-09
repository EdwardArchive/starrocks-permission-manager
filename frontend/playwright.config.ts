import { defineConfig } from "@playwright/test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

/**
 * E2E tests for the GRANT/REVOKE feature against a live StarRocks cluster.
 *
 * Requires:
 *  - env E2E_SR_PASS (and optionally E2E_SR_HOST/PORT/USER) for the cluster login,
 *    either exported inline or in the gitignored e2e/.env (see e2e/.env.example)
 *  - fixture objects on the cluster (see e2e/README.md): srpm_audit.grant_log,
 *    srpm_e2e_db.demo_t, user srpm_e2e_target, role srpm_e2e_role
 *
 * Run: npx playwright test          (reads e2e/.env)
 *  or: E2E_SR_PASS=... npx playwright test
 */

// Load the gitignored e2e/.env (KEY=VALUE per line). Inline environment wins.
// Same idiom as e2e/capture-docs-screenshots.mjs.
try {
  const envPath = join(dirname(fileURLToPath(import.meta.url)), "e2e", ".env");
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!m) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (process.env[m[1]] === undefined) process.env[m[1]] = v;
  }
} catch {
  /* no e2e/.env — fall back to the process environment (tests skip without E2E_SR_PASS) */
}

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
      // the suite logs in once per test — don't trip the login rate limiter
      env: { SRPM_LOGIN_MAX_ATTEMPTS: "1000" },
    },
    {
      command: "npm run dev -- --host 0.0.0.0 --port 5199 --strictPort",
      url: "http://localhost:5199",
      reuseExistingServer: true,
      timeout: 30_000,
    },
  ],
});
