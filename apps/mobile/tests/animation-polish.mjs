/** Built-web temporal regressions. Reuses the smoke suite's API fixtures, not production data.
 * PLAYWRIGHT_MODULE=/absolute/playwright/index.mjs PLAYWRIGHT_CHROMIUM=/path/to/chromium
 * ORDO_UI_URL=http://127.0.0.1:8252 node tests/animation-polish.mjs
 * ORDO_MOTION_BASELINE=1 records defects without asserting the corrected behavior.
 */
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
const smokeURL = new URL("./material-ui-smoke.mjs", import.meta.url);
const smoke = await readFile(smokeURL, "utf8");
// Only load definitions; the smoke suite's runner remains independently runnable.
const definitions = smoke.slice(0, smoke.indexOf("\ntry {\n  if (process.env."))
  .replace(/from "(\.\/[^\"]+)"/g, (_, path) => `from "${new URL(path, smokeURL).href}"`)
  .replace('process.env.PLAYWRIGHT_MODULE ?? "playwright"', JSON.stringify(import.meta.resolve(process.env.PLAYWRIGHT_MODULE ?? "playwright")));
const { browser, fixture, login, navigate, button, settle, capture, results, bookmark, output } = await import(
  "data:text/javascript;base64," + Buffer.from(definitions + "\nexport { browser, fixture, login, navigate, button, settle, capture, results, bookmark, output };").toString("base64"));
const baseline = !!process.env.ORDO_MOTION_BASELINE;
results.motion = [];
async function sampleMenu(page, duration = 450) {
  await page.evaluate(duration => {
    window.menuFrames = [];
    const start = performance.now();
    const frame = now => {
      const node = document.querySelector('[role="menu"][data-material-overlay="true"]');
      if (node) {
        const rect = node.getBoundingClientRect();
        window.menuFrames.push({ time: now - start, opacity: +getComputedStyle(node).opacity, x: rect.x, y: rect.y });
      }
      if (now - start < duration) requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }, duration);
}
try {
  for (const theme of ["dark", "light"]) for (const expressive of [false, true]) {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: theme });
    await context.addInitScript(({ theme, expressive }) => {
      localStorage.setItem("ordo.settings", JSON.stringify({ themeMode: theme, expressive, materialYouColors: false }));
      // Simulate a busy device delivering the menu's first layout late. Entrance
      // must still start from zero AFTER placement is measured, not while hidden.
      const NativeObserver = window.ResizeObserver;
      window.ResizeObserver = class extends NativeObserver {
        constructor(callback) {
          const seen = new WeakSet();
          super((entries, observer) => {
            if (entries.some(entry => entry.target.closest('[role="menu"]') && !seen.has(entry.target))) {
              entries.forEach(entry => seen.add(entry.target));
              setTimeout(() => callback(entries, observer), 240);
            } else callback(entries, observer);
          });
        }
      };
    }, { theme, expressive });
    const page = await context.newPage();
    await fixture(page, { bookmarkCount: 8 }); await login(page); await settle(page);
    const mode = `${theme}-${expressive ? "expressive" : "standard"}`;
    for (const viewport of [{ name: "portrait", width: 390, height: 844 }, { name: "landscape", width: 1280, height: 800 }]) {
      await page.setViewportSize(viewport); await settle(page);
      for (const label of [/^Building a more expressive design system,/, /^Design & inspiration,/]) {
        const row = page.getByRole("button", { name: label });
        await row.hover(); await page.mouse.down(); await page.waitForTimeout(400);
        await sampleMenu(page, 900); await page.waitForTimeout(550); await page.mouse.up(); await page.waitForTimeout(450);
        const frames = await page.evaluate(() => window.menuFrames);
        const painted = frames.filter(frame => frame.opacity > 0.01);
        const blinks = painted.slice(1).filter((frame, index) => frame.opacity < painted[index].opacity - 0.05).length;
        const firstOpacity = painted[0]?.opacity ?? 0;
        results.motion.push({ mode, layout: viewport.name, row: String(label), firstOpacity, blinks, frames: frames.length });
        if (!baseline) {
          assert.ok(painted.length > 2, "Menu entrance must be sampled");
          assert.ok(firstOpacity < 0.4, `${mode}: late layout skipped the entrance (${firstOpacity})`);
          assert.equal(blinks, 0, `${mode}: menu blinked during entrance`);
        }
        if (expressive) {
          await page.mouse.move(0, 0); await settle(page);
          const heldCorner = await row.evaluate(node => parseFloat(getComputedStyle(node.parentElement.querySelector('[data-testid="material-row-surface"]')).borderBottomLeftRadius));
          results.motion.at(-1).heldCorner = heldCorner;
          if (!baseline) assert.ok(heldCorner >= 19.5, "Bookmark/folder menu ownership must hold the pressed shape after pointer leave");
        }
        await page.keyboard.press("Escape"); await settle(page);
      }
      // Reopen during exit, then change pages and dismiss mid-handoff.
      const article = page.getByRole("button", { name: /^Building a more expressive design system,/ });
      await article.click({ button: "right" }); await settle(page);
      await page.keyboard.press("Escape"); await page.waitForTimeout(40);
      await article.click({ button: "right" }); await settle(page);
      await page.getByRole("menuitem", { name: "Remind", exact: true }).click();
      await page.waitForTimeout(30); await page.keyboard.press("Escape"); await settle(page);
      await article.click({ button: "right" }); await settle(page);
      assert.equal(await page.getByRole("menuitem", { name: "Mark as read", exact: true }).count(), 1);
      if (!baseline) await page.waitForFunction(() => {
        const node = [...document.querySelectorAll('[role="menuitem"]')].find(node => node.getAttribute("aria-label") === "Mark as read");
        if (!node) return false;
        let opacity = 1;
        for (let parent = node; parent; parent = parent.parentElement) opacity *= +getComputedStyle(parent).opacity;
        return opacity > 0.999;
      }, null, { timeout: 3000 });
      const reopenedOpacity = await page.getByRole("menuitem", { name: "Mark as read", exact: true }).evaluate(node => {
        let opacity = 1;
        for (let parent = node; parent; parent = parent.parentElement) opacity *= +getComputedStyle(parent).opacity;
        return opacity;
      });
      if (!baseline && reopenedOpacity <= 0.99) {
        await page.screenshot({ path: `${output}/reopen-failure.png` });
        console.error(await page.getByRole("menuitem", { name: "Mark as read", exact: true }).evaluate(node => {
          const chain = []; for (let parent = node; parent; parent = parent.parentElement) chain.push({ role: parent.getAttribute("role"), opacity: getComputedStyle(parent).opacity }); return chain;
        }));
      }
      if (!baseline) assert.ok(reopenedOpacity > 0.99, `Reopening mid-page-handoff must restore fully painted contents (${reopenedOpacity})`);
      await page.keyboard.press("Escape"); await settle(page);
    }
    const lead = button(page, `Select ${bookmark.title}`);
    await lead.scrollIntoViewIfNeeded(); const box = await lead.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down(); await page.waitForTimeout(550); await page.mouse.up();
    await page.mouse.move(0, 0); await settle(page);
    const selected = page.getByRole("checkbox", { name: /^Building a more expressive design system,/ });
    assert.equal(await selected.getAttribute("aria-checked"), "true");
    if (expressive) {
      const shape = await selected.evaluate(node => +parseFloat(getComputedStyle(node.parentElement.querySelector('[data-testid="material-row-surface"]')).borderBottomLeftRadius));
      results.motion.push({ mode, selectedCorner: shape });
      if (!baseline) assert.ok(shape >= 19.5, `Selected row relaxed to ${shape}px after release`);
    }
    for (const viewport of [{ name: "portrait", width: 390, height: 844 }, { name: "landscape", width: 1280, height: 800 }]) {
      await page.setViewportSize(viewport); await capture(page, `${mode}-selected-${viewport.name}`);
    }
    await page.emulateMedia({ reducedMotion: "reduce" });
    await selected.focus(); await page.keyboard.press("Space"); await settle(page);
    assert.equal(await selected.getAttribute("aria-checked"), "false");
    await page.keyboard.press("Space"); await settle(page);
    assert.equal(await selected.getAttribute("aria-checked"), "true");
    if (expressive && !baseline) assert.ok(await page.getByTestId("material-row-surface").nth(1).evaluate(node => parseFloat(getComputedStyle(node).borderBottomLeftRadius)) >= 19.5);
    await button(page, "Cancel selection").click(); await settle(page);
    await page.emulateMedia({ reducedMotion: "no-preference" });
    // Loading feedback must not compress the action or move its neighbours.
    let releaseSave;
    const saveGate = new Promise(resolve => { releaseSave = resolve; });
    await page.route("**/api/bookmarks", async route => {
      if (route.request().method() === "POST") await saveGate;
      await route.fallback();
    });
    await page.getByTestId("add-bookmark-fab").click();
    await page.getByRole("textbox", { name: "Link", exact: true }).fill("https://example.test/new-bookmark");
    const save = button(page, "Save"); await settle(page);
    const beforeSave = await save.boundingBox();
    await save.click(); await page.waitForTimeout(100);
    const busySave = await save.boundingBox();
    const loadingWidthDrift = Math.abs(beforeSave.width - busySave.width);
    results.motion.push({ mode, loadingWidthDrift });
    if (!baseline) assert.ok(loadingWidthDrift < 0.5, `${mode}: loading resized the Save button by ${loadingWidthDrift}px`);
    releaseSave(); await settle(page);
    await navigate(page, "settings/appearance");
    await page.evaluate(() => {
      window.pageEntranceCount = 0;
      const animate = Element.prototype.animate;
      Element.prototype.animate = function(keyframes, options) {
        if (Array.isArray(keyframes) && keyframes[0]?.opacity === 0.6) window.pageEntranceCount++;
        return animate.call(this, keyframes, options);
      };
    });
    await page.getByRole("button", { name: /^Page transitions,/ }).click();
    await page.getByRole("menuitemradio", { name: "Fade", exact: true }).click(); await settle(page);
    const replays = await page.evaluate(() => window.pageEntranceCount);
    results.motion.push({ mode, preferenceChangeEntranceReplays: replays });
    if (!baseline) assert.equal(replays, 0, "Changing a transition must not replay the current page's entrance");
    const contrast = page.getByRole("radiogroup", { name: "Color contrast", exact: true });
    await contrast.getByRole("radio", { name: "Medium", exact: true }).click(); await settle(page);
    if (!baseline) {
      const oldCheck = contrast.getByRole("radio", { name: "Standard", exact: true }).getByTestId("material-segment-check");
      assert.equal(await oldCheck.count(), 1, "Deselecting retains the check for its fade-out");
      assert.ok(await oldCheck.evaluate(node => node.getBoundingClientRect().width) < 0.1);
    }
    await contrast.getByRole("radio", { name: "Medium", exact: true }).evaluate(node => { window.contrastNode = node; });
    await page.getByRole("switch", { name: "Expressive", exact: true }).click(); await settle(page);
    const modeSwitchRemountedControl = await page.evaluate(() => !window.contrastNode.isConnected);
    results.motion.push({ mode, modeSwitchRemountedControl });
    if (!baseline) assert.equal(modeSwitchRemountedControl, false, "Changing design mode must not remount shape-aware controls");
    results.interactions.push(`${mode}: long press, late measurement, reopen during exit, interrupted nested page, persistent selection, keyboard, live reduced motion`);
    await context.close();
  }
  assert.deepEqual(results.errors, []);
  console.log(JSON.stringify({ passed: true, motion: results.motion, interactions: results.interactions.length }, null, 2));
} catch (error) {
  results.failure = error.stack; console.error(error); process.exitCode = 1;
} finally {
  await writeFile(`${output}/animation-results.json`, JSON.stringify(results, null, 2));
  await browser.close();
}
