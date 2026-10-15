/** Release-web stress harness. Fixtures, not native FPS or backend measurements.
 * ORDO_UI_URL=http://127.0.0.1:8235 PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs
 * PLAYWRIGHT_CHROMIUM=/path/to/chromium ORDO_STRESS_OUTPUT=/tmp/opencode/ordo-stress
 * node tests/library-reader-stress.mjs
 */
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? "playwright");
const base = process.env.ORDO_UI_URL ?? "http://127.0.0.1:8235";
const output = process.env.ORDO_STRESS_OUTPUT ?? "/tmp/opencode/ordo-stress";
await mkdir(output, { recursive: true });
const stamp = "2026-10-01T12:00:00Z";
const user = { id: "stress", displayName: "Alex Morgan", email: "alex@example.test", emailVerified: true,
  hasAvatar: false, mfaEnabled: false, libraryEncrypted: false, canRenameInstance: false, createdAt: stamp,
  preferences: { fontFamily: "sans", fontSize: "medium", theme: "dark", amoled: false } };
const folder = { id: "large", name: "Large collection", icon: "folder-outline", pinned: false, protected: false,
  lockType: null, pinLength: null, bookmarkCount: 5000, unreadCount: 5000, createdAt: stamp, updatedAt: stamp };
const items = Array.from({ length: 10000 }, (_, index) => ({ id: `saved-${index}`, folderId: index < 5000 ? null : "large",
  url: `https://example.test/${index}`, domain: "example.test", title: `Saved reading ${index}`,
  description: "A large library stays responsive.", fetchStatus: "ok", contentKind: "article", contentKindOverride: null,
  extractionVersion: 1, author: null, publishedAt: null, readingTimeMinutes: 300, readProgress: 0, isRead: false,
  remindAt: null, tags: [], suggestedTags: [], createdAt: new Date(Date.parse(stamp) - index * 60000).toISOString(), updatedAt: stamp }));
const paragraphs = Number(process.env.ORDO_STRESS_PARAGRAPHS ?? 1200);
const html = `<div><article>${Array.from({ length: paragraphs }, (_, index) =>
  `${index % 20 === 0 ? `<h2>Chapter ${index / 20}</h2>` : ""}<p>Paragraph ${index}: A <strong>durable library</strong> keeps useful context. ${"Reading should remain comfortable and responsive even in a book-length article. ".repeat(3)}<a href="https://example.test/source">Source</a>.</p>`).join("")}</article></div>`;
const browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM,
  args: ["--no-sandbox", "--disable-dev-shm-usage"] });
const results = [];
try {
  for (const viewport of [{ width: 390, height: 844 }, { width: 1280, height: 800 }]) {
    const context = await browser.newContext({ viewport, colorScheme: "dark" });
    await context.addInitScript(({ user }) => {
      localStorage.setItem("ordo.settings", JSON.stringify({ themeMode: "dark", expressive: true, materialYouColors: false }));
      localStorage.setItem("secure.ordo.auth", JSON.stringify({ user, tokens: { accessToken: "a", refreshToken: "r", expiresIn: 3600 },
        accessExpiresAt: Date.now() + 3600e3, sessionUpdatedAt: Date.now() }));
      window.__stressTasks = [];
      new PerformanceObserver(list => window.__stressTasks.push(...list.getEntries().map(entry => entry.duration)))
        .observe({ entryTypes: ["longtask"] });
    }, { user });
    const page = await context.newPage();
    const errors = [], requests = { catalogue: 0, list: 0 };
    page.on("pageerror", error => errors.push(error.message));
    await page.route("**/*", async route => {
      const request = route.request(), url = new URL(request.url()), path = url.pathname;
      if (url.origin === new URL(base).origin) return route.continue();
      let body = {};
      if (path === "/api/server/info") body = { name: "ordo", version: "0.2.0", registrationEnabled: true, emailVerificationRequired: false, reminders: true };
      else if (path === "/api/auth/me" || path === "/api/auth/preferences") body = user;
      else if (path === "/api/auth/refresh") body = { user, tokens: { accessToken: "a", refreshToken: "r", expiresIn: 3600 } };
      else if (path === "/api/folders") body = [folder];
      else if (path === "/api/folders/large") body = folder;
      else if (path === "/api/tags" || path === "/api/bookmarks/reminders") body = [];
      else if (path === "/api/bookmarks/extraction-progress") body = { pending: 0, total: items.length };
      else if (path === "/api/bookmarks") {
        const all = url.searchParams.get("scope") === "all";
        requests[all ? "catalogue" : "list"]++;
        const visible = all ? items : items.filter(item => item.folderId === (url.searchParams.get("folderId") || null));
        const start = Number(url.searchParams.get("cursor") || 0), limit = Number(url.searchParams.get("limit") || 100);
        body = { items: visible.slice(start, start + limit), nextCursor: start + limit < visible.length ? String(start + limit) : null,
          hasMore: start + limit < visible.length };
      } else if (path.startsWith("/api/bookmarks/saved-")) body = { ...items.find(item => path.endsWith(`/${item.id}`)) ?? items[0], contentHtml: html, highlights: [] };
      else if (path.includes("bookmarks")) body = { items: [], hasMore: false, nextCursor: null };
      if (url.hostname === "www.google.com") return route.fulfill({ contentType: "image/svg+xml", body: '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"/>' });
      return route.fulfill({ contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify(body) });
    });
    const cdp = await context.newCDPSession(page);
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
    const started = Date.now();
    await page.goto(base, { waitUntil: "commit" });
    await page.getByText("Saved reading 1", { exact: true }).first().waitFor({ timeout: 60000 });
    const launchMs = Date.now() - started;
    await page.waitForTimeout(1500);
    const mountedLibraryRows = await page.getByText(/^Saved reading \d+$/).count();
    assert.ok(mountedLibraryRows < 70, `Library must virtualize: ${mountedLibraryRows} mounted rows`);
    const folderStart = Date.now();
    await page.getByText("Large collection", { exact: true }).first().click();
    await page.getByText("Saved reading 5000", { exact: true }).first().waitFor();
    const folderOpenMs = Date.now() - folderStart;
    const mountedFolderRows = await page.getByText(/^Saved reading \d+$/).count();
    assert.ok(mountedFolderRows < 70, `Folder must virtualize: ${mountedFolderRows} mounted rows`);
    await page.mouse.move(viewport.width / 2, viewport.height / 2);
    for (let index = 0; index < 20; index++) { await page.mouse.wheel(0, 500); await page.waitForTimeout(50); }
     assert.ok(await page.getByText(/^Saved reading \d+$/).count() < 70, "Scrolling must keep the mounted window bounded");
     assert.ok(requests.list >= 3, "Scrolling must fetch another folder page, not just recycle the first one");
    // Scroll back to open the same article and measure the synchronous stall.
    await page.evaluate(() => { for (const el of document.querySelectorAll("div")) if (el.scrollHeight > el.clientHeight + 200 && getComputedStyle(el).overflowY === "auto") el.scrollTop = 0; });
    await page.getByText("Saved reading 5000", { exact: true }).first().waitFor();
    await page.evaluate(() => { window.__stressTasks = []; });
    await cdp.send("Performance.enable");
    const metricStart = Object.fromEntries((await cdp.send("Performance.getMetrics")).metrics.map(metric => [metric.name, metric.value]));
    if (process.env.ORDO_STRESS_PROFILE) { await cdp.send("Profiler.enable"); await cdp.send("Profiler.start"); }
    const articleStart = Date.now();
    await page.getByText("Saved reading 5000", { exact: true }).first().click();
     await page.waitForFunction(() => document.body.textContent.includes("Paragraph 0:"), null,
       { polling: 100, timeout: 120000 });
    const articleFirstTextMs = Date.now() - articleStart;
    // Playwright's recursive text matcher repeatedly builds ancestor text for
    // every appended section (quadratic on book-length HTML). A single native
    // textContent read avoids turning the measurement tool into the bottleneck.
    await page.waitForFunction(last => document.body.textContent.includes(`Paragraph ${last}:`), paragraphs - 1,
      { polling: 100, timeout: 120000 });
    const articleCompleteMs = Date.now() - articleStart;
    await page.waitForTimeout(500);
    const articleTasks = await page.evaluate(() => ({ maxTaskMs: Math.max(0, ...window.__stressTasks),
      totalLongTaskMs: window.__stressTasks.reduce((sum, value) => sum + value, 0) }));
    const metricEnd = Object.fromEntries((await cdp.send("Performance.getMetrics")).metrics.map(metric => [metric.name, metric.value]));
    const cpu = Object.fromEntries(["ScriptDuration", "LayoutDuration", "RecalcStyleDuration", "TaskDuration"].map(name => [name, metricEnd[name] - metricStart[name]]));
    if (process.env.ORDO_STRESS_PROFILE) await writeFile(`${output}/profile-${viewport.width}.json`, JSON.stringify((await cdp.send("Profiler.stop")).profile));
    assert.deepEqual(errors, []);
    const orientation = viewport.width < 768 ? "portrait" : "landscape";
    await page.screenshot({ path: `${output}/reader-${orientation}.png` });
    results.push({ orientation, bookmarks: items.length, paragraphs, htmlBytes: Buffer.byteLength(html), launchMs,
      folderOpenMs, mountedLibraryRows, mountedFolderRows, articleFirstTextMs, articleCompleteMs, ...articleTasks, cpu, requests });
    await context.close();
  }
  await writeFile(`${output}/results.json`, JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results, null, 2));
} finally { await browser.close(); }
