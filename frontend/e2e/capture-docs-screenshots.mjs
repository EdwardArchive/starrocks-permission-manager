// Capture curated documentation screenshots for the GRANT/REVOKE feature.
// Not part of the test suite. Requires the dev servers (vite :5199, backend :8888)
// and the e2e fixtures (see e2e/README.md).
//
// Credentials: put E2E_SR_PASS (and optionally E2E_SR_HOST/PORT/USER) in the
// gitignored frontend/e2e/.env (see .env.example), or pass them inline.
// Run: node e2e/capture-docs-screenshots.mjs   (from the frontend/ dir)
import { chromium } from "@playwright/test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// Load a gitignored e2e/.env (KEY=VALUE per line). Inline environment wins.
try {
  const envPath = join(dirname(fileURLToPath(import.meta.url)), ".env");
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!m) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (process.env[m[1]] === undefined) process.env[m[1]] = v;
  }
} catch { /* no e2e/.env — fall back to the process environment */ }

const BASE = "http://localhost:5199";
const OUT = "../docs/screenshots";
const HOST = process.env.E2E_SR_HOST || "192.168.10.5";
const PORT = process.env.E2E_SR_PORT || "9030";
const USER = process.env.E2E_SR_USER || "root";
const PASS = process.env.E2E_SR_PASS;
if (!PASS) { console.error("E2E_SR_PASS not set — put it in frontend/e2e/.env or pass it inline"); process.exit(1); }

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

// login
await page.goto(BASE);
await page.getByPlaceholder("192.168.1.100").fill(HOST);
await page.getByPlaceholder("9030").fill(PORT);
await page.getByPlaceholder("admin").fill(USER);
await page.getByPlaceholder("Password").fill(PASS);
await page.getByRole("button", { name: "Connect & Login" }).click();
await page.getByTestId("manage-privileges-btn").waitFor({ timeout: 20000 });

// 1. wizard with a filled GRANT form + live SQL preview
await page.getByTestId("manage-privileges-btn").click();
await page.getByTestId("mp-grantee-name").fill("srpm_e2e_target");
await page.getByTestId("mp-grantee-name").press("Tab");
await page.waitForTimeout(300);
await page.getByTestId("mp-database").fill("srpm_e2e_db");
await page.getByTestId("mp-name").fill("demo_t");
await page.getByTestId("mp-name").press("Tab"); // close the combo dropdown before clicking below it
await page.getByTestId("mp-priv-SELECT").check();
await page.getByTestId("mp-preview-sql").filter({ hasText: "GRANT SELECT" }).waitFor({ timeout: 10000 });
await page.screenshot({ path: `${OUT}/manage-privileges-wizard.png` });
console.log("✓ manage-privileges-wizard.png");

// execute it so the revoke helper has something to list
await page.getByTestId("mp-execute").click();
await page.getByTestId("mp-confirm").click();
await page.getByTestId("mp-modal").waitFor({ state: "hidden", timeout: 15000 });

// 2. revoke mode: click a current grant to load it into the held-driven form
await page.getByTestId("manage-privileges-btn").click();
await page.getByTestId("mp-action-revoke").check();
await page.getByTestId("mp-grantee-name").fill("srpm_e2e_target");
await page.getByTestId("mp-grantee-name").press("Tab");
await page.waitForTimeout(300);
const revokeRow = page.getByTestId("mp-direct-grant").filter({ hasText: "SELECT" }).first();
await revokeRow.waitFor({ timeout: 15000 });
await revokeRow.click(); // loads its object + privilege into the form below
await page.getByTestId("mp-preview-sql").filter({ hasText: "REVOKE" }).waitFor({ timeout: 10000 });
await page.screenshot({ path: `${OUT}/revoke-direct-grants.png` });
console.log("✓ revoke-direct-grants.png");

// clean up: execute the revoke (single object; the modal closes on success)
await page.getByTestId("mp-execute").click();
await page.getByTestId("mp-confirm").click();
await page.getByTestId("mp-modal").waitFor({ state: "hidden", timeout: 15000 });

// 3. Grant Audit tab
await page.getByRole("button", { name: "Grant Audit" }).click();
await page.getByTestId("audit-table").waitFor({ timeout: 15000 });
await page.screenshot({ path: `${OUT}/grant-audit-tab.png` });
console.log("✓ grant-audit-tab.png");

await browser.close();
