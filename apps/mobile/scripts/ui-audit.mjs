/** Production-export audit with synthetic API data (never a real account).
 * PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs PLAYWRIGHT_CHROMIUM=/path/to/chromium
 * ORDO_UI_URL=http://127.0.0.1:8247 ORDO_UI_OUTPUT=/tmp/opencode/ordo-audit node scripts/ui-audit.mjs
 * --baseline records issues without failing; --quick runs interactions only.
 * --states-only checks empty/error/retry and narrow responsive controls.
 */
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? "playwright");
const base = process.env.ORDO_UI_URL ?? "http://127.0.0.1:8247";
const output = process.env.ORDO_UI_OUTPUT ?? "/tmp/opencode/ordo-full-audit-ui";
const baseline = process.argv.includes("--baseline");
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM, args: ["--no-sandbox"] });
const stamp = "2026-10-01T12:00:00Z";
const user = { id: "audit", displayName: "Alex Morgan", email: "alex@example.test", emailVerified: true, hasAvatar: false,
  mfaEnabled: false, libraryEncrypted: false, canRenameInstance: true, createdAt: stamp,
  preferences: { fontFamily: "sans", fontSize: "medium", theme: "system", amoled: false } };
const tag = { id: "design", name: "Design", color: "blue", bookmarkCount: 2, createdAt: stamp, updatedAt: stamp };
const folder = { id: "collection", name: "Design & inspiration", icon: "folder-outline", pinned: true,
  protected: false, lockType: null, pinLength: null, bookmarkCount: 2, unreadCount: 2, createdAt: stamp, updatedAt: stamp };
const bookmark = { id: "article", folderId: null, url: "https://example.test/article", domain: "example.test",
  title: "Building a more expressive design system", description: "Shape and motion clarify familiar interactions.",
  fetchStatus: "ok", contentKind: "article", contentKindOverride: null, extractionVersion: 1, author: "Alex Chen",
  publishedAt: stamp, readingTimeMinutes: 4, readProgress: 0, isRead: false, remindAt: null, tags: [tag], suggestedTags: [], createdAt: stamp, updatedAt: stamp };
const html = Array.from({ length: 30 }, (_, i) => `<h2>Section ${i + 1}: Reading with purpose</h2><p>${"A useful library grows one thoughtful idea at a time. ".repeat(12)}</p>`).join("");
const authRoutes = ["login", "register", "forgot-password", "reset-password?email=alex%40example.test", "verify-email?email=alex%40example.test", "mfa?challengeToken=fixture&emailRecovery=1"];
const appRoutes = ["", "folder/collection", "tags", "tags/design", "reader/article", "settings", "settings/account",
  "settings/display-name", "settings/email", "settings/password", "settings/verify-email?email=next%40example.test", "settings/security",
  "settings/sessions", "settings/appearance", "settings/controls", "settings/server", "settings/data", "settings/about", "settings/delete-account"];
const results = { screens: [], checks: [], issues: [], errors: [], performance: [] };
let currentPage;
function check(condition, name, details) {
  results.checks.push({ name, pass: !!condition, ...(details ? { details } : {}) });
  if (!condition) results.issues.push({ name, details });
}
async function context({ theme = "dark", expressive = true, width = 390, height = 844, authenticated = true, count = 40, catalogue = 1, reducedMotion = "no-preference", delayHomeMs = 0, homeState = "ready" } = {}) {
  const context = await browser.newContext({ viewport: { width, height }, colorScheme: theme, reducedMotion });
  await context.addInitScript(({ user, theme, expressive, authenticated }) => {
    localStorage.setItem("ordo.settings", JSON.stringify({ themeMode: theme, expressive, materialYouColors: false }));
    if (authenticated) localStorage.setItem("secure.ordo.auth", JSON.stringify({ user,
      tokens: { accessToken: "fixture", refreshToken: "fixture", expiresIn: 3600 }, accessExpiresAt: Date.now() + 3600e3, sessionUpdatedAt: Date.now() }));
  }, { user, theme, expressive, authenticated });
  const page = await context.newPage();
  currentPage = page;
  page.on("pageerror", (error) => results.errors.push(error.message));
  let failHome = homeState === "error";
  await page.route("**/*", async (route) => {
    const request = route.request(), url = new URL(request.url()), path = url.pathname;
    if (url.origin === new URL(base).origin) return route.continue();
    if (delayHomeMs && (path === "/api/folders" || path === "/api/bookmarks")) await new Promise((resolve) => setTimeout(resolve, delayHomeMs));
    if (failHome && (path === "/api/folders" || path.includes("/api/bookmarks"))) return route.fulfill({
      status: 503, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify({ error: { code: "fixture_unavailable", message: "Fixture server unavailable" } }),
    });
    let body = { success: true };
    if (path === "/api/server/info") body = { name: "ordo", version: "0.3.0", registrationEnabled: true,
      emailVerificationRequired: false, smtpConfigured: true, mfaRequired: false, folderLockTypes: true, reminders: true };
    else if (path === "/api/auth/me" || path === "/api/auth/preferences") body = user;
    else if (path === "/api/auth/sessions") body = [{ id: "current", current: true, deviceType: "desktop", deviceName: "This browser", lastSeenAt: stamp, createdAt: stamp },
      { id: "other", current: false, deviceType: "phone", deviceName: "Pixel 9", lastSeenAt: stamp, createdAt: stamp }];
    else if (path === "/api/auth/refresh") body = { user, tokens: { accessToken: "fixture", refreshToken: "fixture", expiresIn: 3600 } };
    else if (path === "/api/auth/mfa/totp/begin") body = { secret: "TESTKEY", otpauthUrl: "otpauth://totp/Test?secret=TESTKEY&issuer=Test" };
    else if (path === "/api/folders") body = homeState === "empty" ? [] : [folder];
    else if (path === "/api/folders/collection") body = folder;
    else if (path === "/api/tags") body = [tag, ...Array.from({ length: catalogue - 1 }, (_, i) => ({ ...tag, id: `tag-${i}`, name: `Topic ${i}` }))];
    else if (path === "/api/tags/design") body = tag;
    else if (path === "/api/bookmarks/extraction-progress") body = { pending: 0, total: count };
    else if (path === "/api/bookmarks/reminders") body = [];
    else if (path === "/api/bookmarks/article") body = { ...bookmark, contentHtml: html, highlights: [] };
    else if (path.includes("bookmarks")) body = { items: homeState === "empty" ? [] : [bookmark, ...Array.from({ length: count - 1 }, (_, i) => ({ ...bookmark, id: `saved-${i}`, title: `Saved reading ${i + 1}`, tags: [], createdAt: new Date(Date.parse(stamp) - (i + 1) * 60_000).toISOString() }))], nextCursor: null, hasMore: false };
    if (url.hostname === "www.google.com") return route.fulfill({ contentType: "image/svg+xml", body: '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"/>' });
    return route.fulfill({ contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify(body) });
  });
  return { context, page, recoverHome: () => { failHome = false; } };
}
async function settle(page) { await page.waitForTimeout(350); }
async function screen(page, name) {
  await page.locator('[data-testid="material-app-bar"]:visible, [data-testid="auth-header"]:visible, [role="heading"]:visible').first().waitFor();
  await page.locator('[data-testid="launch-splash"]').waitFor({ state: "hidden" });
  await page.waitForTimeout(500);
  await settle(page);
  const text = await page.locator("body").innerText();
  check(text.trim() && !text.includes("Something went wrong"), `${name}: painted content`);
  const overflow = await page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth,
    offenders: [...document.querySelectorAll("body *")].filter((node) => {
      const rect = node.getBoundingClientRect(); return rect.width && rect.right > innerWidth + 1;
    }).slice(0, 8).map((node) => ({ tag: node.tagName, role: node.getAttribute("role"), label: node.getAttribute("aria-label"), text: node.textContent.slice(0, 80), width: node.getBoundingClientRect().width })) }));
  check(overflow.scroll <= overflow.width + 1, `${name}: no viewport overflow`, overflow.scroll > overflow.width + 1 ? overflow : undefined);
  const geometry = await page.evaluate(() => {
    const visible = (node) => {
      const rect = node.getBoundingClientRect();
      return node.checkVisibility({ opacityProperty: true, visibilityProperty: true }) && rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.top < innerHeight;
    };
    const smallTargets = [...document.querySelectorAll('[role="button"], [role="radio"], [role="checkbox"], [role="switch"], [role^="menuitem"]')]
      .filter((node) => visible(node) && !node.closest('[aria-hidden="true"], [inert]')).flatMap((node) => {
        const rect = node.getBoundingClientRect();
        return rect.width < 47.9 || rect.height < 47.9 ? [{ label: node.getAttribute("aria-label") ?? node.textContent.slice(0, 60), width: rect.width, height: rect.height }] : [];
      });
    const clippedLabels = [...document.querySelectorAll('[data-testid="material-fab-label"], [data-testid="material-segment-label"]')]
      .filter(visible).flatMap((node) => {
        const range = document.createRange(); range.selectNodeContents(node);
        const text = range.getBoundingClientRect().width, available = node.getBoundingClientRect().width;
        return text > available + 0.1 ? [{ label: node.textContent, text, available }] : [];
      });
    return { smallTargets, clippedLabels };
  });
  check(geometry.smallTargets.length === 0, `${name}: 48px control targets`, geometry.smallTargets);
  check(geometry.clippedLabels.length === 0, `${name}: complete action labels`, geometry.clippedLabels);
  await page.screenshot({ path: `${output}/${name}.png` });
  results.screens.push(name);
}
async function profile(page, name, action) {
  const session = await page.context().newCDPSession(page);
  await session.send("Emulation.setCPUThrottlingRate", { rate: 4 });
  await page.evaluate(() => {
    window.auditTasks = [];
    window.auditObserver = new PerformanceObserver((list) => window.auditTasks.push(...list.getEntries().map((entry) => entry.duration)));
    window.auditObserver.observe({ entryTypes: ["longtask"] });
  });
  const start = performance.now();
  await action(); await settle(page);
  const tasks = await page.evaluate(() => { window.auditObserver.disconnect(); return window.auditTasks; });
  results.performance.push({ name, cpuThrottle: 4, actionAndSettleMs: +(performance.now() - start).toFixed(1),
    longTasks: tasks.length, maxLongTaskMs: Math.max(0, ...tasks), totalLongTaskMs: tasks.reduce((a, b) => a + b, 0) });
  await session.send("Emulation.setCPUThrottlingRate", { rate: 1 });
  await session.detach();
}
const button = (page, name) => page.getByRole("button", { name, exact: true });
async function interactions(options) {
  const { page, context: ctx } = await context(options);
  const label = `${options.theme ?? "dark"}-${options.expressive ?? true}-${options.width ?? 390}-${options.reducedMotion ?? "normal"}`;
  await page.goto(base);
  await button(page, "Save bookmark").first().waitFor();
  await settle(page);
  // Full-height inline tag actions must fit inside exact virtual-list slots.
  const tagGeometry = await page.locator('[aria-label="Show bookmarks tagged Design"]').first().evaluate((node) => {
    const bodyNode = node.closest('[aria-label^="Building a more expressive"]');
    const target = node.getBoundingClientRect(), body = bodyNode?.getBoundingClientRect(), row = bodyNode?.parentElement?.getBoundingClientRect();
    return { target: target.toJSON(), body: body?.toJSON(), row: row?.toJSON(),
      fits: !!body && !!row && body.top >= row.top - 1 && body.bottom <= row.bottom + 1 && target.top >= body.top && target.bottom <= body.bottom + 1 };
  });
  check(tagGeometry.fits, `${label}: inline tag fits row`, tagGeometry);
  await profile(page, `${label}: cold save dialog`, () => button(page, "Save bookmark").first().click());
  await page.getByRole("dialog").waitFor();
  check(await page.getByRole("dialog").getByRole("textbox").first().evaluate((node) => node === document.activeElement), `${label}: save focus`);
  await screen(page, `${label}-save`);
  await page.keyboard.press("Escape"); await settle(page);
  check(await page.getByRole("dialog").count() === 0, `${label}: Escape dismisses dialog`);
  await button(page, "Library actions").click(); await settle(page);
  await page.getByRole("menuitem", { name: "Sort library", exact: true }).click(); await settle(page);
  await screen(page, `${label}-sort`);
  await page.keyboard.press("Escape"); await settle(page);
  await page.getByRole("textbox", { name: "Search your library", exact: true }).fill("reading");
  await settle(page);
  await button(page, "Search filters").click(); await settle(page);
  await page.getByRole("menuitem", { name: "Tags", exact: true }).click(); await settle(page);
  const tagCount = await page.getByRole("menuitemcheckbox").count();
  check(tagCount < 60, `${label}: bounded filter menu`, { mountedTags: tagCount });
  await screen(page, `${label}-tags-filter`);
  await page.getByRole("menuitem", { name: "Back", exact: true }).focus();
  await page.keyboard.press("End");
  await page.waitForFunction(() => document.activeElement?.getAttribute("aria-label") === "Topic 99");
  check(true, `${label}: End reaches last unmounted catalogue item`);
  await page.keyboard.press("Home");
  await page.waitForFunction(() => document.activeElement?.getAttribute("aria-label") === "Back");
  await page.keyboard.press("ArrowUp");
  await page.waitForFunction(() => document.activeElement?.getAttribute("aria-label") === "Topic 99");
  await page.keyboard.press("ArrowDown");
  await page.waitForFunction(() => document.activeElement?.getAttribute("aria-label") === "Back");
  check(true, `${label}: catalogue Home and arrow wrapping retain focus`);
  await page.keyboard.press("Escape"); await settle(page);
  await page.goto(`${base}/reader/article`);
  await button(page, "Table of contents").waitFor(); await settle(page);
  await profile(page, `${label}: cold contents`, () => button(page, "Table of contents").click());
  await screen(page, `${label}-contents`);
  await page.keyboard.press("Escape"); await settle(page);
  await button(page, "Reader settings").click(); await settle(page);
  await screen(page, `${label}-reader-settings`);
  await page.keyboard.press("Escape"); await settle(page);
  await button(page, "More article actions").click(); await settle(page);
  await page.getByRole("menuitem", { name: "Remind", exact: true }).click(); await settle(page);
  const custom = page.getByRole("menuitem", { name: /Custom/ });
  await custom.click(); await settle(page);
  await screen(page, `${label}-reminder`);
  await page.getByRole("radio", { name: "Date", exact: true }).click(); await settle(page);
  await screen(page, `${label}-calendar`);
  await page.keyboard.press("Escape");
  await ctx.close();
}
async function overlays(options) {
  const { page, context: ctx } = await context(options);
  const label = `overlays-${options.theme}-${options.expressive}-${options.width ?? 390}`;
  const home = async () => {
    await page.goto(base);
    await button(page, "Library actions").waitFor();
    await page.locator('[data-testid="launch-splash"]').waitFor({ state: "hidden" });
    await settle(page);
  };
  const folderMenu = async () => {
    await home();
    await page.getByRole("button", { name: /^Design & inspiration, 2 bookmarks/ }).click({ button: "right" });
    await settle(page);
  };
  for (const action of ["Rename", "Change icon", "Delete folder"]) {
    await folderMenu();
    await page.getByRole("menuitem", { name: action, exact: true }).click();
    await screen(page, `${label}-${action.replaceAll(" ", "-")}`);
    await page.keyboard.press("Escape"); await settle(page);
  }
  for (const lock of ["Pattern", "PIN", "Text password"]) {
    await folderMenu();
    await page.getByRole("menuitem", { name: "Lock folder", exact: true }).click(); await settle(page);
    await page.getByRole("menuitem", { name: lock, exact: true }).click();
    await screen(page, `${label}-lock-${lock.replaceAll(" ", "-")}`);
    if (lock === "Pattern") {
      await button(page, "Use buttons to enter pattern").click();
      await screen(page, `${label}-pattern-accessible`);
    }
    await page.keyboard.press("Escape"); await settle(page);
  }
  for (const action of ["Move to folder", "Edit tags", "Delete bookmark"]) {
    await home();
    await page.getByRole("button", { name: /^Building a more expressive design system,/ }).click({ button: "right" }); await settle(page);
    await page.getByRole("menuitem", { name: action, exact: true }).click();
    await page.getByRole("dialog").waitFor();
    await screen(page, `${label}-${action.replaceAll(" ", "-")}`);
    await page.keyboard.press("Escape"); await settle(page);
  }
  await home();
  await button(page, "Save bookmark").first().click(); await settle(page);
  await page.getByRole("textbox", { name: "Link", exact: true }).fill("https://example.test/draft");
  await button(page, "Folder, Bookmarks").click(); await settle(page);
  await page.getByRole("menuitem", { name: "New folder", exact: true }).click(); await settle(page);
  await page.getByRole("textbox", { name: "Name", exact: true }).fill("Preserved draft");
  await button(page, "Icon, Folder").click(); await settle(page);
  await screen(page, `${label}-nested-icon-picker`);
  await page.keyboard.press("Escape"); await settle(page);
  check(await page.getByRole("textbox", { name: "Name", exact: true }).inputValue() === "Preserved draft", `${label}: nested picker retains folder draft`);
  await button(page, "Cancel").click(); await settle(page);
  check(await page.getByRole("textbox", { name: "Link", exact: true }).inputValue() === "https://example.test/draft", `${label}: child form retains parent draft`);
  await page.keyboard.press("Escape"); await settle(page);
  await page.goto(`${base}/settings/appearance`);
  await button(page, /^Theme,/).click(); await settle(page);
  await screen(page, `${label}-theme-picker`);
  await page.keyboard.press("Home"); await page.keyboard.press("ArrowDown");
  check(await page.evaluate(() => document.activeElement?.getAttribute("role") === "menuitemradio"), `${label}: keyboard owns menu selection`);
  await page.keyboard.press("Escape"); await settle(page);
  await page.goto(`${base}/settings/security`);
  await button(page, "Set up authenticator").click(); await settle(page);
  await button(page, "Enlarge authenticator QR code").click(); await settle(page);
  await screen(page, `${label}-authenticator-qr`);
  await page.keyboard.press("Escape"); await settle(page);
  await page.goto(`${base}/settings/sessions`);
  await button(page, "Revoke").click(); await settle(page);
  await screen(page, `${label}-session-confirmation`);
  await page.keyboard.press("Escape");
  await page.goto(`${base}/settings`);
  await button(page, "Sign out").click(); await settle(page);
  await screen(page, `${label}-signout-confirmation`);
  await ctx.close();
}
async function states() {
  for (const theme of ["light", "dark"]) for (const expressive of [false, true]) for (const width of [320, 390]) {
    const { page, context: ctx } = await context({ theme, expressive, width, homeState: "empty" });
    const label = `states-${theme}-${expressive}-${width}`;
    await page.goto(base);
    await page.getByText("No bookmarks yet", { exact: true }).waitFor();
    await screen(page, `${label}-empty`);
    await button(page, "Save bookmark").first().click();
    await screen(page, `${label}-save`);
    await page.keyboard.press("Escape");
    await page.goto(`${base}/settings/appearance`);
    await screen(page, `${label}-appearance`);
    const selected = page.getByRole("radio", { name: "Standard", exact: true });
    await selected.focus(); await page.keyboard.press("ArrowRight"); await settle(page);
    check(await page.getByRole("radio", { name: "Medium", exact: true }).getAttribute("aria-checked") === "true", `${label}: connected group keyboard selection`);
    await screen(page, `${label}-appearance-selected`);
    await ctx.close();
  }
  const { page, context: ctx, recoverHome } = await context({ homeState: "error" });
  await page.goto(base);
  await button(page, "Retry").waitFor();
  await screen(page, "states-library-error");
  recoverHome(); await button(page, "Retry").click();
  await page.getByRole("button", { name: /^Building a more expressive design system,/ }).waitFor();
  await screen(page, "states-library-recovered");
  await ctx.close();
}
try {
  if (process.argv.includes("--states-only")) await states();
  else {
  if (!process.argv.includes("--overlays-only") && !process.argv.includes("--routes-only")) {
    const { page, context: ctx } = await context({ delayHomeMs: 5000 });
    const start = performance.now();
    await page.goto(base);
    await page.getByRole("textbox", { name: "Search your library", exact: true }).waitFor();
    await page.locator('[data-testid="launch-splash"]').waitFor({ state: "hidden" });
    const elapsed = performance.now() - start;
    check(elapsed < 3000, "cold-cache launch does not wait for library network", { elapsedMs: +elapsed.toFixed(1), networkDelayMs: 5000 });
    await screen(page, "cold-cache-loading");
    await ctx.close();
  }
  if (!process.argv.includes("--quick") && !process.argv.includes("--overlays-only")) {
    for (const theme of ["light", "dark"]) for (const expressive of [false, true]) for (const width of [390, 1280]) {
      for (const authenticated of [false, true]) {
        const { page, context: ctx } = await context({ theme, expressive, width, authenticated });
        for (const route of authenticated ? appRoutes : authRoutes) {
          await page.goto(`${base}/${route}`);
          await screen(page, `${theme}-${expressive}-${width}-${route.replace(/[^a-z0-9]/gi, "-") || "library"}`);
        }
        await ctx.close();
      }
    }
  }
  if (!process.argv.includes("--overlays-only") && !process.argv.includes("--routes-only")) {
    for (const theme of ["light", "dark"]) for (const expressive of [false, true]) await interactions({ theme, expressive, catalogue: 200 });
    await interactions({ width: 1280, height: 800, catalogue: 200 });
    await interactions({ width: 844, height: 390, reducedMotion: "reduce", catalogue: 200 });
  }
  if (!process.argv.includes("--quick") && !process.argv.includes("--routes-only")) for (const theme of ["light", "dark"]) for (const expressive of [false, true]) await overlays({ theme, expressive,
    ...(process.argv.includes("--wide-overlays") ? { width: 1280, height: 800 } : {}) });
  }
  check(results.errors.length === 0, "no uncaught browser errors", results.errors);
} catch (error) {
  results.issues.push({ name: "test execution", details: error.stack });
  if (currentPage && !currentPage.isClosed()) {
    await currentPage.screenshot({ path: `${output}/failure.png` });
    await writeFile(`${output}/failure.html`, await currentPage.content());
  }
} finally {
  await writeFile(`${output}/results.json`, JSON.stringify(results, null, 2));
  await browser.close();
}
console.log(JSON.stringify({ screens: results.screens.length, checks: results.checks.length, issues: results.issues, errors: results.errors, performance: results.performance }, null, 2));
if (!baseline) assert.equal(results.issues.length, 0, `Audit failures; see ${output}/results.json`);
