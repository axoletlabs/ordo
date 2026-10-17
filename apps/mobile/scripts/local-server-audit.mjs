/** Browser-to-real-server workflows, ONLY against a disposable loopback instance.
 * Start the server with a fresh /tmp/opencode database, test-only secrets, no
 * SMTP, and REGISTRATION_ENABLED=true. Set ORDO_AUDIT_API to that loopback URL.
 * Accounts are newly created example.test addresses; no pre-existing login.
 */
import assert from "node:assert/strict";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { resolve } from "node:path";
const api = new URL(process.env.ORDO_AUDIT_API ?? "http://127.0.0.1:8260");
const base = new URL(process.env.ORDO_UI_URL ?? "http://127.0.0.1:8256");
for (const url of [api, base]) assert.ok(["127.0.0.1", "localhost", "[::1]"].includes(url.hostname), "Audit refuses non-loopback servers");
const output = process.env.ORDO_UI_OUTPUT ?? "/tmp/opencode/ordo-stage2-local-server";
await mkdir(output, { recursive: true });
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? "playwright");
const browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM, args: ["--no-sandbox"] });
const checks = [], errors = [], captures = [];
const suffix = `${Date.now()}`;
const email = `audit-${suffix}@example.test`, password = "Audit-only-passphrase-123!";
let token, page;
const check = (condition, name) => { checks.push({ name, pass: !!condition }); assert.ok(condition, name); };
const button = (name) => page.getByRole("button", { name, exact: true });
const dialog = () => page.getByRole("dialog");
async function capture(name) {
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${output}/${name}.png` }); captures.push(name);
  check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${name}: viewport contained`);
}
async function request(path, options = {}) {
  const response = await fetch(new URL(path, api), { ...options, headers: { "content-type": "application/json", "x-ordo-client": "mobile",
    ...(token ? { authorization: `Bearer ${token}` } : {}), ...options.headers },
    ...(options.body ? { body: JSON.stringify(options.body) } : {}) });
  const body = await response.json();
  assert.ok(response.ok, `${options.method ?? "GET"} ${path}: ${response.status} ${JSON.stringify(body)}`);
  return body;
}
async function home() {
  await page.goto(base.href);
  await page.locator('[data-testid="launch-splash"]').waitFor({ state: "hidden" });
  await button("Library actions").waitFor();
}
async function folderMenu(name = "Audit private") {
  await home();
  await page.getByRole("button", { name: new RegExp(`^${name},`) }).click({ button: "right" });
}
async function closeDialog() { await page.keyboard.press("Escape"); await dialog().waitFor({ state: "hidden" }); }
async function pickImport(text, filename, mimeType) {
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: /^Import from file,/ }).click();
  await (await chooser).setFiles({ name: filename, mimeType, buffer: Buffer.from(text) });
  await dialog().waitFor();
}
try {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, acceptDownloads: true });
  await ctx.addInitScript(({ server }) => localStorage.setItem("ordo.settings", JSON.stringify({ serverUrl: server, themeMode: "light", expressive: true, materialYouColors: false })), { server: api.origin });
  page = await ctx.newPage();
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/*", (route) => {
    const url = new URL(route.request().url());
    if ([base.origin, api.origin].includes(url.origin) || ["blob:", "data:"].includes(url.protocol)) return route.continue();
    // No cloud API, release server or external website participates in this run.
    if (url.hostname === "www.google.com") return route.fulfill({ contentType: "image/svg+xml", body: '<svg xmlns="http://www.w3.org/2000/svg"/>' });
    return route.abort();
  });
  await page.goto(new URL("register", base).href);
  await page.locator("#register-name").fill("Audit account");
  await page.locator("#register-username").fill(email);
  await page.locator("#register-password").fill(password);
  await page.locator("#register-password-confirm").fill("mismatch");
  await button("Create account").click();
  await page.getByText("Passwords don't match.", { exact: true }).waitFor();
  check(true, "registration mismatch is field-owned and does not submit");
  await page.locator("#register-password-confirm").fill(password);
  const registered = page.waitForResponse((response) => response.url() === `${api.origin}/api/auth/register` && response.request().method() === "POST");
  await button("Create account").click();
  const session = await (await registered).json(); token = session.tokens?.accessToken;
  check(!!token, "real registration creates a new isolated session");
  await button("Library actions").waitFor();
  await page.locator('[data-testid="launch-splash"]').waitFor({ state: "hidden" });
  await capture("registered-library");

  await button("Save bookmark").first().click();
  await button("Folder, Bookmarks").click();
  await page.getByRole("menuitem", { name: "New folder", exact: true }).click();
  await page.getByRole("textbox", { name: "Name", exact: true }).fill("Audit private");
  await button("Create folder").click();
  await page.getByRole("textbox", { name: "Link", exact: true }).waitFor();
  check((await request("/api/folders")).some((folder) => folder.name === "Audit private"), "nested folder creation persisted on real server");
  await page.getByRole("textbox", { name: "Link", exact: true }).fill(`https://example.test/audit-${suffix}`);
  await dialog().getByRole("button", { name: "Save bookmark", exact: true }).click();
  await dialog().waitFor({ state: "hidden" });
  let folders = await request("/api/folders");
  const folder = folders.find((row) => row.name === "Audit private");
  check(folder.bookmarkCount === 1, "real save updates folder membership/count");

  await folderMenu();
  await page.getByRole("menuitem", { name: "Lock folder", exact: true }).click();
  await page.getByRole("menuitem", { name: "Text password", exact: true }).click();
  await dialog().locator('input[aria-label="Password"]').fill("private-pass");
  await dialog().locator('input[aria-label="Confirm password"]').fill("wrong");
  await button("Lock folder").click();
  await page.getByText("Passwords do not match.", { exact: true }).waitFor();
  check(true, "folder lock mismatch remains editable");
  await dialog().locator('input[aria-label="Confirm password"]').fill("private-pass");
  const locked = page.waitForResponse((response) => response.url().endsWith(`/folders/${folder.id}/password`) && response.request().method() === "POST");
  await button("Lock folder").click(); await locked;
  await dialog().waitFor({ state: "hidden" });
  check((await request("/api/folders")).find((row) => row.id === folder.id).protected, "password lock persists and clears local access");
  await home();
  await page.getByRole("button", { name: /^Audit private,/ }).click();
  await page.locator('input[aria-label="Password"]').fill("incorrect");
  await button("Unlock").click();
  await page.locator('[role="alert"]').filter({ hasText: /password|incorrect|unlock/i }).first().waitFor();
  check(true, "wrong folder credential receives inline failure");
  await page.locator('input[aria-label="Password"]').fill("private-pass");
  await button("Unlock").click();
  await page.getByRole("button", { name: new RegExp(`^Audit ${suffix},`) }).first().waitFor();
  await capture("unlocked-folder");

  await folderMenu();
  await page.getByRole("menuitem", { name: "Remove lock", exact: true }).click();
  await button("Use account password").click();
  await dialog().locator('input[aria-label="Account password"]').fill(password);
  await button("Remove lock").click();
  await dialog().waitFor({ state: "hidden" });
  check(!(await request("/api/folders")).find((row) => row.id === folder.id).protected, "account-password lock recovery persists");

  await page.goto(new URL("settings/data", base).href);
  const csv = `url,title,folder,tags\nhttps://example.test/import-${suffix},Imported audit reading,Audit private,Design\n`;
  await pickImport(csv, "audit.csv", "text/csv");
  await page.getByText("1 new bookmark", { exact: true }).waitFor();
  await button("Advanced").click();
  await page.getByRole("radio", { name: "Update", exact: true }).click();
  await capture("import-preview");
  let releaseCommit, arrived;
  const heldCommit = new Promise((resolve) => { releaseCommit = resolve; });
  const committing = new Promise((resolve) => { arrived = resolve; });
  await page.route("**/api/import-export/import/*/commit", async (route) => { arrived(); await heldCommit; await route.continue(); });
  await button("Import").click();
  await committing;
  check(await page.getByRole("radio", { name: "Update", exact: true }).isDisabled(), "pending import disables duplicate policy changes");
  check(await page.getByRole("switch").isDisabled(), "pending import disables atomic option changes");
  check(await button("Advanced").isDisabled(), "pending import disables advanced branch changes");
  await page.keyboard.press("Escape");
  check(await dialog().count() === 1, "pending import cannot be discarded with Escape");
  releaseCommit();
  await page.getByText("Import complete", { exact: true }).waitFor();
  await capture("import-complete");
  await button("Done").click();
  await dialog().waitFor({ state: "hidden" });
  check((await request("/api/folders")).find((row) => row.id === folder.id).bookmarkCount === 2, "CSV import committed to existing folder");
  for (const format of ["JSON", "HTML", "CSV"]) {
    await page.getByRole("radio", { name: format, exact: true }).click();
    const downloading = page.waitForEvent("download");
    await button("Export library").click();
    const download = await downloading;
    const bytes = await readFile(await download.path());
    check(bytes.toString().includes(`import-${suffix}`), `${format} download contains actual saved data`);
    await download.saveAs(`${output}/export.${format.toLowerCase()}`);
  }
  await pickImport(csv, "duplicate.csv", "text/csv");
  await page.getByText("Already in your library", { exact: true }).waitFor();
  check(true, "duplicate preview recognizes committed URL");
  await button("Done").click(); await dialog().waitFor({ state: "hidden" });
  await pickImport("not a bookmark file", "invalid.json", "application/json");
  await page.getByText(/Couldn't import|No bookmarks in this file/, { exact: false }).waitFor();
  await capture("import-invalid");
  await closeDialog();

  await page.goto(new URL("settings/security", base).href);
  const beginning = page.waitForResponse((response) => response.url().endsWith("/auth/mfa/totp/begin"));
  await button("Set up authenticator").click();
  const setup = await (await beginning).json();
  const requireServer = createRequire(resolve("apps/server/package.json"));
  const { TOTP, Secret } = requireServer("otpauth");
  const otp = new TOTP({ secret: Secret.fromBase32(setup.secret) }).generate();
  const confirmed = page.waitForResponse((response) => response.url().endsWith("/auth/mfa/totp/confirm"));
  await page.locator('input[aria-label^="Authenticator code"]').first().fill(otp);
  const enrollment = await (await confirmed).json();
  await page.getByText(/backup codes/i).first().waitFor();
  check((await request("/api/auth/me")).mfaEnabled, "real authenticator enrollment accepts a generated TOTP");
  await button("Done").click(); await dialog().waitFor({ state: "hidden" });
  await page.goto(new URL("settings", base).href);
  await button("Sign out").click();
  await dialog().getByRole("button", { name: "Sign out", exact: true }).click();
  await page.locator("#login-username").waitFor();
  check(true, "real logout returns to credential screen");
  await page.locator("#login-username").fill(email);
  await page.locator("#login-password").fill(password);
  await button("Sign in").click();
  await button("Use a backup code").waitFor();
  const invalid = otp === "000000" ? "111111" : "000000";
  await page.locator('input[aria-label^="Authenticator code"]').first().fill(invalid);
  await page.getByRole("alert").waitFor();
  check(true, "real MFA rejects incorrect code without abandoning challenge");
  await button("Use a backup code").click();
  const signedIn = page.waitForResponse((response) => response.url().endsWith("/auth/login/mfa"));
  await page.locator('input[aria-label^="Backup code"]').first().fill(enrollment.backupCodes[0]);
  token = (await (await signedIn).json()).tokens.accessToken;
  await button("Library actions").waitFor();
  check(true, "real one-time backup code signs back into existing library");
  // Only the freshly created disposable account is ever deleted.
  assert.equal((await request("/api/auth/me")).email, email);
  await page.goto(new URL("settings/delete-account", base).href);
  await page.locator("#delete-account-password").fill(password);
  check(await button("Delete account").isDisabled(), "account deletion requires exact confirmation");
  await page.locator("#delete-account-confirmation").fill("DELETE MY ACCOUNT");
  await button("Delete account").click();
  await dialog().waitFor();
  check(await page.locator("#delete-account-password").inputValue() === "•".repeat(password.length), "step-up removes real parent password from obscured input");
  await closeDialog();
  check(await page.locator("#delete-account-password").inputValue() === password, "step-up cancellation restores private draft");
  await button("Delete account").click();
  await dialog().waitFor();
  await button("Use a backup code").click();
  await page.locator('input[aria-label^="Backup code"]').first().fill(enrollment.backupCodes[1]);
  await page.locator("#login-username").waitFor();
  check(true, "real step-up deletion removes only the disposable account and signs out");
  check(errors.length === 0, "no uncaught application errors in real-server workflows");
} catch (error) {
  checks.push({ name: "execution", pass: false, error: error.stack });
  if (page && !page.isClosed()) { await page.screenshot({ path: `${output}/failure.png` }); await writeFile(`${output}/failure.html`, await page.content()); }
  throw error;
} finally {
  await writeFile(`${output}/results.json`, JSON.stringify({ checks, errors, captures, note: "New isolated example.test account on loopback API; no real user data." }, null, 2));
  await browser.close();
}
console.log(JSON.stringify({ checks: checks.length, captures: captures.length, errors }, null, 2));
