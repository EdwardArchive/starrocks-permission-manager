// Capture curated documentation screenshots for the GRANT/REVOKE feature.
// Not part of the test suite. Requires the dev servers (vite :5199, backend :8888)
// and the e2e fixtures (see e2e/README.md).
//
// Run: E2E_SR_PASS='...' node e2e/capture-docs-screenshots.mjs
import { chromium } from "@playwright/test";

const BASE = "http://localhost:5199";
const OUT = "../docs/screenshots";
const HOST = process.env.E2E_SR_HOST || "192.168.10.5";
const PORT = process.env.E2E_SR_PORT || "9030";
const USER = process.env.E2E_SR_USER || "root";
const PASS = process.env.E2E_SR_PASS;
if (!PASS) { console.error("E2E_SR_PASS not set"); process.exit(1); }

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

// 2. revoke mode with the direct-grants helper list
await page.getByTestId("manage-privileges-btn").click();
await page.getByTestId("mp-action-revoke").check();
await page.getByTestId("mp-grantee-name").fill("srpm_e2e_target");
await page.getByTestId("mp-grantee-name").press("Tab");
await page.waitForTimeout(300);
await page.getByTestId("mp-direct-grant").first().waitFor({ timeout: 15000 });
await page.screenshot({ path: `${OUT}/revoke-direct-grants.png` });
console.log("✓ revoke-direct-grants.png");

// clean up: revoke the grant we just created (multi-select mode keeps the modal open)
await page.getByTestId("mp-direct-grant").first().click();
await page.getByTestId("mp-preview-sql").filter({ hasText: "REVOKE" }).waitFor({ timeout: 10000 });
await page.getByTestId("mp-execute").click();
await page.getByTestId("mp-confirm").click();
await page.getByTestId("mp-results").waitFor({ timeout: 15000 });
await page.getByTestId("mp-close").click();
await page.getByTestId("mp-modal").waitFor({ state: "hidden", timeout: 15000 });

// 3. Grant Audit tab
await page.getByRole("button", { name: "Grant Audit" }).click();
await page.getByTestId("audit-table").waitFor({ timeout: 15000 });
await page.screenshot({ path: `${OUT}/grant-audit-tab.png` });
console.log("✓ grant-audit-tab.png");

await browser.close();
