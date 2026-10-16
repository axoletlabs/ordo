/** Built-web temporal check for optimistic bookmark height changes.
 * Uses the smoke suite's isolated API fixtures; no production data is touched.
 * Run with the same ORDO_UI_URL / PLAYWRIGHT_* variables as animation-polish.mjs.
 */
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";

const smokeURL = new URL("./material-ui-smoke.mjs", import.meta.url);
const smoke = await readFile(smokeURL, "utf8");
const definitions = smoke.slice(0, smoke.indexOf("\ntry {\n  if (process.env."))
  .replace(/from "(\.\/[^\"]+)"/g, (_, path) => `from "${new URL(path, smokeURL).href}"`)
  .replace('process.env.PLAYWRIGHT_MODULE ?? "playwright"', JSON.stringify(import.meta.resolve(process.env.PLAYWRIGHT_MODULE ?? "playwright")));
const { browser, fixture, login, navigate, settle, results, bookmark, output } = await import(
  "data:text/javascript;base64," + Buffer.from(definitions + "\nexport { browser, fixture, login, navigate, settle, results, bookmark, output };").toString("base64"));
const samples = [];
let activePage;

try {
  for (const theme of process.env.ORDO_UI_THEME ? [process.env.ORDO_UI_THEME] : ["light", "dark"])
    for (const expressive of process.env.ORDO_UI_EXPRESSIVE ? [process.env.ORDO_UI_EXPRESSIVE === "true"] : [false, true]) {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: theme });
    await context.addInitScript(({ theme, expressive }) => localStorage.setItem("ordo.settings", JSON.stringify({
      themeMode: theme, expressive, materialYouColors: false,
    })), { theme, expressive });
    const page = await context.newPage();
    activePage = page;
    await fixture(page);
    let current = { ...bookmark, tags: [], suggestedTags: [], remindAt: null };
    let release;
    let gate;
    const headers = { "access-control-allow-origin": "*" };
    await page.route("**/api/**", async route => {
      const request = route.request(), path = new URL(request.url()).pathname;
      if (request.method() === "PATCH" && path === "/api/bookmarks/article") {
        current = { ...current, ...request.postDataJSON() };
        await gate;
        return route.fulfill({ json: current, headers });
      }
      if (request.method() === "GET" && ["/api/bookmarks", "/api/folders/collection/bookmarks", "/api/tags/design/bookmarks"].includes(path)) {
        return route.fulfill({ json: { items: [current], nextCursor: null, hasMore: false }, headers });
      }
      return route.fallback();
    });
    await login(page); await settle(page);
    for (const route of ["", "folder/collection", "tags/design"]) {
      await navigate(page, route); await settle(page);
      for (const viewport of [{ width: 390, height: 844 }, { width: 1280, height: 800 }]) {
        await page.setViewportSize(viewport); await settle(page);
        for (const reduced of [false, true]) {
          await page.emulateMedia({ reducedMotion: reduced ? "reduce" : "no-preference" });
          for (const growing of [true, false]) {
            const row = page.getByRole("button", { name: /^Building a more expressive design system,/ });
            // Keyboard menu opening also checks focus survives the row update.
            await row.focus(); await page.keyboard.press("Shift+F10"); await settle(page);
            await page.getByRole("menuitem", { name: growing ? "Remind" : "Edit reminder", exact: true }).click();
            await settle(page);
            await page.mouse.move(0, 0);
            gate = new Promise(resolve => { release = resolve; });
            await row.evaluate(node => {
              const wrapper = node.parentElement;
              const selection = wrapper.querySelector('[data-testid="material-row-selection"]');
              window.rowResizeFrames = [];
              window.rowResizeSampling = true;
              const sample = () => {
                if (!window.rowResizeSampling) return;
                const style = getComputedStyle(selection);
                window.rowResizeFrames.push({ height: wrapper.getBoundingClientRect().height,
                  opacity: +style.opacity, corner: parseFloat(style.borderBottomLeftRadius),
                  connected: selection.isConnected });
                requestAnimationFrame(sample);
              };
              requestAnimationFrame(sample);
            });
            await page.getByRole("menuitem", { name: growing ? /^Next week,/ : "Clear reminder" }).click();
            try {
              await page.waitForTimeout(350);
              const frames = await page.evaluate(() => { window.rowResizeSampling = false; return window.rowResizeFrames; });
              assert.ok(frames.length > 2, "Resize must be sampled across frames");
              assert.ok(frames.some(frame => frame.height === (growing ? 96 : 72)), "Optimistic update must resize the row before the request finishes");
              assert.ok(frames.every(frame => frame.connected && frame.opacity > 0.999), "Held selection must not flash or remount during resize");
              if (expressive) assert.ok(frames.every(frame => frame.corner >= 19.5), "Held corners must not reset during resize");
              samples.push({ theme, expressive, route, width: viewport.width, reduced, growing, frames: frames.length });
            } finally {
              release();
            }
            await page.getByRole("menu", { includeHidden: false }).waitFor({ state: "hidden" });
            await settle(page);
          }
        }
      }
    }
    await page.screenshot({ path: `${output}/row-resize-${theme}-${expressive ? "expressive" : "standard"}.png` });
    await context.close();
  }
  assert.deepEqual(results.errors, []);
  console.log(JSON.stringify({ passed: true, cases: samples.length }, null, 2));
} catch (error) {
  await activePage?.screenshot({ path: `${output}/row-resize-failure.png` });
  console.error(error); process.exitCode = 1;
} finally {
  await writeFile(`${output}/row-resize-results.json`, JSON.stringify({ samples, errors: results.errors }, null, 2));
  await browser.close();
}
