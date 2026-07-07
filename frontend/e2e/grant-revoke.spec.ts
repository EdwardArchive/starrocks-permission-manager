import { test, expect, type Page } from "@playwright/test";

const HOST = process.env.E2E_SR_HOST || "192.168.10.5";
const PORT = process.env.E2E_SR_PORT || "9030";
const USER = process.env.E2E_SR_USER || "root";
const PASS = process.env.E2E_SR_PASS || "";

const TARGET_USER = "srpm_e2e_target";
const TARGET_ROLE = "srpm_e2e_role";
const E2E_DB = "srpm_e2e_db";
const E2E_TABLE = "demo_t";

test.describe.configure({ mode: "serial" });
test.skip(!PASS, "E2E_SR_PASS is not set — skipping live-cluster E2E");

async function login(page: Page, username: string, password: string) {
  await page.goto("/");
  await page.getByPlaceholder("192.168.1.100").fill(HOST);
  await page.getByPlaceholder("9030").fill(PORT);
  await page.getByPlaceholder("admin").fill(username);
  await page.getByPlaceholder("Password").fill(password);
  await page.getByRole("button", { name: "Connect & Login" }).click();
  await expect(page.getByText("StarRocks Permission Manager")).toBeVisible({ timeout: 20_000 });
}

async function openWizard(page: Page) {
  await page.getByTestId("manage-privileges-btn").click();
  await expect(page.getByTestId("mp-modal")).toBeVisible();
}

/** Fill the grantee input and blur it so the suggestion dropdown closes
 * (it overlays the fields below and would intercept clicks). */
async function fillGrantee(page: Page, name: string) {
  const input = page.getByTestId("mp-grantee-name");
  await input.fill(name);
  await input.press("Tab");
  await page.waitForTimeout(250);
}

/** Fill a ComboInput field and blur it so its dropdown closes
 * (the custom dropdown overlays the row below and would intercept clicks). */
async function fillCombo(page: Page, testId: string, value: string) {
  const input = page.getByTestId(testId);
  await input.fill(value);
  await input.press("Tab");
}

/** Pick an option in a select-only ComboInput (replaces native selectOption). */
async function selectCombo(page: Page, testId: string, value: string) {
  await page.getByTestId(testId).click();
  await page
    .getByTestId(`${testId}-option`)
    .filter({ hasText: new RegExp(`^${value}$`) })
    .click();
}

test("admin sees Manage Privileges button and Grant Audit tab", async ({ page }) => {
  await login(page, USER, PASS);
  await expect(page.getByTestId("manage-privileges-btn")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole("button", { name: "Grant Audit" })).toBeVisible();
});

test("GRANT privilege on table: wizard → preview → execute", async ({ page }) => {
  await login(page, USER, PASS);
  await openWizard(page);

  await fillGrantee(page, TARGET_USER);
  await selectCombo(page, "mp-object-type", "TABLE");
  await fillCombo(page, "mp-catalog", "default_catalog");
  await fillCombo(page, "mp-database", E2E_DB);
  await fillCombo(page, "mp-name", E2E_TABLE);
  await page.getByTestId("mp-priv-SELECT").check();

  const preview = page.getByTestId("mp-preview-sql");
  await expect(preview).toContainText("SET CATALOG `default_catalog`", { timeout: 10_000 });
  await expect(preview).toContainText(
    `GRANT SELECT ON TABLE \`${E2E_DB}\`.\`${E2E_TABLE}\` TO USER '${TARGET_USER}'@'%'`
  );

  await page.getByTestId("mp-execute").click();
  await page.getByTestId("mp-confirm").click();
  await expect(page.getByTestId("mp-modal")).toBeHidden({ timeout: 15_000 });
  await expect(page.getByText("GRANT executed successfully")).toBeVisible({ timeout: 10_000 });
});

test("Grant Audit tab shows the executed GRANT", async ({ page }) => {
  await login(page, USER, PASS);
  await page.getByRole("button", { name: "Grant Audit" }).click();
  const table = page.getByTestId("audit-table");
  await expect(table).toBeVisible({ timeout: 15_000 });
  const firstRow = page.getByTestId("audit-row").first();
  await expect(firstRow).toContainText("GRANT");
  await expect(firstRow).toContainText(E2E_DB);
  await expect(firstRow).toContainText("ok");
});

test("already-granted badge shows for existing grants", async ({ page }) => {
  await login(page, USER, PASS);
  await openWizard(page);
  // the SELECT grant from the previous test still exists
  await fillGrantee(page, TARGET_USER);
  await fillCombo(page, "mp-database", E2E_DB);
  await fillCombo(page, "mp-name", E2E_TABLE);
  await expect(page.getByTestId("mp-already-granted").first()).toBeVisible({ timeout: 15_000 });
});

test("REVOKE via multi-select direct-grants helper", async ({ page }) => {
  await login(page, USER, PASS);
  await openWizard(page);

  await page.getByTestId("mp-action-revoke").check();
  await fillGrantee(page, TARGET_USER);

  // select the SELECT grant created earlier
  const grantRow = page.getByTestId("mp-direct-grant").filter({ hasText: "SELECT" }).first();
  await expect(grantRow).toBeVisible({ timeout: 15_000 });
  await grantRow.click();

  const preview = page.getByTestId("mp-preview-sql");
  await expect(preview).toContainText(
    `REVOKE SELECT ON TABLE \`${E2E_DB}\`.\`${E2E_TABLE}\` FROM USER '${TARGET_USER}'@'%'`,
    { timeout: 10_000 }
  );

  await expect(page.getByTestId("mp-execute")).toContainText("Revoke 1 selected");
  await page.getByTestId("mp-execute").click();
  await page.getByTestId("mp-confirm").click();

  // multi-select mode stays open and reports inline results
  await expect(page.getByTestId("mp-results").locator('[data-ok="true"]').first()).toBeVisible({ timeout: 15_000 });
  await page.getByTestId("mp-close").click();
  await expect(page.getByTestId("mp-modal")).toBeHidden();
});

test("presets and danger badge", async ({ page }) => {
  await login(page, USER, PASS);
  await openWizard(page);
  await fillGrantee(page, TARGET_USER);
  await fillCombo(page, "mp-database", E2E_DB);
  await fillCombo(page, "mp-name", E2E_TABLE);

  await page.getByTestId("mp-preset-Read-write").click();
  await expect(page.getByTestId("mp-preview-sql")).toContainText("GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE", {
    timeout: 10_000,
  });

  await page.getByTestId("mp-preset-Full").click();
  await expect(page.getByTestId("mp-danger-badge")).toBeVisible();
  await expect(page.getByTestId("mp-preview-sql")).toContainText("GRANT ALL ON TABLE", { timeout: 10_000 });
});

test("grantee suggestion auto-sets the grantee type", async ({ page }) => {
  await login(page, USER, PASS);
  await openWizard(page);
  await page.getByTestId("mp-grantee-name").fill(TARGET_ROLE.slice(0, 8));
  const suggestion = page.getByTestId("mp-grantee-name-option").filter({ hasText: TARGET_ROLE }).first();
  await expect(suggestion).toBeVisible({ timeout: 10_000 });
  await suggestion.click();
  await expect(page.getByTestId("mp-grantee-name")).toHaveValue(TARGET_ROLE);
  await expect(page.getByTestId("mp-grantee-type-role")).toBeChecked();
});

test("DAG node context menu opens the wizard", async ({ page }) => {
  await login(page, USER, PASS);
  const node = page.locator(".react-flow__node").first();
  await expect(node).toBeVisible({ timeout: 20_000 });
  await node.click({ button: "right" });
  await expect(page.getByTestId("dag-context-menu")).toBeVisible();
  await page.getByText("⚙ Manage privileges…").click();
  await expect(page.getByTestId("mp-modal")).toBeVisible();
});

test("ROLE assignment with keep-open: grant then revoke in one session", async ({ page }) => {
  await login(page, USER, PASS);

  // grant role with keep-open
  await openWizard(page);
  await page.getByTestId("mp-type-role").check();
  await page.getByTestId("mp-grantee-name").fill(TARGET_USER);
  await fillCombo(page, "mp-role", TARGET_ROLE);
  await page.getByTestId("mp-keep-open").check();
  const preview = page.getByTestId("mp-preview-sql");
  await expect(preview).toContainText(`GRANT \`${TARGET_ROLE}\` TO USER '${TARGET_USER}'@'%'`, { timeout: 10_000 });
  await page.getByTestId("mp-execute").click();
  await page.getByTestId("mp-confirm").click();
  await expect(page.getByTestId("mp-results").locator('[data-ok="true"]').first()).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId("mp-modal")).toBeVisible(); // stayed open

  // revoke it back in the same session (grantee/role are preserved)
  await page.getByTestId("mp-action-revoke").check();
  await expect(preview).toContainText(`REVOKE \`${TARGET_ROLE}\` FROM USER '${TARGET_USER}'@'%'`, { timeout: 10_000 });
  await page.getByTestId("mp-execute").click();
  await page.getByTestId("mp-confirm").click();
  await expect(page.getByTestId("mp-results").locator("> div")).toHaveCount(2, { timeout: 15_000 });
  await page.getByTestId("mp-close").click();
  await expect(page.getByTestId("mp-modal")).toBeHidden();
});

test("invalid function signature shows inline validation error", async ({ page }) => {
  await login(page, USER, PASS);
  await openWizard(page);

  await fillGrantee(page, TARGET_USER);
  await selectCombo(page, "mp-object-type", "FUNCTION");
  await fillCombo(page, "mp-database", E2E_DB);
  await fillCombo(page, "mp-name", "fn(int) WITH GRANT OPTION");
  await page.getByTestId("mp-priv-USAGE").check();

  await expect(page.getByTestId("mp-preview-sql")).toContainText("Invalid function signature", {
    timeout: 10_000,
  });
  await expect(page.getByTestId("mp-execute")).toBeDisabled();
});

test("non-admin user sees neither the button nor the audit tab", async ({ page }) => {
  await login(page, TARGET_USER, "E2eTarget123!");
  await expect(page.getByTestId("cluster-status-btn")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId("manage-privileges-btn")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Grant Audit" })).toHaveCount(0);
});

test("built-in role grantee shows warning and scope grants are not selectable", async ({ page }) => {
  await login(page, USER, PASS);
  await openWizard(page);
  await page.getByTestId("mp-action-revoke").check();
  await page.getByTestId("mp-grantee-type-role").check();
  await fillGrantee(page, "root");

  await expect(page.getByTestId("mp-builtin-warning")).toBeVisible({ timeout: 10_000 });
  // root's wildcard grants (ON ALL ...) are listed as non-selectable scope rows
  await expect(page.getByTestId("mp-scope-grant").first()).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId("mp-direct-grant")).toHaveCount(0);
  await expect(page.getByTestId("mp-execute")).toBeDisabled();
});
