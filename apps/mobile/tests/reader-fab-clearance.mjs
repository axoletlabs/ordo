/** Built-web reader regression; API responses reuse the smoke suite's fixtures.
 * ORDO_UI_URL=http://127.0.0.1:8235 node tests/reader-fab-clearance.mjs
 * ORDO_UI_CLEARANCE_BASELINE=1 records the old overlap without asserting clearance.
 */
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";

const smokeURL = new URL("./material-ui-smoke.mjs", import.meta.url);
const smoke = await readFile(smokeURL, "utf8");
const definitions = smoke.slice(0, smoke.indexOf("\ntry {\n  if (process.env."))
  .replace(/from "(\.\/[^\"]+)"/g, (_, path) => `from "${new URL(path, smokeURL).href}"`)
  .replace('process.env.PLAYWRIGHT_MODULE ?? "playwright"', JSON.stringify(import.meta.resolve(process.env.PLAYWRIGHT_MODULE ?? "playwright")));
const { browser, fixture, login, navigate, button, settle, capture, results, output, bookmark } = await import(
  "data:text/javascript;base64," + Buffer.from(definitions + "\nexport { browser, fixture, login, navigate, button, settle, capture, results, output, bookmark };").toString("base64"));
const baseline = !!process.env.ORDO_UI_CLEARANCE_BASELINE;
results.clearance = [];

// Find the actual RN ScrollView rather than relying on generated CSS classes.
function readerScroll(node, command) {
  let scroll = node.parentElement;
  while (scroll && !["auto", "scroll"].includes(getComputedStyle(scroll).overflowY)) scroll = scroll.parentElement;
  if (!scroll) throw new Error("Reader ScrollView not found");
  if (command === "bottom") scroll.scrollTop = scroll.scrollHeight;
  return { offset: scroll.scrollTop, height: scroll.scrollHeight, viewport: scroll.clientHeight,
    padding: parseFloat(getComputedStyle(scroll.firstElementChild).paddingBottom) };
}

try {
  for (const theme of process.env.ORDO_UI_THEME ? [process.env.ORDO_UI_THEME] : ["dark", "light"]) {
    for (const expressive of [false, true]) {
      const context = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: theme });
      await context.addInitScript(({ theme, expressive }) => localStorage.setItem("ordo.settings",
        JSON.stringify({ themeMode: theme, expressive, materialYouColors: false })), { theme, expressive });
      const page = await context.newPage();
      await fixture(page, { richReader: true, readerPreferences: { theme } });
      await page.route("**/api/bookmarks/article", async route => {
        if (route.request().method() !== "PATCH") return route.fallback();
        return route.fulfill({ contentType: "application/json", body: JSON.stringify({ ...bookmark, ...route.request().postDataJSON() }) });
      });
      await login(page);
      await navigate(page, "reader/article");
      const ending = page.getByText(/^A library grows one thoughtful read at a time\./);
      await ending.waitFor();
      for (const viewport of [{ name: "portrait", width: 390, height: 844 }, { name: "landscape", width: 1280, height: 800 }]) {
        await page.setViewportSize(viewport);
        for (const reducedMotion of ["no-preference", "reduce"]) {
          await page.emulateMedia({ reducedMotion });
          await ending.evaluate(readerScroll, "bottom");
          await settle(page);
          const scroll = await ending.evaluate(readerScroll);
          const fab = button(page, "Table of contents");
          const fabBox = await fab.boundingBox();
          const lastParagraph = await ending.boundingBox();
          const gap = fabBox.y - lastParagraph.y - lastParagraph.height;
          const name = `${theme}-${expressive ? "expressive" : "standard"}-${viewport.name}-${reducedMotion}`;
          results.clearance.push({ name, ...scroll, gap });
          if (!baseline) assert.ok(gap >= 15.5, `${name}: final text must clear Contents by 16dp (${gap})`);
          assert.equal(await page.getByRole("progressbar", { name: "Reading progress" }).getAttribute("aria-valuenow"), "100");
          // Hiding the FAB for the contents panel must not shrink the scroll range.
          await fab.focus();
          await page.keyboard.press("Enter");
          await page.getByRole("dialog").waitFor();
          await settle(page);
          const open = await ending.evaluate(readerScroll);
          assert.equal(open.height, scroll.height, `${name}: opening Contents changed content height`);
          assert.equal(open.offset, scroll.offset, `${name}: opening Contents changed scroll position`);
          await page.keyboard.press("Escape");
          await settle(page);
          assert.deepEqual(await ending.evaluate(readerScroll), scroll, `${name}: dismissing Contents shifted the article`);
          if (theme === "dark" && expressive && reducedMotion === "no-preference") await capture(page, `reader-bottom-${viewport.name}`);
        }
      }
      await context.close();

      const plainContext = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: theme });
      await plainContext.addInitScript(({ theme, expressive }) => localStorage.setItem("ordo.settings",
        JSON.stringify({ themeMode: theme, expressive, materialYouColors: false })), { theme, expressive });
      const plainPage = await plainContext.newPage();
      await fixture(plainPage, { readerPreferences: { theme } });
      await login(plainPage);
      await navigate(plainPage, "reader/article");
      const plainText = plainPage.getByText("Saved ideas make a useful library.", { exact: true });
      await plainText.waitFor();
      await settle(plainPage);
      assert.equal(await button(plainPage, "Table of contents").count(), 0);
      assert.equal((await plainText.evaluate(readerScroll)).padding, 16, "Articles without Contents retain normal bottom padding");
      await plainContext.close();
    }
  }
  assert.deepEqual(results.errors, []);
  console.log(JSON.stringify({ cases: results.clearance.length, clearance: results.clearance }, null, 2));
} finally {
  await writeFile(`${output}/results.json`, JSON.stringify(results, null, 2));
  await browser.close();
}
