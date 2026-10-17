/** Synthetic production-web regression for concurrent menu/row exits and
 * disclosure/checkbox/error motion. rAF samples are not native frame metrics. */
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
process.env.ORDO_AUDIT_LIBRARY = "1";
const { browser, context, button, screen, settle, check, results, base, output } = await import("./ui-audit.mjs");
const measurements = [];
try {
  const configurations = [
    ...["light", "dark"].flatMap((theme) => [false, true].flatMap((expressive) => [390, 1280].map((width) => ({ theme, expressive, width, height: width === 390 ? 844 : 800 })))),
    { theme: "light", expressive: false, width: 844, height: 390, reducedMotion: "reduce" },
    { theme: "dark", expressive: true, reducedMotion: "reduce" },
  ];
  for (const options of configurations) {
    const label = `${options.theme}-${options.expressive}-${options.width ?? 390}-${options.reducedMotion ?? "normal"}`;
    const { page, context: ctx } = await context(options);
    await page.goto(base);
    await button(page, "Save bookmark").first().waitFor();
    await page.locator('[data-testid="launch-splash"]').waitFor({ state: "hidden" });
    for (const kind of ["bookmark", "folder"]) {
      const row = page.getByRole("button", { name: kind === "bookmark" ? /^Building a more expressive design system,/ : /^Design & inspiration, 2 bookmarks/, includeHidden: true });
      await row.click({ button: "right" }); await settle(page);
      const selected = await row.evaluate((node) => Number(getComputedStyle(node.parentElement.querySelector('[data-testid="material-row-selection"]')).opacity));
      check(selected > 0.99, `${label}: ${kind} menu highlights its row`, { selected });
      await row.evaluate((node) => {
        const layer = node.parentElement.querySelector('[data-testid="material-row-selection"]');
        const menu = document.querySelector('[role="menu"]:not([aria-hidden="true"])');
        window.menuExitSamples = [];
        const start = performance.now();
        const sample = () => {
          window.menuExitSamples.push({ time: performance.now(), dismissed: menu.getAttribute("aria-hidden") === "true",
            mounted: menu.isConnected, opacity: Number(getComputedStyle(layer).opacity) });
          if (performance.now() - start < 650) requestAnimationFrame(sample);
        };
        requestAnimationFrame(sample);
      });
      await page.keyboard.press("Escape"); await page.waitForTimeout(700);
      const samples = await page.evaluate(() => window.menuExitSamples);
      const dismissed = samples.find((entry) => entry.dismissed);
      const fading = samples.find((entry) => entry.dismissed && entry.opacity < 0.95);
      const cleared = samples.find((entry) => entry.dismissed && entry.opacity < 0.01);
      const removed = samples.find((entry) => !entry.mounted);
      const measurement = { label, kind, firstFadeMs: fading && dismissed ? fading.time - dismissed.time : null,
        clearedMs: cleared && dismissed ? cleared.time - dismissed.time : null,
        menuRemovedMs: removed && dismissed ? removed.time - dismissed.time : null, samples };
      measurements.push(measurement);
      check(measurement.firstFadeMs != null && measurement.firstFadeMs < 100, `${label}: ${kind} row fades during menu exit`, measurement);
      check(measurement.clearedMs != null && measurement.clearedMs <= measurement.menuRemovedMs + 50,
        `${label}: ${kind} row does not linger after menu removal`, measurement);
      // A nested page/confirmation is still the same visible action session.
      await row.click({ button: "right" }); await settle(page);
      await page.getByRole("menuitem", { name: kind === "bookmark" ? "Delete bookmark" : "Rename", exact: true }).click();
      await page.getByRole("dialog").waitFor(); await settle(page);
      check(await row.evaluate((node) => Number(getComputedStyle(node.parentElement.querySelector('[data-testid="material-row-selection"]')).opacity)) > 0.99,
        `${label}: ${kind} nested surface retains highlight`);
      await page.keyboard.press("Escape"); await settle(page);
      // These nested surfaces return to the menu rather than ending the session.
      await page.keyboard.press("Escape"); await settle(page);
      await row.click({ button: "right" }); await settle(page);
      await page.keyboard.press("Escape"); await page.waitForTimeout(40);
      await row.click({ button: "right" }); await settle(page);
      check(await page.getByRole("menu").count() === 1 && await row.evaluate((node) => Number(getComputedStyle(node.parentElement.querySelector('[data-testid="material-row-selection"]')).opacity)) > 0.99,
        `${label}: ${kind} rapid reopen survives stale exits`);
      await page.keyboard.press("Escape"); await settle(page);
    }
    if (process.argv.includes("--highlight-only")) { await ctx.close(); continue; }
    await page.goto(`${base}/settings/appearance`);
    const trigger = page.getByRole("button", { name: /^Theme,/, includeHidden: true });
    const chevron = trigger.getByTestId("material-disclosure-chevron");
    const angle = () => chevron.evaluate((node) => { const matrix = new DOMMatrix(getComputedStyle(node).transform); return Math.abs(Math.atan2(matrix.b, matrix.a) * 180 / Math.PI); });
    check(await angle() < 1, `${label}: closed dropdown chevron rests down`);
    await trigger.click(); await settle(page);
    check(Math.abs(await angle() - 180) < 1, `${label}: open dropdown chevron points up`);
    await screen(page, `${label}-theme-menu`);
    await page.keyboard.press("Escape"); await settle(page);
    check(await angle() < 1, `${label}: dismiss reverses disclosure motion`);
    await trigger.click(); await page.getByRole("menu").waitFor();
    await page.keyboard.press("Escape"); await settle(page);
    check(await angle() < 1, `${label}: rapid dismiss leaves chevron settled`);
    await page.goto(base);
    await button(page, "Save bookmark").first().click(); await settle(page);
    const tags = page.getByRole("button", { name: /^Tags,/, includeHidden: true });
    await tags.click(); await settle(page);
    check(await tags.getAttribute("aria-expanded") === "true", `${label}: form disclosure exposes expanded state`);
    await page.keyboard.press("Escape"); await settle(page);
    check(await tags.getAttribute("aria-expanded") === "false", `${label}: form disclosure collapses`);
    await page.keyboard.press("Escape"); await settle(page);
    await ctx.close();

    const auth = await context({ ...options, authenticated: false });
    await auth.page.goto(`${base}/register`);
    const checkbox = auth.page.getByRole("checkbox");
    await checkbox.waitFor();
    // The wrapping consent copy contains independent legal links. Click the
    // checkbox mark, not the center of a wide row (which may land on a link).
    await checkbox.click({ position: { x: 8, y: 20 } });
    check(await checkbox.getAttribute("aria-checked") === "true", `${label}: checkbox toggles semantics immediately`);
    await settle(auth.page);
    check(Number(await checkbox.getByTestId("material-checkbox-mark").evaluate((node) => getComputedStyle(node).opacity)) > 0.99,
      `${label}: checkbox confirmation settles`);
    await checkbox.click({ position: { x: 8, y: 20 } }); await settle(auth.page);
    check(Number(await checkbox.getByTestId("material-checkbox-mark").evaluate((node) => getComputedStyle(node).opacity)) < 0.01,
      `${label}: checkbox reversal clears mark`);
    await auth.page.goto(`${base}/login`);
    await auth.page.route("**/api/auth/login", (route) => route.fulfill({ status: 503, contentType: "application/json", headers: { "access-control-allow-origin": "*" },
      body: JSON.stringify({ error: { code: "fixture_unavailable", message: "Fixture server unavailable" } }) }));
    await auth.page.getByRole("textbox", { name: "Email", exact: true }).fill("alex@example.test");
    await auth.page.getByLabel("Password", { exact: true }).fill("Fixture-password-123");
    await button(auth.page, "Sign in").click();
    const error = auth.page.getByTestId("material-form-error");
    await error.waitFor(); await settle(auth.page);
    check(await error.getByRole("alert").count() === 1, `${label}: animated error retains alert semantics`);
    check(Number(await error.evaluate((node) => getComputedStyle(node).opacity)) > 0.99, `${label}: form error fades in fully`);
    await screen(auth.page, `${label}-form-error`);
    await auth.context.close();
  }
  check(results.errors.length === 0, "no uncaught browser errors", results.errors);
} catch (error) {
  results.issues.push({ name: "menu motion execution", details: error.stack });
} finally {
  await writeFile(`${output}/results.json`, JSON.stringify({ ...results, measurements }, null, 2));
  await browser.close();
}
console.log(JSON.stringify({ checks: results.checks.length, issues: results.issues,
  measurements: measurements.map(({ samples: _samples, ...entry }) => entry) }, null, 2));
if (!process.argv.includes("--baseline")) assert.equal(results.issues.length, 0, `See ${output}/results.json`);
