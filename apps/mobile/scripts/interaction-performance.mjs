/** Fixture-backed release-web interaction checks (not native frame-rate tests).
 * Export Expo web, serve with SPA fallback, then run:
 * PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs ORDO_UI_URL=http://localhost:8255 \
 *   node apps/mobile/scripts/interaction-performance.mjs
 * ORDO_UI_MATRIX=1 covers both layouts, color schemes and design modes.
 * ORDO_UI_REPEATS=3 repeats each configuration; CPU throttle defaults to 4x.
 */
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? "playwright");
const base = process.env.ORDO_UI_URL ?? "http://127.0.0.1:8255";
const output = process.env.ORDO_UI_OUTPUT ?? "/tmp/opencode/ordo-interaction-checks";
const repeats = Number(process.env.ORDO_UI_REPEATS ?? 1);
const count = Number(process.env.ORDO_UI_BOOKMARKS ?? 1000);
const stamp = "2026-10-20T12:00:00Z";
const tag = { id: "design", name: "Design", color: "blue", bookmarkCount: count, createdAt: stamp, updatedAt: stamp };
const article = { id: "article", folderId: null, title: "Performance audit article", url: "https://example.test/article",
  domain: "example.test", description: "A saved article for interaction checks.", fetchStatus: "ok", contentKind: "article",
  contentKindOverride: null, extractionVersion: 1, author: null, publishedAt: null, readingTimeMinutes: 4,
  readProgress: 0, isRead: false, remindAt: null, tags: [tag], suggestedTags: [], createdAt: stamp, updatedAt: stamp };
const user = { id: "performance-fixture", displayName: "Fixture reader", email: "reader@example.test", emailVerified: true,
  hasAvatar: false, mfaEnabled: false, libraryEncrypted: false, canRenameInstance: false, createdAt: stamp,
  preferences: { fontFamily: "sans", fontSize: "medium", lineSpacing: "default", theme: "system", amoled: false } };
const contentHtml = Array.from({ length: 100 }, (_, i) => `<h2>Section ${i + 1}</h2><p>${"An article should remain responsive while opening its controls. ".repeat(12)}</p>`).join("");
const button = (page, name) => page.getByRole("button", { name, exact: true });
const results = { fixtureBookmarks: count, cpuThrottle: Number(process.env.ORDO_UI_CPU ?? 4), samples: [], errors: [] };
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM, args: ["--no-sandbox"] });

async function setup(page, theme, expressive) {
  await page.addInitScript(({ user, theme, expressive }) => {
    localStorage.setItem("ordo.settings", JSON.stringify({ themeMode: theme, expressive, materialYouColors: false,
      serverUrl: "https://fixture.example.test", hapticsEnabled: false }));
    localStorage.setItem("secure.ordo.auth", JSON.stringify({ user, tokens: {
      accessToken: "fixture-access", refreshToken: "fixture-refresh", expiresIn: 86400,
    }, accessExpiresAt: Date.now() + 86400000 }));
  }, { user, theme, expressive });
  page.on("pageerror", error => results.errors.push(error.message));
  let state = { ...article };
  let currentUser = { ...user, preferences: { ...user.preferences } };
  await page.route("**/*", async route => {
    const request = route.request(), url = new URL(request.url()), path = url.pathname;
    if (url.origin === new URL(base).origin) return route.continue();
    let body = { success: true };
    if (path === "/api/auth/me") body = currentUser;
    else if (path === "/api/auth/refresh") body = { user: currentUser, tokens: { accessToken: "fixture-access", refreshToken: "fixture-refresh", expiresIn: 86400 } };
    else if (path === "/api/auth/preferences") {
      currentUser = { ...currentUser, preferences: { ...currentUser.preferences, ...request.postDataJSON() } };
      body = currentUser;
    }
    else if (path === "/api/server/info") body = { name: "ordo", version: "0.3.0", reminders: true, folderLockTypes: true };
    else if (path === "/api/folders") body = [];
    else if (path === "/api/tags") body = [tag];
    else if (path === "/api/bookmarks/extraction-progress") body = { pending: 0, total: count };
    else if (path === "/api/bookmarks/reminders") body = [];
    else if (path.startsWith("/api/bookmarks/article")) {
      if (request.method() === "PATCH") state = { ...state, ...request.postDataJSON() };
      body = { ...state, contentHtml, highlights: [] };
    } else if (path.includes("/bookmarks")) body = { items: [state, ...Array.from({ length: count - 1 }, (_, i) => ({
      ...article, id: `saved-${i}`, title: `Saved reading ${i + 1}`, tags: [],
      createdAt: new Date(Date.parse(stamp) - (i + 1) * 60000).toISOString(),
    }))], nextCursor: null, hasMore: false };
    else if (url.hostname === "api.github.com") body = [];
    if (url.hostname === "www.google.com") return route.fulfill({ contentType: "image/svg+xml", body: '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"/>' });
    await route.fulfill({ contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify(body) });
  });
}

// Time from the real click event to the first frame containing the destination.
// No fixed sleeps or Playwright polling are included in the reported duration.
async function measure(page, label, locator, target) {
  await locator.evaluate((node, target) => {
    window.interactionSample = null;
    node.addEventListener("click", () => {
      const start = performance.now(), frames = [], longTasks = [];
      let last = start;
      const observer = new PerformanceObserver(list => longTasks.push(...list.getEntries().map(entry => entry.duration)));
      observer.observe({ type: "longtask" });
      const visible = node => {
        if (!node || node.closest('[aria-hidden="true"], [inert]')) return false;
        const rect = node.getBoundingClientRect();
        if (!rect.width || !rect.height) return false;
        for (let parent = node; parent; parent = parent.parentElement) {
          const style = getComputedStyle(parent);
          if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) < 0.05) return false;
        }
        return true;
      };
      const frame = () => {
        const now = performance.now();
        frames.push(now - last); last = now;
        const found = [...document.querySelectorAll(target.selector)].some(node => visible(node) &&
          (!target.text || node.textContent.includes(target.text)));
        if ((target.absent ? !found : found) || now - start > 10000) {
          longTasks.push(...observer.takeRecords().map(entry => entry.duration));
          observer.disconnect();
          window.interactionSample = { latencyMs: now - start, maxFrameMs: Math.max(...frames),
            maxLongTaskMs: Math.max(0, ...longTasks), longTaskCount: longTasks.length, timedOut: now - start > 10000 };
        } else requestAnimationFrame(frame);
      };
      requestAnimationFrame(frame);
    }, { once: true });
  }, target);
  await locator.click();
  await page.waitForFunction(() => window.interactionSample !== null);
  const sample = await page.evaluate(() => window.interactionSample);
  assert.equal(sample.timedOut, false, label);
  return { label, ...sample };
}

async function openBookmarkMenu(page) {
  const row = page.getByRole("button", { name: /^Performance audit article,/ });
  await row.click({ button: "right" });
  await page.getByRole("menuitem", { name: "Edit tags", exact: true }).waitFor();
  await page.waitForTimeout(400);
}

try {
  const matrix = process.env.ORDO_UI_MATRIX === "1";
  for (const theme of matrix ? ["dark", "light"] : ["dark"]) {
    for (const expressive of matrix ? [true, false] : [true]) {
      for (const viewport of matrix ? [{ width: 390, height: 844 }, { width: 1280, height: 800 }] : [{ width: 390, height: 844 }]) {
        for (let repeat = 0; repeat < repeats; repeat++) {
          const mode = `${theme}-${expressive ? "expressive" : "standard"}-${viewport.width}-${repeat}`;
          const context = await browser.newContext({ viewport, colorScheme: theme });
          const page = await context.newPage();
          page.setDefaultTimeout(20000);
          await setup(page, theme, expressive);
          const session = await context.newCDPSession(page);
          await session.send("Emulation.setCPUThrottlingRate", { rate: results.cpuThrottle });
          try {
            await page.goto(base);
            await button(page, "Account and settings").waitFor();
            await page.getByRole("button", { name: /^Performance audit article,/ }).waitFor();
            await page.waitForTimeout(1000);
            const samples = [];
            results.samples.push({ mode, samples });
            samples.push(await measure(page, "Library overflow", button(page, "Library actions"), { selector: '[role="menuitem"]', text: "Manage tags" }));
            await page.keyboard.press("Escape"); await page.waitForTimeout(400);
            await openBookmarkMenu(page);
            samples.push(await measure(page, "Bookmark menu to Edit tags", page.getByRole("menuitem", { name: "Edit tags", exact: true }), { selector: '[role="dialog"]', text: "Edit tags" }));
            await button(page, "Save").waitFor();
            await page.keyboard.press("Tab");
            assert.ok(await page.getByRole("dialog").evaluate(node => node.contains(document.activeElement)), "Keyboard focus stays inside Edit tags during the menu handoff");
            await page.keyboard.press("Escape"); await page.waitForTimeout(500);
            await openBookmarkMenu(page);
            samples.push(await measure(page, "Edit tags reopen", page.getByRole("menuitem", { name: "Edit tags", exact: true }), { selector: '[role="dialog"]', text: "Edit tags" }));
            await page.keyboard.press("Escape"); await page.waitForTimeout(500);
            await openBookmarkMenu(page);
            samples.push(await measure(page, "Bookmark menu to Move", page.getByRole("menuitem", { name: "Move to folder", exact: true }), { selector: '[role="dialog"]', text: "Move to folder" }));
            await page.keyboard.press("Escape"); await page.waitForTimeout(500);
            await openBookmarkMenu(page);
            samples.push(await measure(page, "Move reopen", page.getByRole("menuitem", { name: "Move to folder", exact: true }), { selector: '[role="dialog"]', text: "Move to folder" }));
            await page.keyboard.press("Escape"); await page.waitForTimeout(500);
            await openBookmarkMenu(page);
            samples.push(await measure(page, "Delete confirmation", page.getByRole("menuitem", { name: "Delete bookmark", exact: true }), { selector: '[role="dialog"]', text: "Delete this bookmark?" }));
            samples.push(await measure(page, "Confirm delete to Undo", button(page, "Delete"), { selector: '[role="button"][aria-label="Undo"]' }));
            await page.waitForTimeout(400);
            samples.push(await measure(page, "Undo restores bookmark", button(page, "Undo"), { selector: '[role="button"]', text: article.title }));
            await page.waitForTimeout(500);
            await page.getByRole("button", { name: /^Performance audit article,/ }).click();
            await button(page, "Reader settings").waitFor();
            await page.getByText("Section 100", { exact: true }).waitFor();
            await page.waitForTimeout(700);
            // Measure the overflow before preference edits can reflow the
            // article or first-use preview fonts can affect the next sample.
            samples.push(await measure(page, "Reader overflow", button(page, "More article actions"), { selector: '[role="menuitem"]', text: "Open original" }));
            await page.keyboard.press("Escape"); await page.waitForTimeout(400);
            samples.push(await measure(page, "Reader settings", button(page, "Reader settings"), { selector: '[role="dialog"]', text: "Text size" }));
            await page.waitForTimeout(600);
            await page.keyboard.press("Tab");
            assert.ok(await page.getByRole("dialog").evaluate(node => node.contains(document.activeElement)), "Keyboard focus stays inside reader settings");
            await page.screenshot({ path: `${output}/${mode}-reader-settings.png` });
            await page.getByRole("radio", { name: "Medium", exact: true }).focus();
            await page.keyboard.press("ArrowRight");
            await page.locator('[role="radio"][aria-label="Large"][aria-checked="true"]').waitFor();
            await page.getByRole("radio", { name: "Medium", exact: true }).click();
            await page.keyboard.press("Escape"); await page.waitForTimeout(500);
            // Repeat with OS reduced motion; Escape must still release focus.
            await page.emulateMedia({ reducedMotion: "reduce" });
            await button(page, "Reader settings").click();
            await page.getByRole("dialog").waitFor();
            await page.keyboard.press("Escape"); await page.waitForTimeout(250);
            assert.equal(await page.getByRole("dialog").count(), 0);
            console.log(JSON.stringify({ mode, samples }));
          } catch (error) {
            await page.screenshot({ path: `${output}/${mode}-failure.png` }).catch(() => {});
            await writeFile(`${output}/${mode}-failure.txt`, await page.locator("body").innerText().catch(() => "Page unavailable")).catch(() => {});
            throw error;
          } finally { await context.close(); }
        }
      }
    }
  }
  assert.deepEqual(results.errors, []);
  if (process.env.ORDO_UI_BASELINE) {
    const before = JSON.parse(await readFile(process.env.ORDO_UI_BASELINE, "utf8"));
    assert.deepEqual(before.errors, [], "Baseline must have no browser errors");
    assert.equal(before.fixtureBookmarks, results.fixtureBookmarks, "Compare the same fixture size");
    assert.equal(before.cpuThrottle, results.cpuThrottle, "Compare the same CPU throttle");
    const median = values => {
      assert.ok(values.length, "Each compared configuration needs baseline and current samples");
      const sorted = values.toSorted((a, b) => a - b);
      const middle = Math.floor(sorted.length / 2);
      return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
    };
    results.comparison = results.samples.map(({ mode }) => mode.replace(/-\d+$/, "")).filter((mode, index, modes) => modes.indexOf(mode) === index).map(mode => {
      const group = data => data.samples.filter(sample => sample.mode.replace(/-\d+$/, "") === mode).flatMap(sample => sample.samples);
      const baseline = group(before), current = group(results);
      return { mode, medians: [...new Set(current.map(sample => sample.label))].map(label => ({ label,
        beforeMs: median(baseline.filter(sample => sample.label === label).map(sample => sample.latencyMs)),
        afterMs: median(current.filter(sample => sample.label === label).map(sample => sample.latencyMs)),
      })) };
    });
    console.log(JSON.stringify(results.comparison, null, 2));
  }
} finally {
  await writeFile(`${output}/results.json`, JSON.stringify(results, null, 2));
  await browser.close();
}
