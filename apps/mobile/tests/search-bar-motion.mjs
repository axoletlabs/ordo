/** Focus handoff regressions against a built Expo web app, using smoke API fixtures.
 * ORDO_UI_URL=http://127.0.0.1:8257 pnpm test:search-ui
 * ORDO_SEARCH_BASELINE=1 records the old defects without asserting the fix.
 */
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
const smokeURL = new URL("./material-ui-smoke.mjs", import.meta.url);
const smoke = await readFile(smokeURL, "utf8");
const definitions = smoke.slice(0, smoke.indexOf("\ntry {\n  if (process.env."))
  .replace(/from "(\.\/[^\"]+)"/g, (_, path) => `from "${new URL(path, smokeURL).href}"`)
  .replace('process.env.PLAYWRIGHT_MODULE ?? "playwright"', JSON.stringify(import.meta.resolve(process.env.PLAYWRIGHT_MODULE ?? "playwright")));
const { browser, fixture, login, button, settle, capture, results, output } = await import(
  "data:text/javascript;base64," + Buffer.from(definitions + "\nexport { browser, fixture, login, button, settle, capture, results, output };").toString("base64"));
const baseline = !!process.env.ORDO_SEARCH_BASELINE;
results.searchMotion = [];

async function sampleFocus(page) {
  await page.getByRole("textbox", { name: "Search your library", exact: true }).evaluate(input => {
    window.searchFrames = [];
    input.addEventListener("focus", () => {
      const start = performance.now();
      const bar = input.closest('[data-testid="material-app-bar"]');
      let layoutStyleUpdates = 0;
      const previous = new WeakMap();
      const layout = node => ["width", "height", "left", "right", "top", "bottom", "paddingRight"].map(key => node.style[key]).join("|");
      for (const node of [bar, ...bar.querySelectorAll("*")]) previous.set(node, layout(node));
      const observer = new MutationObserver(records => {
        for (const { target } of records) {
          const value = layout(target);
          if (previous.has(target) && previous.get(target) !== value) layoutStyleUpdates++;
          previous.set(target, value);
        }
      });
      observer.observe(bar, { subtree: true, attributes: true, attributeFilter: ["style"] });
      const frame = now => {
        const action = label => {
          const node = bar.querySelector(`[aria-label="${label}"]`);
          if (!node) return null;
          const rect = node.getBoundingClientRect();
          let opacity = 1, left = rect.left, right = rect.right;
          for (let parent = node; parent && parent !== bar; parent = parent.parentElement) {
            const css = getComputedStyle(parent);
            opacity *= +css.opacity;
            if (css.overflowX === "hidden") {
              const clip = parent.getBoundingClientRect();
              left = Math.max(left, clip.left); right = Math.min(right, clip.right);
            }
          }
          return { opacity, width: rect.width, clipped: Math.max(0, right - left) < rect.width - 0.5 };
        };
        const rings = [...bar.querySelectorAll("div")].filter(node => {
          const css = getComputedStyle(node), rect = node.getBoundingClientRect();
          return parseFloat(css.borderTopWidth) === 2 && parseFloat(css.borderTopLeftRadius) >= 28 && rect.height >= 55 && +css.opacity > 0.01;
        }).length;
        window.searchFrames.push({ time: now - start, rings, layoutStyleUpdates, back: action("Exit search"), account: action("Account and settings") });
        if (now - start < 650) requestAnimationFrame(frame);
        else observer.disconnect();
      };
      requestAnimationFrame(frame);
    }, { once: true });
  });
}

try {
  for (const theme of ["dark", "light"]) for (const expressive of [false, true]) {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: theme });
    await context.addInitScript(({ theme, expressive }) => localStorage.setItem("ordo.settings", JSON.stringify({ themeMode: theme, expressive, materialYouColors: false })), { theme, expressive });
    const page = await context.newPage();
    await fixture(page, { catalogue: true }); await login(page); await settle(page);
    for (const viewport of [{ name: "portrait", width: 390, height: 844 }, { name: "landscape", width: 1280, height: 800 }]) {
      await page.setViewportSize(viewport); await settle(page);
      const input = page.getByRole("textbox", { name: "Search your library", exact: true });
      if (await input.inputValue()) {
        await input.fill(""); await page.keyboard.press("Escape"); await settle(page);
      }
      const beforeWidth = (await button(page, "Account and settings").boundingBox()).width;
      await sampleFocus(page); await input.focus(); await page.waitForTimeout(750);
      const frames = await page.evaluate(() => window.searchFrames);
      const firstBackOpacity = frames.find(frame => frame.back?.opacity > 0.01)?.back.opacity ?? 0;
      const accountWidthDriftPx = Math.max(0, ...frames.filter(frame => frame.account?.opacity > 0.02).map(frame => Math.abs(frame.account.width - beforeWidth)));
      const maxFocusRings = Math.max(...frames.map(frame => frame.rings));
      const clippedAccountFrames = frames.filter(frame => frame.account?.opacity > 0.02 && frame.account.clipped).length;
      const layoutStyleUpdates = frames.at(-1).layoutStyleUpdates;
      results.searchMotion.push({ theme, expressive, layout: viewport.name, frames: frames.length, maxFocusRings, firstBackOpacity, accountWidthDriftPx, clippedAccountFrames, layoutStyleUpdates });
      if (!baseline) {
        assert.equal(maxFocusRings, 1, "Only the app bar owns the focus outline");
        assert.ok(firstBackOpacity < 0.7, `Back must fade in, not appear instantly (${firstBackOpacity})`);
        assert.ok(accountWidthDriftPx < 0.5, `Departing icons must not be squeezed (${accountWidthDriftPx}px)`);
        assert.equal(clippedAccountFrames, 0, "Departing icons fade intact rather than being clipped");
        assert.equal(layoutStyleUpdates, 0, "The focus handoff must not relayout the field each frame");
        assert.equal(await button(page, "Account and settings").count(), 0, "Idle actions are hidden from accessibility");
        assert.equal(await page.locator('[aria-label="Account and settings"]').evaluate(node => !!node.closest("[inert]")), true);
        await page.keyboard.press("Tab");
        assert.equal(await button(page, "Search filters").evaluate(node => node === document.activeElement), true, "Keyboard focus reaches filters, not hidden actions");
        await input.focus();
        await input.fill("expressive"); await settle(page);
        await button(page, "Clear search").click(); await settle(page);
        assert.equal(await input.inputValue(), "");
        assert.equal(await input.evaluate(node => node === document.activeElement), true);
        // The outer outline remains the sole search-mode indicator when a child action owns focus.
        await button(page, "Search filters").focus(); await settle(page);
        assert.equal(await page.getByTestId("library-search-focus-ring").evaluate(node => +getComputedStyle(node).opacity), 1);
        await button(page, "Search filters").click(); await settle(page);
        await page.getByRole("menuitem", { name: "Folders", exact: true }).click(); await settle(page);
        await page.getByRole("textbox", { name: "Filter folders", exact: true }).focus(); await settle(page);
        assert.equal(await page.getByTestId("material-search-focus-ring").count(), 1, "Standalone search inputs keep their own focus indicator");
        await page.keyboard.press("Escape"); await settle(page);
        await input.focus(); await input.fill("expressive"); await settle(page);
      }
      if (theme === "dark" && expressive) {
        if (baseline) await input.fill("expressive");
        await capture(page, `${baseline ? "before" : "after"}-search-${viewport.name}`);
      }
      await input.focus(); await page.keyboard.press("Escape"); await settle(page);
      if (!baseline) {
        assert.equal(await button(page, "Account and settings").count(), 1);
        assert.equal(await button(page, "Exit search").count(), 0);
        assert.equal(await input.inputValue(), "expressive", "Exiting preserves the query");
        // Reversals must retain the same field and finish in the requested state.
        await input.evaluate(node => { window.originalSearchInput = node; });
        for (let index = 0; index < 4; index++) {
          await input.focus(); await page.waitForTimeout(30); await page.keyboard.press("Escape"); await page.waitForTimeout(30);
        }
        await settle(page);
        assert.equal(await input.evaluate(node => node === window.originalSearchInput), true);
        assert.equal(await button(page, "Account and settings").count(), 1);
        await input.focus(); await page.waitForTimeout(30); await page.emulateMedia({ reducedMotion: "reduce" }); await page.waitForTimeout(100);
        assert.equal(await page.getByTestId("library-search-focus-ring").evaluate(node => +getComputedStyle(node).opacity), 1);
        await page.keyboard.press("Escape"); await page.waitForTimeout(100);
        assert.equal(await page.getByTestId("library-search-focus-ring").evaluate(node => +getComputedStyle(node).opacity), 0);
        await page.emulateMedia({ reducedMotion: "no-preference" });
      }
    }
    await context.close();
  }
  assert.deepEqual(results.errors, []);
  console.log(JSON.stringify({ passed: true, samples: results.searchMotion }, null, 2));
} catch (error) {
  results.failure = error.stack; console.error(error); process.exitCode = 1;
} finally {
  await writeFile(`${output}/search-motion-results.json`, JSON.stringify(results, null, 2));
  await browser.close();
}
