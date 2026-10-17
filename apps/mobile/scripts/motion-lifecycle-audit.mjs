/** Synthetic production-web checks for focus ownership, bounded retained DOM,
 * and native browser scrolling. Heap figures are diagnostic, not native RAM. */
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
process.env.ORDO_AUDIT_LIBRARY = "1";
const { browser, context, button, check, results, base, output } = await import("./ui-audit.mjs");
const measurements = [];
try {
  for (const options of [
    { theme: "light", expressive: false }, { theme: "light", expressive: true },
    { theme: "dark", expressive: false }, { theme: "dark", expressive: true },
    { theme: "dark", expressive: true, width: 1280, height: 800 },
    { theme: "light", expressive: false, width: 844, height: 390, reducedMotion: "reduce" },
  ]) {
    const label = JSON.stringify(options);
    const { page, context: ctx } = await context({ ...options, count: 1000 });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(base);
    await button(page, "Save bookmark").first().waitFor();
    await page.locator('[data-testid="launch-splash"]').waitFor({ state: "hidden" });
    await page.evaluate(() => {
      window.auditFocus = [];
      const focus = HTMLElement.prototype.focus;
      HTMLElement.prototype.focus = function (...args) {
        window.auditFocus.push({ label: this.getAttribute("aria-label"), time: performance.now() });
        return focus.apply(this, args);
      };
    });
    const cycle = async (index) => {
      await page.evaluate(() => { window.auditFocus = []; });
      await button(page, "Save bookmark").first().click();
      const dialog = page.getByRole("dialog");
      await dialog.waitFor();
      const field = dialog.getByRole("textbox", { name: "Link", exact: true });
      await field.waitFor();
      await field.evaluate((node) => new Promise((resolve) => {
        if (node === document.activeElement) return resolve();
        node.addEventListener("focus", resolve, { once: true });
      }));
      const calls = await page.evaluate(() => window.auditFocus.filter((entry) => entry.label === "Link").length);
      check(calls === 1, `${label}: open ${index} focuses the field once`, { calls });
      await field.fill(`https://example.test/draft-${index}`);
      // Closing a sibling dropdown should restore its trigger without the old
      // 600ms deadline/frame loop, and leave the parent's draft untouched.
      if (index === 0) {
        const tags = dialog.getByRole("button", { name: /Tags/ });
        await tags.click();
        await page.getByRole("menu").waitFor();
        await page.keyboard.press("Escape");
        await page.waitForFunction(() => document.activeElement?.getAttribute("aria-label")?.startsWith("Tags"), undefined, { timeout: 1000 });
        check(await field.inputValue() === `https://example.test/draft-${index}`, `${label}: dropdown retains draft`);
      }
      await page.keyboard.press("Escape");
      await dialog.waitFor({ state: "hidden" });
      await button(page, "Save bookmark").first().evaluate((node) => new Promise((resolve) => {
        if (node === document.activeElement) return resolve();
        node.addEventListener("focus", resolve, { once: true });
      }));
    };
    const cdp = await ctx.newCDPSession(page);
    await cdp.send("Performance.enable");
    const memory = async () => {
      await page.waitForTimeout(350);
      await cdp.send("HeapProfiler.collectGarbage");
      const { metrics } = await cdp.send("Performance.getMetrics");
      return Object.fromEntries(metrics.filter(({ name }) => ["JSHeapUsedSize", "Nodes", "JSEventListeners"].includes(name)).map(({ name, value }) => [name, value]));
    };
    for (let i = 0; i < 3; i++) await cycle(i);
    const before = await memory();
    for (let i = 3; i < 15; i++) await cycle(i);
    const after = await memory();
    check(after.Nodes <= before.Nodes + 20, `${label}: repeated dialogs have bounded DOM`, { before, after });
    check(after.JSEventListeners <= before.JSEventListeners + 5, `${label}: repeated dialogs have bounded listeners`, { before, after });
    // Scroll a large fixture with real wheel input; virtualization must remain
    // bounded and a still-mounted row must not steal keyboard ownership.
    await page.mouse.move((options.width ?? 390) / 2, (options.height ?? 844) / 2);
    await page.mouse.wheel(0, 3200);
    await page.waitForTimeout(600);
    const mountedRows = await page.locator('[aria-label^="Saved reading"]').count();
    check(mountedRows < 100, `${label}: large-library scrolling stays virtualized`, { mountedRows });
    check(errors.length === 0, `${label}: no uncaught errors`, errors);
    measurements.push({ options, cycles: 15, before, after, mountedRows });
    await cdp.detach(); await ctx.close();
  }
} catch (error) {
  results.issues.push({ name: "lifecycle execution", details: error.stack });
} finally {
  await writeFile(`${output}/results.json`, JSON.stringify({ ...results, measurements }, null, 2));
  await browser.close();
}
console.log(JSON.stringify({ checks: results.checks.length, issues: results.issues, measurements }, null, 2));
assert.equal(results.issues.length, 0, `See ${output}/results.json`);
