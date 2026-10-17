/** Adversarial pending/error/retry, narrow OTP, and live motion-preference tests.
 * Fixture-only. The real-server counterpart is local-server-audit.mjs.
 */
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
process.env.ORDO_AUDIT_LIBRARY = "1";
const { browser, context, screen, settle, button, check, results, base, output } = await import("./ui-audit.mjs");
let page;
async function delayedFailure(page, pattern, success, method = "POST") {
  let release, arrived;
  let count = 0;
  const pending = new Promise((resolve) => { release = resolve; });
  const started = new Promise((resolve) => { arrived = resolve; });
  await page.route(pattern, async (route) => {
    if (route.request().method() !== method) return route.fallback();
    count++;
    if (count === 1) { arrived(); await pending; }
    await route.fulfill({ status: count === 1 ? 400 : 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" },
      body: JSON.stringify(count === 1 ? { error: { code: "audit_denied", message: "Audit denied" } } : success) });
  });
  return { started, release, count: () => count };
}
async function home(page) {
  await page.goto(base);
  await button(page, "Library actions").waitFor();
  await page.locator('[data-testid="launch-splash"]').waitFor({ state: "hidden" });
}
async function folderMenu(page) {
  await home(page);
  await page.getByRole("button", { name: /^Design & inspiration, 2 bookmarks/ }).click({ button: "right" });
}
async function remainsPending(page, name) {
  await page.keyboard.press("Escape"); await settle(page);
  check(await page.getByRole("dialog").count() === 1, `${name}: Escape does not discard pending mutation`);
  await page.mouse.click(1, 1); await settle(page);
  check(await page.getByRole("dialog").count() === 1, `${name}: scrim does not discard pending mutation`);
}
try {
  for (const theme of ["light", "dark"]) for (const expressive of [false, true]) {
    const created = await context({ theme, expressive }); page = created.page;
    const label = `${theme}-${expressive}`;
    // Reject a lock once, then succeed: the same draft must survive the error.
    const lock = await delayedFailure(page, "**/api/folders/collection/password", { success: true });
    await folderMenu(page);
    await page.getByRole("menuitem", { name: "Lock folder", exact: true }).click(); await settle(page);
    await page.getByRole("menuitem", { name: "Text password", exact: true }).click();
    await page.locator('input[aria-label="Password"]').fill("retained-pass");
    await page.locator('input[aria-label="Confirm password"]').fill("retained-pass");
    await button(page, "Lock folder").click(); await lock.started;
    check(await page.locator('input[aria-label="Password"]').isDisabled(), `${label}: lock input disabled while pending`);
    check(await button(page, "Back").isDisabled(), `${label}: lock Back disabled while pending`);
    await remainsPending(page, `${label}: lock`);
    await screen(page, `${label}-lock-pending`);
    check(lock.count() === 1, `${label}: only one lock request in flight`);
    lock.release();
    await page.getByText("Audit denied", { exact: true }).waitFor();
    check(await page.locator('input[aria-label="Password"]').inputValue() === "retained-pass", `${label}: rejected lock retains draft`);
    check(await page.locator('input[aria-label="Password"]').isEnabled(), `${label}: rejected lock can retry`);
    await screen(page, `${label}-lock-retry`);
    await button(page, "Lock folder").click();
    await page.getByRole("dialog").waitFor({ state: "hidden" });
    check(lock.count() === 2, `${label}: one explicit retry succeeds`);

    const rename = await delayedFailure(page, "**/api/folders/collection", { id: "collection", name: "Renamed", icon: "folder-outline", bookmarkCount: 2, unreadCount: 2 }, "PATCH");
    await folderMenu(page);
    await page.getByRole("menuitem", { name: "Rename", exact: true }).click();
    await page.getByRole("textbox", { name: "Name", exact: true }).fill("Preserved rename");
    await button(page, "Save").click(); await rename.started;
    check(await page.getByRole("textbox", { name: "Name", exact: true }).isDisabled(), `${label}: rename field disabled while pending`);
    await remainsPending(page, `${label}: rename`);
    rename.release();
    await page.getByText("Audit denied", { exact: true }).waitFor();
    check(await page.getByRole("textbox", { name: "Name", exact: true }).inputValue() === "Preserved rename", `${label}: failed rename retains input`);
    await screen(page, `${label}-rename-error`);
    await page.keyboard.press("Escape"); await settle(page);

    const save = await delayedFailure(page, "**/api/bookmarks", { id: "new", folderId: null, title: "New bookmark", tags: [], createdAt: "2026-10-17T00:00:00Z" });
    await button(page, "Save bookmark").first().click();
    await page.getByRole("textbox", { name: "Link", exact: true }).fill("https://example.test/draft");
    await page.getByRole("dialog").getByRole("button", { name: "Save bookmark", exact: true }).click(); await save.started;
    check(await page.getByRole("textbox", { name: "Link", exact: true }).isDisabled(), `${label}: pending save disables link`);
    check(await button(page, "Folder, Bookmarks").isDisabled(), `${label}: pending save disables destination picker`);
    check(await button(page, "Tags, Add tags").isDisabled(), `${label}: pending save disables tag picker`);
    await remainsPending(page, `${label}: save`);
    save.release(); await page.getByText("Audit denied", { exact: true }).waitFor();
    check(await page.getByRole("textbox", { name: "Link", exact: true }).inputValue() === "https://example.test/draft", `${label}: save error retains URL`);
    await screen(page, `${label}-save-error`);
    await created.context.close();

    // The full 6-digit PIN must keep 48dp fields even inside a 320px dialog.
    const narrow = await context({ theme, expressive, width: 320 }); page = narrow.page;
    await folderMenu(page);
    await page.getByRole("menuitem", { name: "Lock folder", exact: true }).click(); await settle(page);
    await page.getByRole("menuitem", { name: "PIN", exact: true }).click();
    await page.getByRole("radio", { name: "6 digits", exact: true }).click();
    await screen(page, `${label}-pin-six-narrow`);
    const cells = page.locator('input[aria-label^="PIN, digit"]');
    check(await cells.count() === 6, `${label}: all narrow PIN cells mounted`);
    await cells.first().fill("12");
    await page.setViewportSize({ width: 844, height: 390 }); await settle(page);
    check(await cells.evaluateAll((inputs) => inputs.map((input) => input.value).join("")) === "12", `${label}: OTP draft survives grouped layout change`);
    check(await cells.evaluateAll((inputs) => inputs.includes(document.activeElement)), `${label}: OTP keyboard focus survives grouped layout change`);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await screen(page, `${label}-pin-reduced-landscape`);
    await page.keyboard.press("Escape"); await settle(page);
    check(await page.getByRole("dialog").count() === 0, `${label}: reduced motion dismisses dialog without retained blocker`);
    await narrow.context.close();
  }
  check(results.errors.length === 0, "no uncaught workflow errors", results.errors);
} catch (error) {
  results.issues.push({ name: "execution", details: error.stack });
  if (page && !page.isClosed()) { await page.screenshot({ path: `${output}/failure.png` }); await writeFile(`${output}/failure.html`, await page.content()); }
} finally {
  await writeFile(`${output}/results.json`, JSON.stringify(results, null, 2));
  await browser.close();
}
console.log(JSON.stringify({ captures: results.screens.length, checks: results.checks.length, issues: results.issues, errors: results.errors }, null, 2));
assert.equal(results.issues.length, 0);
