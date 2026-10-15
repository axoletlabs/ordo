/** Built-web regressions for progressive reader mounting (not native FPS).
 * Uses the smoke suite's fixture helpers; run with the same PLAYWRIGHT_* / ORDO_UI_* variables.
 */
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
const smokeURL = new URL("./material-ui-smoke.mjs", import.meta.url);
const smoke = await readFile(smokeURL, "utf8");
const definitions = smoke.slice(0, smoke.indexOf("\ntry {\n  if (process.env."))
  .replace(/from "(\.\/[^\"]+)"/g, (_, path) => `from "${new URL(path, smokeURL).href}"`)
  .replace('process.env.PLAYWRIGHT_MODULE ?? "playwright"', JSON.stringify(import.meta.resolve(process.env.PLAYWRIGHT_MODULE ?? "playwright")));
const { browser, fixture, login, navigate, button, settle, bookmark, results, output } = await import(
  "data:text/javascript;base64," + Buffer.from(definitions + "\nexport { browser, fixture, login, navigate, button, settle, bookmark, results, output };").toString("base64"));
const html = '<p>Highlighted opening.</p>' + Array.from({ length: 1200 }, (_, index) =>
  `${index % 20 === 0 ? `<h2>Chapter ${index / 20}</h2>` : ""}<p>Paragraph ${index}: ${"Reading stays comfortable in a long article. ".repeat(7)}</p>`).join("");
// Locate only the article's actual scroll host, never an overlay's scroll host.
const scrollState = () => {
  const leaf = [...document.querySelectorAll("div,span")].find(node => node.textContent.startsWith("Paragraph 0:") && !node.children.length);
  for (let node = leaf; node; node = node.parentElement) if (getComputedStyle(node).overflowY === "auto") {
    return { y: node.scrollTop, height: node.scrollHeight, viewport: node.clientHeight };
  }
  return null;
};
const sampleHeader = () => {
  const button = document.querySelector('[aria-label="Reader settings"]');
  if (!button) return null;
  return button.getBoundingClientRect().bottom;
};
try {
  for (const theme of ["light", "dark"]) for (const expressive of [false, true]) {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: theme });
    await context.addInitScript(({ theme, expressive }) => localStorage.setItem("ordo.settings", JSON.stringify({ themeMode: theme, expressive, materialYouColors: false })), { theme, expressive });
    const page = await context.newPage();
    await fixture(page);
    let removed = false, baseline = 0;
    await page.route(/\/api\/bookmarks(?:\?.*)?$/, route => route.fulfill({
      contentType: "application/json", headers: { "access-control-allow-origin": "*" },
      body: JSON.stringify({ items: [{ ...bookmark, readProgress: baseline }], nextCursor: null, hasMore: false }),
    }));
    await page.route("**/api/bookmarks/article{,/**}", async route => {
      if (route.request().url().includes("/highlights") && route.request().method() === "DELETE") {
        removed = true;
        return route.fulfill({ contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify({ success: true }) });
      }
      const body = { ...bookmark, readProgress: baseline, contentHtml: html, highlights: removed ? [] : [
        { id: "saved-highlight", exact: "Highlighted opening", prefix: "", suffix: ".", href: null, createdAt: bookmark.createdAt },
      ] };
      return route.fulfill({ contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify(body) });
    });
    await login(page);
    const cdp = await context.newCDPSession(page);
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
    await navigate(page, "reader/article");
    await button(page, "Table of contents").click();
    assert.equal(await page.evaluate(() => document.body.textContent.includes("Paragraph 1199:")), false, "Exercise a TOC target that has not mounted yet");
    const lastHeading = button(page, "Go to Chapter 59");
    await lastHeading.focus(); await page.keyboard.press("Enter");
    await page.waitForFunction(() => document.body.textContent.includes("Paragraph 1199:"), null, { polling: 100, timeout: 30000 });
    await page.waitForFunction(() => {
      const leaf = [...document.querySelectorAll("div,span")].find(node => node.textContent.startsWith("Paragraph 0:") && !node.children.length);
      for (let node = leaf; node; node = node.parentElement) if (getComputedStyle(node).overflowY === "auto") {
        return node.scrollTop > node.scrollHeight * 0.9;
      }
      return false;
    }, null, { polling: 100, timeout: 10000 });
    const jumped = await page.evaluate(scrollState);
    assert.ok(jumped.y > jumped.height * 0.8, `Pending TOC jump failed: ${JSON.stringify(jumped)}`);
    // Keep a mid-article DOM node and position through an unrelated highlight edit.
    await page.evaluate(() => {
      const leaf = [...document.querySelectorAll("div,span")].find(node => node.textContent.startsWith("Paragraph 400:") && !node.children.length);
      window.keptReaderNode = leaf;
      leaf.scrollIntoView({ block: "center" });
    });
    await settle(page);
    await page.mouse.move(200, 400); await page.mouse.wheel(0, -160); await settle(page);
    const before = await page.evaluate(scrollState);
    await button(page, "More article actions").click();
    await page.getByRole("menuitem", { name: "Highlights", exact: true }).click();
    await button(page, "Remove highlight").click();
    await page.getByText("Select a passage in the article to save it.", { exact: true }).waitFor();
    await page.keyboard.press("Escape"); await settle(page);
    assert.equal(await page.evaluate(() => window.keptReaderNode.isConnected), true, "Unchanged sections must not remount on a highlight edit");
    assert.ok(Math.abs((await page.evaluate(scrollState)).y - before.y) < 2, "Highlight edits must not jump the reader");
    // Chrome responds in both layouts and with live reduced-motion changes.
    for (const viewport of [{ width: 390, height: 844 }, { width: 1280, height: 800 }]) for (const reduced of [false, true]) {
      await page.setViewportSize(viewport);
      await page.emulateMedia({ reducedMotion: reduced ? "reduce" : "no-preference" });
      await settle(page);
      const position = await page.evaluate(scrollState);
      const announced = Number(await page.getByRole("progressbar", { name: "Reading progress" }).getAttribute("aria-valuenow"));
      const expected = 100 * position.y / (position.height - position.viewport);
      assert.ok(expected > 10 && Math.abs(announced - expected) < 2,
        `Changing layout/motion must not reset reading progress: ${announced}, expected ${expected}`);
      await page.mouse.move(viewport.width / 2, viewport.height / 2);
      await page.mouse.wheel(0, 350); await settle(page);
      assert.ok((await page.evaluate(sampleHeader)) <= 2, "Downward scrolling hides reader chrome");
      await page.mouse.wheel(0, -180); await settle(page);
      assert.ok((await page.evaluate(sampleHeader)) > 30, "Upward scrolling reveals reader chrome");
    }
    // Cancel scheduled work by leaving while a fresh reader is still mounting.
    await navigate(page, "");
    await page.reload(); await button(page, "Account and settings").waitFor();
    await navigate(page, "reader/article");
    await button(page, "Table of contents").waitFor();
    await button(page, "Back").click();
    await page.getByRole("button", { name: /^Building a more expressive design system,/ }).waitFor();
    await page.waitForTimeout(500);
    assert.equal(await button(page, "Reader settings").count(), 0);
    // Reopen with a non-zero server baseline and wait for the FINAL height.
    baseline = 0.4;
    const refreshedList = page.waitForResponse(response => new URL(response.url()).pathname === "/api/bookmarks" && response.request().method() === "GET");
    await page.reload(); await button(page, "Account and settings").waitFor();
    await refreshedList; await settle(page);
    await navigate(page, "reader/article");
    await page.waitForFunction(() => document.body.textContent.includes("Paragraph 1199:"), null, { polling: 100, timeout: 30000 });
    await page.waitForTimeout(700);
    const restored = await page.evaluate(scrollState);
    const fraction = restored.y / (restored.height - restored.viewport);
    assert.ok(Math.abs(fraction - baseline) < 0.02, `Saved position restored against an incomplete article: ${fraction}`);
    results.interactions.push(`${theme}/${expressive}: early keyboard TOC, stable highlight edit, chrome in both layouts/reduced motion, cancellation, saved position`);
    await context.close();
  }
  assert.deepEqual(results.errors, []);
  console.log(JSON.stringify({ passed: true, interactions: results.interactions }, null, 2));
} catch (error) {
  results.failure = error.stack?.replace(/data:text\/javascript;base64,[A-Za-z0-9+/=]+/g, "smoke-fixture-helpers");
  console.error(results.failure); process.exitCode = 1;
} finally {
  await writeFile(`${output}/reader-sections-results.json`, JSON.stringify(results, null, 2));
  await browser.close();
}
