/** Reader smoothness interaction checks on the fixture browser export (web
 * proxy for JS-thread work; NOT a native frame-rate test). Serve an Expo web
 * export with SPA fallback, then run:
 *   PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs ORDO_UI_URL=http://localhost:8255 \
 *     node apps/mobile/scripts/reader-smoothness.mjs
 * ORDO_UI_OUTPUT names the results directory (default /tmp/opencode/reader-smoothness).
 *
 * For each reader-controls interaction this records, from the real click to the
 * article settling:
 *   - latencyMs, maxFrameMs, long tasks (count + worst)
 *   - article DOM mutations split into structural (childList) vs style-only,
 *     plus dialog-region mutations
 *   - reader preference PATCH requests
 */
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? "playwright");
const base = process.env.ORDO_UI_URL ?? "http://127.0.0.1:8255";
const output = process.env.ORDO_UI_OUTPUT ?? "/tmp/opencode/reader-smoothness";
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
const contentHtml = Array.from({ length: 100 }, (_, i) => `<h2>Section ${i + 1}</h2><p>${"An article should remain responsive while changing its reading settings. ".repeat(12)}</p>`).join("");
const results = { fixtureBookmarks: count, samples: [], errors: [] };
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM, args: ["--no-sandbox"] });

async function setup(page, theme, expressive, viewport) {
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

/** Count every preference write so writes stay visible next to render work. */
async function preferenceWriteCount(page) {
  return page.evaluate(() => performance.getEntriesByType("resource")
    .filter(entry => entry.name.includes("/api/auth/preferences")).length);
}

/** A stable signature of the article's rendered text styles: any visible
 * preference change (size, family, ink, surface) moves it. */
async function articleSignature(page) {
  return page.evaluate(() => {
    // The innermost nodes whose OWN text is a heading (not ancestors whose
    // textContent merely includes it); their common ancestor is the article.
    const heading = (text) => [...document.querySelectorAll("div,span,h1,h2,h3")].find(node =>
      [...node.childNodes].some(child => child.nodeType === 3 && child.textContent.trim() === text));
    const first = heading("Section 1");
    const last = heading("Section 100");
    if (!first || !last) throw new Error("article headings not found");
    let articleRoot = first.parentElement;
    while (articleRoot && !articleRoot.contains(last)) articleRoot = articleRoot.parentElement;
    if (!articleRoot) throw new Error("article root not found");
    window.__ordoArticleRoot = articleRoot;
    const ancestorsOf = (node, levels) => {
      const chain = [];
      let current = node.parentElement;
      while (current && chain.length < levels) { chain.push(current); current = current.parentElement; }
      return chain;
    };
    const nodes = [articleRoot, ...ancestorsOf(articleRoot, 8), ...articleRoot.querySelectorAll("div, span")].slice(0, 64);
    return nodes.map(node => {
      const style = getComputedStyle(node);
      return `${style.color}|${style.fontSize}|${style.fontFamily}|${style.backgroundColor}`;
    }).join(";");
  });
}

/** Arm per-interaction counters, run `act`, then wait until the article style
 * signature moves and the tree has been mutation-quiet for three frames.
 * Reports React commits, long tasks and article/dialog DOM mutation classes. */
async function instrumented(page, label, act, { expectArticleChange = true }) {
  const before = await articleSignature(page);
  await page.evaluate(() => {
    const articleRoot = window.__ordoArticleRoot;
    const state = { articleStructural: 0, articleStyle: 0, dialog: 0, frames: [], longTasks: [], recent: [], dialogRecent: [] };
    const observer = new PerformanceObserver(list => state.longTasks.push(...list.getEntries().map(entry => entry.duration)));
    observer.observe({ type: "longtask" });
    const mutations = new MutationObserver(records => {
      for (const record of records) {
        // Chrome outside the article (progress bar springs, status bar) is not
        // part of this measurement; ignore those regions entirely.
        const target = record.target.nodeType === 3 ? record.target.parentElement : record.target;
        const described = `${record.type} <${target?.nodeName?.toLowerCase()} class=${String(target?.className ?? "").slice(0, 50)}>`;
        state.recent.push(described);
        if (state.recent.length > 12) state.recent.shift();
        if (target?.closest?.('[role="dialog"]')) {
          // The switch knob animates indefinitely (shared Toggle); it is not
          // interaction work and would otherwise keep every sample unsettled.
          if (target.closest('[data-testid="material-switch-handle"]')) continue;
          state.dialog += 1;
          state.dialogRecent.push(`${record.type} <${target?.nodeName?.toLowerCase()}> ${String(target?.className ?? "").slice(0, 60)} html=${target?.outerHTML?.slice(0, 90)}`);
          if (state.dialogRecent.length > 8) state.dialogRecent.shift();
          bump();
          continue;
        }
        if (!articleRoot.contains(target)) continue;
        if (record.type === "childList") state.articleStructural += record.addedNodes.length + record.removedNodes.length;
        else state.articleStyle += 1;
        bump();
      }
    });
    mutations.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["style", "class"], characterData: true });
    state.lastCounted = performance.now();
    const bump = () => { state.lastCounted = performance.now(); };
    const start = performance.now();
    let last = start;
    const frame = () => {
      const now = performance.now();
      state.frames.push(now - last);
      last = now;
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
    window.__ordoSample = { state, observer, mutations, start, articleRoot, before: window.__ordoBeforeSig };
  });
  const armed = await page.evaluate(sig => { window.__ordoSample.before = sig; return true; }, before);
  assert.ok(armed, label);
  await act();
  const sample = await page.evaluate(async (expectChange) => {
    const sample = window.__ordoSample;
    const signature = () => {
      const articleRoot = sample.articleRoot;
      const ancestors = [];
      let current = articleRoot.parentElement;
      while (current && ancestors.length < 8) { ancestors.push(current); current = current.parentElement; }
      const nodes = [articleRoot, ...ancestors, ...articleRoot.querySelectorAll("div, span")].slice(0, 64);
      return nodes.map(node => {
        const style = getComputedStyle(node);
        return `${style.color}|${style.fontSize}|${style.fontFamily}|${style.backgroundColor}`;
      }).join(";");
    };
    const quietMs = 600;
    const settle = (resolve) => {
      requestAnimationFrame(() => {
        const now = performance.now();
        const changed = !expectChange || signature() !== sample.before;
        // Under heavy CPU throttling rAF spacing is uneven; settle on a quiet
        // time window without article/dialog mutations instead of frame counts.
        const settled = now - sample.start > 20000
          || (changed && now - sample.state.lastCounted > quietMs && now - sample.start > 80);
        if (settled) {
          sample.observer.disconnect();
          sample.mutations.disconnect();
          resolve({ latencyMs: now - sample.start, maxFrameMs: Math.max(...sample.state.frames),
            longTaskCount: sample.state.longTasks.length, maxLongTaskMs: Math.max(0, ...sample.state.longTasks),
            articleStructural: sample.state.articleStructural, articleStyle: sample.state.articleStyle,
            dialogMutations: sample.state.dialog, timedOut: now - sample.start > 20000,
            stillMutating: sample.state.dialogRecent.length ? sample.state.dialogRecent.slice(-6) : sample.state.recent.slice(-6) });
        } else { settle(resolve); }
      });
    };
    return new Promise(settle);
  }, expectArticleChange);
  if (sample.timedOut) console.error(`${label} TIMED OUT:`, JSON.stringify(sample, null, 1));
  assert.equal(sample.timedOut, false, `${label}: ${JSON.stringify(sample.stillMutating ?? [])}`);
  delete sample.stillMutating;
  return { label, ...sample };
}

const button = (page, name) => page.getByRole("button", { name, exact: true });

async function runMode(browser, { theme, expressive, viewport, mode }) {
  const context = await browser.newContext({ viewport, colorScheme: theme });
  const page = await context.newPage();
  page.setDefaultTimeout(30000);
  await setup(page, theme, expressive, viewport);
  const session = await context.newCDPSession(page);
  await session.send("Emulation.setCPUThrottlingRate", { rate: Number(process.env.ORDO_UI_CPU ?? 4) });
  const samples = [];
  results.samples.push({ mode, samples });
  try {
    await page.goto(base);
    await button(page, "Account and settings").waitFor();
    await page.getByRole("button", { name: /^Performance audit article,/ }).waitFor();
    await page.waitForTimeout(1000);
    await page.getByRole("button", { name: /^Performance audit article,/ }).click();
    await button(page, "Reader settings").waitFor();
    await page.getByText("Section 100", { exact: true }).waitFor();
    await page.waitForTimeout(1500);
    const writesBeforeOpen = await preferenceWriteCount(page);

    samples.push(await instrumented(page, "open settings", () => button(page, "Reader settings").click(), { expectArticleChange: false }));
    // Panel previews start ~240ms after open; let them settle before measuring
    // preference edits so samples don't straddle font-loading work.
    await page.waitForTimeout(2600);
    const writesAfterOpen = await preferenceWriteCount(page);
    samples.push({ label: "open settings preference writes", commits: 0, latencyMs: 0, maxFrameMs: 0, longTaskCount: 0,
      maxLongTaskMs: 0, articleStructural: 0, articleStyle: 0, dialogMutations: 0, preferenceWritesDuringOpen: writesAfterOpen - writesBeforeOpen });

    samples.push(await instrumented(page, "change text size medium->large",
      () => page.getByRole("radio", { name: "Large", exact: true }).click(), {}));
    samples.push(await instrumented(page, "change text size large->medium",
      () => page.getByRole("radio", { name: "Medium", exact: true }).click(), {}));
    samples.push(await instrumented(page, "change theme system->light",
      () => page.getByRole("radio", { name: "Light", exact: true }).click(), {}));
    samples.push(await instrumented(page, "change theme light->dark",
      () => page.getByRole("radio", { name: "Dark", exact: true }).click(), {}));
    samples.push(await instrumented(page, "toggle amoled on",
      () => page.getByRole("switch", { name: "Reader AMOLED black" }).click(), {}));
    samples.push(await instrumented(page, "toggle amoled off",
      () => page.getByRole("switch", { name: "Reader AMOLED black" }).click(), {}));
    samples.push(await instrumented(page, "change typeface sans->serif",
      () => page.getByRole("radio", { name: /Libron/ }).click(), {}));
    samples.push(await instrumented(page, "change typeface serif->sans",
      () => page.getByRole("radio", { name: /Legible Sans/ }).click(), {}));
    samples.push(await instrumented(page, "close settings", () => page.keyboard.press("Escape"), { expectArticleChange: false }));
    await page.waitForTimeout(600);
    samples.push(await instrumented(page, "reopen settings", () => button(page, "Reader settings").click(), { expectArticleChange: false }));
    const writes = await preferenceWriteCount(page);
    assert.equal(writes, 8, "one serialized preference write per change");
    await page.screenshot({ path: `${output}/${mode}-settled.png` });
    console.log(JSON.stringify({ mode, samples }));
  } catch (error) {
    await page.screenshot({ path: `${output}/${mode}-failure.png` }).catch(() => {});
    throw error;
  } finally { await context.close(); }
}

try {
  for (const mode of (process.env.ORDO_UI_MATRIX === "1"
    ? ["dark-expressive-390", "dark-expressive-1280", "light-standard-390", "light-standard-1280"]
    : ["dark-expressive-390"])) {
    const [theme, design, width] = mode.split("-");
    await runMode(browser, { theme, expressive: design === "expressive", viewport: { width: Number(width), height: width === "390" ? 844 : 800 }, mode });
  }
  assert.deepEqual(results.errors, []);
} finally {
  await writeFile(`${output}/results.json`, JSON.stringify(results, null, 2));
  await browser.close();
}
