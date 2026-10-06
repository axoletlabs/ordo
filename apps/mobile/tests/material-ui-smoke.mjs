/** Built Expo web smoke test. API responses are fixtures, not backend verification.
 * PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs
 * PLAYWRIGHT_CHROMIUM=/path/to/chromium
 * ORDO_UI_URL=http://127.0.0.1:8235 ORDO_UI_OUTPUT=/tmp/opencode/ordo-ui node tests/material-ui-smoke.mjs
 */
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? "playwright");
const base = process.env.ORDO_UI_URL ?? "http://127.0.0.1:8235";
const output = process.env.ORDO_UI_OUTPUT ?? "/tmp/opencode/ordo-material-ui";
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM, args: ["--no-sandbox"] });
const stamp = "2026-10-01T12:00:00Z";
const user = { id: "ui-audit", displayName: "Alex Morgan", email: "alex@example.test", emailVerified: true, hasAvatar: false,
  mfaEnabled: false, libraryEncrypted: false, canRenameInstance: false, createdAt: stamp,
  preferences: { fontFamily: "sans", fontSize: "medium", theme: "dark", amoled: false } };
const tag = { id: "design", name: "Design", color: "blue", bookmarkCount: 2, createdAt: stamp, updatedAt: stamp };
const folder = { id: "collection", name: "Design & inspiration", icon: "color-palette-outline", pinned: true,
  protected: false, lockType: null, pinLength: null, bookmarkCount: 2, unreadCount: 2, createdAt: stamp, updatedAt: stamp };
const bookmark = { id: "article", folderId: null, url: "https://example.test/article", domain: "example.test",
  title: "Building a more expressive design system", description: "Shape and motion clarify familiar interactions.",
  fetchStatus: "ok", contentKind: "article", contentKindOverride: null, extractionVersion: 1, author: "Alex Chen",
  publishedAt: stamp, readingTimeMinutes: 4, readProgress: 0, isRead: false, remindAt: null, tags: [tag], suggestedTags: [], createdAt: stamp, updatedAt: stamp };
const readerHtml = `<h2>Reading with purpose</h2>
  <p>Plain reader paragraph for contrast.</p>
  <p>A <strong>durable <a href="https://example.test/library">library</a></strong> makes reading easier.</p>
  <p><span style="color: #ffffff; background-color: #ffffff; font-size: 80px; font-family: fantasy">Source styling cannot override the reader.</span></p>
  <blockquote><p>A quiet space for saved ideas.</p></blockquote>
  <pre><code>const library = "saved ideas";\n${"reader_code_token_".repeat(12)}</code></pre>
  <h2>Notes and comparisons</h2><ul><li>Readable lists</li><li>Consistent typography</li></ul>
  <table><thead><tr><th>Tool</th><th>Purpose</th></tr></thead><tbody><tr><td>Library</td><td>Save ideas</td></tr><tr><td>Reader</td><td>Read with focus</td></tr></tbody></table>
  <figure><img src="https://example.test/reader-illustration.svg" width="1600" height="600" alt="A reading-library illustration"/><figcaption>Images stay inside the reading column.</figcaption></figure>
  <h3>Keep exploring</h3><p>${"A library grows one thoughtful read at a time. ".repeat(24)}</p>`;
const readerHighlight = { id: "saved-highlight", exact: "durable library", prefix: "A ", suffix: " makes reading easier.", href: null, createdAt: stamp };
const authResponse = { user, tokens: { accessToken: "fixture-access", refreshToken: "fixture-refresh", expiresIn: 3600 } };
const results = { screens: [], interactions: [], errors: [], performanceSamples: [] };
let activePage;
const authRoutes = ["login", "register", "forgot-password", "reset-password?email=alex%40example.test", "verify-email?email=alex%40example.test", "mfa?challengeToken=fixture&emailRecovery=1"];
const appRoutes = ["", "search", "folder/collection", "tags", "tags/design", "reader/article", "settings", "settings/account",
  "settings/display-name", "settings/email", "settings/password", "settings/verify-email?email=next%40example.test", "settings/security",
  "settings/sessions", "settings/appearance", "settings/controls", "settings/server", "settings/data", "settings/about", "settings/delete-account"];

async function fixture(page, scenario = {}) {
  let currentUser = { ...user, preferences: { ...user.preferences, ...scenario.readerPreferences } };
  let importCount = 0;
  page.on("pageerror", e => results.errors.push(e.message));
  await page.route("**/*", async route => {
    const request = route.request(), url = new URL(request.url()), path = url.pathname;
    if (url.origin === new URL(base).origin) return route.continue();
    let body = { success: true }, status = 200;
    if (path === "/api/import-export/import" && request.method() === "POST") body = { jobId: `fixture-import-${++importCount}` };
    else if (path.startsWith("/api/import-export/import/fixture-import-")) {
      if (path.endsWith("/commit")) scenario.importStatus = "completed";
      body = { id: path.split("/")[4], status: scenario.importStatus ?? "ready", fileName: "reading.json", createdAt: stamp, expiresAt: "2026-12-01T00:00:00Z",
        failure: "The file could not be parsed. Choose a JSON, HTML, or CSV export.",
        preview: { format: "ordo-json", totalRows: 2, validRows: 2, invalidRows: 0, duplicates: 0, uniqueNew: 2, uniqueDuplicates: 0, withinFileDuplicates: 0,
          newFolders: [], existingFolders: [], lockedFolderMatches: scenario.protected ? [folder.name] : [], invalidSamples: [], duplicateSamples: [] },
        result: scenario.importStatus === "completed" ? { imported: 2, updated: 0, skipped: 0, failed: 0, foldersCreated: 0, atomic: true, duplicatePolicy: "skip", failures: [] } : null };
    }
    else if (path === "/api/folders/collection/unlock") body = { token: "fixture-folder-token", expiresIn: 600 };
    else if (path === "/api/auth/reset-password") { status = 400; body = { error: { code: "INVALID_TOKEN", message: "That reset code has expired. Request a new code." } }; }
    else if (path === "/api/bookmarks" && request.method() === "GET" && scenario.libraryState) {
      if (scenario.gate) await scenario.gate;
      if (scenario.libraryState === "error") {
        status = 503; body = { error: { code: "INTERNAL_ERROR", message: "Your library is temporarily unavailable. Try again." } };
      } else body = { items: [], nextCursor: null, hasMore: false };
    }
    else if (path === "/api/folders" && scenario.libraryState) body = [];
    else if (path === "/api/folders" && scenario.catalogue) body = [folder, ...Array.from({ length: 6 }, (_, i) => ({ ...folder, id: `folder-${i}`, name: `Collection ${i}`, pinned: false }))];
    else if (path === "/api/tags" && scenario.catalogue) body = [tag, ...Array.from({ length: 6 }, (_, i) => ({ ...tag, id: `tag-${i}`, name: `Topic ${i}`, bookmarkCount: 0 }))];
    else if (url.hostname === "offline.example.test") { status = 503; body = {}; }
    else if (path === "/api/tags" && request.method() === "POST" && request.postDataJSON()?.name === "Failure test") {
      status = 409; body = { error: { code: "CONFLICT", message: "Couldn't create the tag. Try again." } };
    }
    else if (path === "/api/server/info") body = { name: "ordo", version: "0.1.0", registrationEnabled: true, emailVerificationRequired: false,
      smtpConfigured: true, mfaRequired: false, folderLockTypes: true, reminders: true };
    else if (path === "/api/auth/login" && request.postDataJSON()?.password === "wrong-password") {
      status = 401; body = { error: { code: "INVALID_CREDENTIALS", message: "Email or password is incorrect." } };
    } else if (["/api/auth/login", "/api/auth/refresh", "/api/auth/register"].includes(path)) body = { ...authResponse, user: currentUser };
    else if (path === "/api/auth/preferences") { currentUser = { ...currentUser, preferences: { ...currentUser.preferences, ...request.postDataJSON() } }; body = currentUser; }
    else if (path === "/api/auth/me") body = currentUser;
    else if (path === "/api/auth/sessions") body = [{ id: "current", current: true, deviceType: "desktop", deviceName: "This browser", lastSeenAt: stamp, createdAt: stamp },
      { id: "other", current: false, deviceType: "phone", deviceName: "Pixel 9", lastSeenAt: stamp, createdAt: stamp }];
    else if (path === "/api/auth/mfa/totp/begin") body = { secret: "JBSWY3DPEHPK3PXP", otpauthUrl: "otpauth://totp/ordo:alex?secret=JBSWY3DPEHPK3PXP&issuer=ordo" };
    else if (path === "/api/auth/mfa/totp/confirm") body = { user: { ...user, mfaEnabled: true }, backupCodes: ["abcd1234", "efgh5678", "ijkl9012", "mnop3456"] };
    else if (path === "/api/folders") body = [{ ...folder, ...(scenario.protected ? { protected: true, lockType: "password" } : {}) }];
    else if (path === "/api/folders/collection") body = folder;
    else if (path === "/api/tags") body = [tag];
    else if (path === "/api/tags/design") body = tag;
    else if (path === "/api/bookmarks/extraction-progress") body = { pending: 0, total: 2 };
    else if (path === "/api/bookmarks/reminders") body = [];
    else if (path === "/api/bookmarks" && request.method() === "POST") body = { ...bookmark, ...request.postDataJSON() };
    else if (path === "/api/bookmarks" || path.includes("/bookmarks") && !path.startsWith("/api/bookmarks/article")) body = { items: [bookmark,
      ...Array.from({ length: Math.max(0, (scenario.bookmarkCount ?? 1) - 1) }, (_, index) => ({ ...bookmark, id: `saved-${index}`, title: `Saved reading ${index + 1}`, tags: [], createdAt: new Date(Date.parse(stamp) - (index + 1) * 60000).toISOString() }))], nextCursor: null, hasMore: false };
    else if (path.startsWith("/api/bookmarks/article/highlights") && request.method() === "DELETE") { scenario.highlightRemoved = true; body = { success: true }; }
    else if (path.startsWith("/api/bookmarks/article")) body = { ...bookmark,
      contentHtml: scenario.richReader ? readerHtml : "<h2>Reading with purpose</h2><p>Saved ideas make a useful library.</p>",
      highlights: scenario.richReader && !scenario.highlightRemoved ? [readerHighlight] : [] };
    else if (url.hostname === "api.github.com") body = [];
    if (url.hostname === "www.google.com") return route.fulfill({ contentType: "image/svg+xml", body: '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"><rect width="24" height="24" rx="4" fill="#006a60"/></svg>' });
    if (path === "/reader-illustration.svg") return route.fulfill({ contentType: "image/svg+xml", body: '<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="600"><rect width="1600" height="600" fill="#dceee9"/><path d="M450 150h280v300H450zm380 0h280v300H830z" fill="#006a60"/></svg>' });
    return route.fulfill({ status, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify(body) });
  });
}
const button = (page, name) => page.getByRole("button", { name, exact: true });
async function settle(page) { await page.waitForTimeout(450); }
async function profileAction(page, name, action, fixtureBookmarks = 1) {
  await page.evaluate(() => {
    const sample = { frames: [], longTasks: [], lastFrame: null, frame: 0, observer: null };
    if (PerformanceObserver.supportedEntryTypes.includes("longtask")) {
      sample.observer = new PerformanceObserver(list => sample.longTasks.push(...list.getEntries().map(entry => entry.duration)));
      sample.observer.observe({ entryTypes: ["longtask"] });
    }
    const frame = time => { if (sample.lastFrame != null) sample.frames.push(time - sample.lastFrame); sample.lastFrame = time; sample.frame = requestAnimationFrame(frame); };
    sample.frame = requestAnimationFrame(frame); window.ordoPerformanceSample = sample;
  });
  await action(); await settle(page);
  const sample = await page.evaluate(() => {
    const sample = window.ordoPerformanceSample; cancelAnimationFrame(sample.frame); sample.observer?.disconnect();
    const frames = sample.frames.sort((a, b) => a - b);
    return { frames: frames.length, p95FrameIntervalMs: frames[Math.floor(frames.length * 0.95)] ?? null,
      maxFrameIntervalMs: frames.at(-1) ?? null, longTaskCount: sample.longTasks.length, maxLongTaskMs: Math.max(0, ...sample.longTasks) };
  });
  results.performanceSamples.push({ name, fixtureBookmarks, ...sample });
}

async function selectionPerformance() {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: "dark" });
  await context.addInitScript(() => localStorage.setItem("ordo.settings", JSON.stringify({ themeMode: "dark", expressive: true, materialYouColors: false })));
  const page = await context.newPage(); activePage = page;
  await fixture(page, { bookmarkCount: 1000 }); await login(page); await settle(page);
  const lead = await button(page, `Select ${bookmark.title}`).boundingBox();
  await page.mouse.move(lead.x + lead.width / 2, lead.y + lead.height / 2);
  await page.mouse.down(); await page.waitForTimeout(550); await page.mouse.up(); await settle(page);
  const row = page.getByRole("checkbox", { name: /^Building a more expressive/ });
  await row.evaluate(node => {
    window.selectionLatency = []; let clicked = null;
    node.addEventListener("click", () => { clicked = performance.now(); }, true);
    new MutationObserver(() => {
      if (clicked != null) { window.selectionLatency.push(performance.now() - clicked); clicked = null; }
    }).observe(node, { attributes: true, attributeFilter: ["aria-checked"] });
  });
  await profileAction(page, "20 selection toggles in a 1,000-bookmark fixture", async () => {
    for (let index = 0; index < 20; index++) { await row.click(); await page.waitForTimeout(100); }
  }, 1000);
  const samples = await page.evaluate(() => window.selectionLatency); samples.sort((a, b) => a - b);
  assert.equal(samples.length, 20);
  const deletion = await button(page, "Delete").boundingBox();
  await page.evaluate(() => {
    const node = [...document.querySelectorAll('[role="button"]')].find(node => node.getAttribute("aria-label") === "Delete");
    window.deleteFrames = []; const start = performance.now();
    const sample = time => { const rect = node.getBoundingClientRect(); window.deleteFrames.push({ right: rect.right, width: rect.width });
      if (time - start < 600) requestAnimationFrame(sample); };
    requestAnimationFrame(sample);
  });
  await row.click(); await page.waitForTimeout(750);
  const frames = await page.evaluate(() => window.deleteFrames);
  results.selectionBenchmark = { bookmarks: 1000, toggles: samples.length,
    medianClickToSemanticsMs: samples[Math.floor(samples.length / 2)], p95ClickToSemanticsMs: samples[Math.floor(samples.length * 0.95)],
    deleteRightEdgeDriftPx: Math.max(...frames.map(frame => Math.abs(frame.right - (deletion.x + deletion.width)))) };
  await context.close();
}
async function capture(page, name) {
  await settle(page);
  const content = await page.locator("body").innerText();
  assert.ok(content.trim().length > 0, `${name}: blank screen`);
  assert.ok(!content.includes("Something went wrong"), `${name}: error boundary`);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${name}: horizontal overflow`);
  if (process.env.ORDO_UI_HOVER_AUDIT) await auditStateLayers(page, name);
  await page.screenshot({ path: `${output}/${name}.png` });
  results.screens.push(name);
}

async function auditStateLayers(page, name) {
  const result = await page.evaluate(() => {
    const corners = ["borderTopLeftRadius", "borderTopRightRadius", "borderBottomLeftRadius", "borderBottomRightRadius"];
    const failures = []; let count = 0;
    for (const layer of document.querySelectorAll('[data-testid="material-state-layer"], [data-testid="material-list-state-layer"]')) {
      const parent = layer.parentElement, rect = parent.getBoundingClientRect();
      if (!rect.width || !rect.height || rect.bottom < 0 || rect.top > innerHeight) continue;
      count++;
      const style = getComputedStyle(parent), feedback = getComputedStyle(layer), bounds = layer.getBoundingClientRect();
      if (corners.some(corner => style[corner] !== feedback[corner]) || bounds.x < rect.x - 1 || bounds.right > rect.right + 1 || bounds.y < rect.y - 1 || bounds.bottom > rect.bottom + 1)
        failures.push({ label: parent.getAttribute("aria-label"), surface: corners.map(corner => style[corner]), feedback: corners.map(corner => feedback[corner]) });
      if (parent.getAttribute("aria-disabled") === "true" && +feedback.opacity > 0.001) failures.push({ label: parent.getAttribute("aria-label"), disabledOpacity: feedback.opacity });
    }
    return { count, failures };
  });
  results.hoverSurfaces = (results.hoverSurfaces ?? 0) + result.count;
  assert.deepEqual(result.failures, [], `${name}: hover silhouette ${JSON.stringify(result.failures)}`);
}

async function polishMatrix() {
  for (const theme of process.env.ORDO_UI_THEME ? [process.env.ORDO_UI_THEME] : ["light", "dark"]) for (const expressive of process.env.ORDO_UI_EXPRESSIVE ? [process.env.ORDO_UI_EXPRESSIVE === "true"] : [false, true]) {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: theme });
    await context.addInitScript(({ theme, expressive }) => localStorage.setItem("ordo.settings", JSON.stringify({ themeMode: theme, expressive, materialYouColors: false })), { theme, expressive });
    const page = await context.newPage(); activePage = page;
    await fixture(page, { bookmarkCount: 40 }); await login(page); await settle(page);
    const mode = `${theme}-${expressive ? "expressive" : "standard"}`;
    async function hoverControl(locator, name) {
      await settle(page);
      const before = await locator.boundingBox(); await locator.hover(); await settle(page);
      const after = await locator.boundingBox();
      assert.ok(["x", "y", "width", "height"].every(key => Math.abs(after[key] - before[key]) < 0.5),
        `${name}: hover must not move or resize the target ${JSON.stringify({ before, after })}`);
      await auditStateLayers(page, name); await capture(page, `${mode}-${name}`);
      await page.mouse.move(0, 0); await settle(page);
    }
    const header = page.locator('[data-testid="material-app-bar"]:visible').last();
    assert.equal((await header.boundingBox()).height, 64);
    await hoverControl(button(page, "Account and settings"), "avatar-hover");
    const avatar = button(page, "Account and settings").getByTestId("material-state-layer");
    assert.equal((await avatar.boundingBox()).width, 40);
    await button(page, "Library actions").click();
    const items = page.getByRole("menuitem"); await items.first().waitFor();
    await hoverControl(items.first(), "menu-first-hover"); await hoverControl(items.last(), "menu-last-hover");
    await page.keyboard.press("Escape"); await settle(page);
    await hoverControl(page.getByRole("button", { name: /^Building a more expressive design system, / }), "bookmark-hover");
    const rowFill = page.getByTestId("material-row-state-layer").nth(1);
    const rowClip = await rowFill.evaluate(node => getComputedStyle(node.parentElement).overflow);
    assert.equal(rowClip, "hidden");
    await hoverControl(button(page, "Show bookmarks tagged Design"), "nested-tag-hover");
    assert.ok(await rowFill.evaluate(node => +getComputedStyle(node).opacity < 0.001), "Nested chip must not also hover the whole row");
    await navigate(page, "settings");
    assert.equal((await header.boundingBox()).height, 64);
    await hoverControl(button(page, "Controls"), "settings-group-edge-hover");
    await navigate(page, "settings/account"); await hoverControl(button(page, "Profile picture"), "profile-hover");
    await navigate(page, "settings/appearance");
    await hoverControl(page.getByRole("switch", { name: "Expressive", exact: true }), "switch-hover");
    await navigate(page, "reader/article");
    assert.equal((await header.boundingBox()).height, 64);
    await hoverControl(button(page, "example.test"), "reader-url-hover");
    await hoverControl(button(page, "More article actions"), "reader-overflow-hover");
    await button(page, "More article actions").click();
    await page.getByRole("menuitem", { name: "Open original", exact: true }).click(); await settle(page);
    const browserPane = page.getByTestId("bookmark-browser"); await browserPane.waitFor();
    const headerBox = await header.boundingBox(), browserBox = await browserPane.boundingBox();
    assert.ok(Math.abs(browserBox.y - (headerBox.y + headerBox.height)) < 0.5, "Website host begins flush below its app bar");
    results.interactions.push(`${mode}: browser host has no reserved gap (web placeholder, not a native WebView rendering test)`);
    await navigate(page, "");
    // Enter through the same leading-icon long hold used on native.
    const lead = button(page, `Select ${bookmark.title}`); const leadRect = await lead.boundingBox();
    await page.mouse.move(leadRect.x + leadRect.width / 2, leadRect.y + leadRect.height / 2);
    await page.mouse.down(); await page.waitForTimeout(550); await page.mouse.up(); await settle(page);
    await button(page, "Cancel selection").waitFor();
    const selected = page.getByRole("checkbox", { name: /^Building a more expressive design system, / });
    assert.equal(await selected.getAttribute("aria-checked"), "true");
    const deleting = button(page, "Delete");
    const end = await deleting.boundingBox(); const anchor = end.x + end.width;
    async function sampleToggle(locator, name) {
      const label = await locator.getAttribute("aria-label");
      await page.evaluate(label => {
        const row = [...document.querySelectorAll('[role="checkbox"]')].find(node => node.getAttribute("aria-label") === label);
        const fill = row.parentElement.querySelector('[data-testid="material-row-selection"]');
        const deletion = [...document.querySelectorAll('[role="button"]')].find(node => node.getAttribute("aria-label") === "Delete");
        window.polishFrames = [];
        const start = performance.now();
        const sample = time => { const r = deletion.getBoundingClientRect(); window.polishFrames.push({ elapsed: time - start, right: r.right, width: r.width, opacity: +getComputedStyle(fill).opacity, checked: row.getAttribute("aria-checked") });
          if (time - start < 650) requestAnimationFrame(sample); };
        requestAnimationFrame(sample);
      }, label);
      await locator.click(); await page.waitForTimeout(750);
      const frames = await page.evaluate(() => window.polishFrames);
      assert.ok(frames.length > 10, name);
      assert.ok(frames.every(frame => Math.abs(frame.right - anchor) < 1.1), `${name}: delete right-edge drift ${JSON.stringify(frames)}`);
      assert.ok(frames.some(frame => frame.opacity > 0.01 && frame.opacity < 0.99), `${name}: selection must fade, not jump`);
      results.selectionSamples ??= []; results.selectionSamples.push({ name: `${mode}-${name}`, frames });
    }
    await sampleToggle(selected, "deselect"); assert.equal(await selected.getAttribute("aria-checked"), "false");
    await sampleToggle(selected, "select"); assert.equal(await selected.getAttribute("aria-checked"), "true");
    const readAction = button(page, "Read");
    const readBox = await readAction.boundingBox(), deleteBox = await deleting.boundingBox();
    await page.mouse.move(readBox.x + readBox.width / 2, readBox.y + readBox.height / 2);
    await page.mouse.down(); await settle(page);
    const expandedBox = await readAction.boundingBox(), compressedBox = await deleting.boundingBox();
    assert.ok(expandedBox.width > readBox.width * 1.1, "Standard button groups expand their pressed action in both design modes");
    assert.ok(Math.abs(compressedBox.x + compressedBox.width - deleteBox.x - deleteBox.width) < 1.1, "Pressed toolbar retains right edge");
    await page.mouse.move(0, 0); await page.mouse.up(); await settle(page);
    const folderRow = page.getByRole("checkbox", { name: /^Design & inspiration, / });
    await sampleToggle(folderRow, "mixed-selection");
    assert.equal(await folderRow.getAttribute("aria-checked"), "true");
    for (const viewport of [{ name: "portrait", width: 390, height: 844 }, { name: "landscape", width: 1280, height: 800 }, { name: "constrained", width: 320, height: 420 }]) {
      await page.setViewportSize(viewport); await hoverControl(deleting, `selection-delete-hover-${viewport.name}`);
      await capture(page, `${mode}-selection-${viewport.name}`);
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await page.emulateMedia({ reducedMotion: "reduce" }); await settle(page);
    await selected.click(); await settle(page);
    const fillOpacity = await page.getByTestId("material-row-selection").nth(1).evaluate(node => +getComputedStyle(node).opacity);
    assert.equal(fillOpacity, 0);
    await button(page, "Select all").click(); await settle(page);
    assert.equal(await selected.getAttribute("aria-checked"), "true");
    await button(page, "Deselect all").click(); await settle(page);
    assert.equal(await selected.getAttribute("aria-checked"), "false");
    await selected.focus(); await page.keyboard.press("Space"); await settle(page);
    assert.equal(await selected.getAttribute("aria-checked"), "true");
    await button(page, "Cancel selection").click();
    for (const path of ["folder/collection", "tags/design"]) {
      await navigate(page, path);
      assert.equal((await header.boundingBox()).height, 64);
      const icon = await button(page, `Select ${bookmark.title}`).boundingBox();
      await page.mouse.move(icon.x + icon.width / 2, icon.y + icon.height / 2);
      await page.mouse.down(); await page.waitForTimeout(550); await page.mouse.up(); await settle(page);
      const checkbox = page.getByRole("checkbox", { name: /^Building a more expressive design system, / });
      assert.equal(await checkbox.getAttribute("aria-checked"), "true", `${path}: scoped selection provider`);
      await checkbox.click(); await settle(page); assert.equal(await checkbox.getAttribute("aria-checked"), "false");
      await checkbox.focus(); await page.keyboard.press("Space"); await settle(page); assert.equal(await checkbox.getAttribute("aria-checked"), "true");
      await capture(page, `${mode}-${path.startsWith("folder") ? "folder" : "tag"}-selection`);
      await button(page, "Back").click();
    }
    results.interactions.push(`${mode}: exact hover silhouettes, stable targets, direct selection updates, fading rows, anchored toolbar, consistent app bars and reduced motion`);
    await context.close();
  }
}
async function checkAuthTargets(page) {
  for (const link of await page.getByRole("link").all()) {
    if (["Terms", "Privacy Policy"].includes(await link.getAttribute("aria-label"))) continue; // Inline prose links.
    const rect = await link.boundingBox();
    if (rect) assert.ok(rect.height >= 48, `Auth link target: ${await link.innerText()} (${rect.height})`);
  }
}
async function checkTagDialogSizes(page, mode, name, value) {
  for (const viewport of [{ name: "landscape", width: 1280, height: 800 }, { name: "constrained", width: 320, height: 420 }]) {
    await page.setViewportSize(viewport); await capture(page, `${mode}-${viewport.name}-${name}`);
    const rect = await page.getByRole("dialog").boundingBox();
    assert.ok(rect.y >= 0 && rect.y + rect.height <= viewport.height, `${name}: dialog viewport`);
    assert.equal(await page.getByRole("textbox", { name: "Tag name", exact: true }).inputValue(), value);
    if (viewport.name === "constrained") {
      await button(page, "pink").click();
      assert.equal(await button(page, "pink").getAttribute("aria-selected"), "true");
      const target = await button(page, "pink").boundingBox();
      assert.ok(target.y >= rect.y && target.y + target.height <= rect.y + rect.height, `${name}: last color is reachable`);
      await capture(page, `${mode}-constrained-${name}-last-color`);
    }
  }
  await page.setViewportSize({ width: 390, height: 844 });
}
async function login(page) {
  await page.goto(`${base}/login`);
  await page.getByRole("textbox", { name: "Email", exact: true }).fill(user.email);
  await page.getByRole("textbox", { name: "Password", exact: true }).fill("Test-password-123");
  await button(page, "Sign in").click();
  await button(page, "Account and settings").waitFor();
}
// Expo SecureStore has no web implementation. Keep the fixture login in memory
// and exercise the router, rather than reloading native-only token storage.
async function navigate(page, path) {
  if (await page.getByRole("dialog").count() || await page.getByRole("menu").count()) { await page.keyboard.press("Escape"); await settle(page); }
  for (let i = 0; i < 8; i++) {
    if (await button(page, "Exit search").count()) { await button(page, "Exit search").click(); await settle(page); }
    if (await button(page, "Account and settings").count()) break;
    assert.ok(await button(page, "Back").count(), `${path}: no path back to library`);
    await button(page, "Back").click(); await settle(page);
  }
  if (path === "search") await page.getByRole("textbox", { name: "Search your library", exact: true }).focus();
  else if (path.startsWith("folder/")) await page.getByRole("button", { name: /^Design & inspiration,/ }).click();
  else if (path.startsWith("reader/")) await page.getByRole("button", { name: /^Building a more expressive design system,/ }).click();
  else if (path.startsWith("tags")) {
    await button(page, "Library actions").click(); await page.getByRole("menuitem", { name: "Manage tags", exact: true }).click();
    if (path.includes("/")) await page.getByRole("button", { name: /^Design,/ }).click();
  } else if (path.startsWith("settings")) {
    await button(page, "Account and settings").click();
    const target = path.split("/")[1]?.split("?")[0];
    if (["account", "display-name", "email", "password", "security", "delete-account", "verify-email"].includes(target)) {
      await button(page, "Manage your account").click();
      const label = { "display-name": "Display name", email: "Email", password: "Password", security: "Authenticator", "delete-account": "Delete account", "verify-email": "Email" }[target];
      if (label) await button(page, label).click();
      if (target === "verify-email") {
        await page.getByRole("textbox", { name: "New email", exact: true }).fill("next@example.test");
        await page.getByRole("textbox", { name: "Current password", exact: true }).fill("Test-password-123");
        await button(page, "Send code").click();
      }
    } else if (target) {
      const label = { sessions: "Active sessions", server: "Hosting", appearance: "Appearance", controls: "Controls", data: "Data", about: "About" }[target];
      assert.ok(label, `Missing navigation for ${path}`); await button(page, label).click();
    }
  }
  await settle(page);
  if (await button(page, "Dismiss notification").count()) { await button(page, "Dismiss notification").click(); await settle(page); }
  assert.equal(await button(page, "Sign in").count(), 0, `${path}: authenticated route did not render`);
}
function luminance(color) {
  const values = color.match(/[\d.]+/g).slice(0, 3).map(Number).map(value => value / 255);
  const linear = values.map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
}
async function readerTextMetrics(locator) {
  return locator.evaluate(element => {
    let background = "rgb(255, 255, 255)";
    for (let node = element; node; node = node.parentElement) {
      // FloatingPanel paints its web surface as a sibling of the contents so
      // inputs do not inherit a clipped/opacity-composited caret ancestor.
      const surface = node.getAttribute("role") === "dialog" ? node.firstElementChild : node;
      const candidate = getComputedStyle(surface ?? node).backgroundColor;
      if (candidate !== "transparent" && candidate !== "rgba(0, 0, 0, 0)") { background = candidate; break; }
    }
    const style = getComputedStyle(element);
    return { ink: style.color, background, font: style.fontFamily, size: parseFloat(style.fontSize) };
  });
}
async function checkReaderArticle(page, expectedDark, expectedSize = 17) {
  const paragraph = page.getByText("Plain reader paragraph for contrast.", { exact: true }).first();
  await paragraph.waitFor();
  for (const text of [paragraph, page.getByText("Source styling cannot override the reader.", { exact: true }).first(),
    page.getByRole("link", { name: "library", exact: true }), page.getByText(/^const library =/).first()]) {
    const metrics = await readerTextMetrics(text);
    const a = luminance(metrics.ink), b = luminance(metrics.background);
    assert.ok((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05) >= 4.45, JSON.stringify(metrics));
  }
  const metrics = await readerTextMetrics(paragraph);
  assert.equal(metrics.size, expectedSize);
  assert.equal(luminance(metrics.background) < 0.1, expectedDark, JSON.stringify({ ...metrics,
    deviceDark: await page.evaluate(() => matchMedia("(prefers-color-scheme: dark)").matches) }));
  const sourceStyle = await readerTextMetrics(page.getByText("Source styling cannot override the reader.", { exact: true }).first());
  assert.equal(sourceStyle.size, expectedSize, "Source-site fonts cannot override text size");
  const code = await readerTextMetrics(page.getByText(/^const library =/).first());
  assert.ok(code.font.includes("JetBrainsMono"), JSON.stringify(code));
  const mark = await readerTextMetrics(page.getByText("durable", { exact: true }).first());
  const a = luminance(mark.ink), b = luminance(mark.background);
  assert.ok((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05) >= 4.45, `Saved highlight: ${JSON.stringify(mark)}`);
  const heading = await readerTextMetrics(page.getByText("Reading with purpose", { exact: true }).first());
  assert.ok(heading.size > expectedSize, "Heading keeps its semantic size");
  const image = await page.getByRole("img", { name: "A reading-library illustration", exact: true }).boundingBox();
  assert.ok(image && image.width > 0 && image.width <= Math.min(680, await page.evaluate(() => innerWidth)));
}
async function readerMatrix() {
  for (const theme of ["light", "dark"]) for (const expressive of [false, true]) {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: theme });
    await context.addInitScript(({ theme, expressive }) => localStorage.setItem("ordo.settings", JSON.stringify({ themeMode: theme, expressive, materialYouColors: false })), { theme, expressive });
    const page = await context.newPage(); activePage = page;
    await fixture(page, { richReader: true, readerPreferences: { theme: "sepia" } });
    await login(page); await navigate(page, "reader/article");
    await button(page, "Reader settings").click();
    const group = () => page.getByRole("radiogroup", { name: "Reader theme", exact: true });
    assert.deepEqual(await group().getByRole("radio").evaluateAll(items => items.map(item => item.getAttribute("aria-label"))), ["System", "Light", "Dark"]);
    assert.equal(await group().getByRole("radio", { name: "System", exact: true }).getAttribute("aria-checked"), "true", "Legacy Sepia becomes System");
    for (const choice of ["System", "Light", "Dark"]) {
      const mode = `${theme}-${expressive ? "expressive" : "standard"}-reader-${choice.toLowerCase()}`;
      const dark = choice === "Dark" || choice === "System" && theme === "dark";
      await profileAction(page, `${mode}-theme-change`, () => group().getByRole("radio", { name: choice, exact: true }).click());
      const controls = await readerTextMetrics(page.getByRole("dialog").getByText("Reader", { exact: true }));
      assert.equal(luminance(controls.background) < 0.1, dark, `Reader settings follows the reader: ${JSON.stringify(controls)}`);
      for (const viewport of [{ name: "portrait", width: 390, height: 844 }, { name: "landscape", width: 1280, height: 800 }, { name: "compact", width: 320, height: 420 }]) {
        await page.setViewportSize(viewport); await settle(page);
        if (viewport.name === "compact") {
          const radio = group().getByRole("radio", { name: choice, exact: true });
          await radio.scrollIntoViewIfNeeded();
          const target = await radio.boundingBox(); assert.ok(target.width >= 48 && target.height >= 48, JSON.stringify(target));
          assert.equal(await radio.evaluate(element => element.scrollWidth <= element.clientWidth), true);
        }
        await capture(page, `${mode}-${viewport.name}-controls`);
        const rect = await page.getByRole("dialog").boundingBox();
        assert.ok(rect.y >= 0 && rect.y + rect.height <= viewport.height);
      }
      await page.setViewportSize({ width: 390, height: 844 }); await page.keyboard.press("Escape"); await settle(page);
      await checkReaderArticle(page, dark); await capture(page, `${mode}-portrait-article`);
      await page.setViewportSize({ width: 1280, height: 800 }); await checkReaderArticle(page, dark); await capture(page, `${mode}-landscape-article`);
      await page.setViewportSize({ width: 390, height: 844 }); await button(page, "Reader settings").click();
      results.interactions.push(`${mode}: reader palette, legacy preferences, visible choices, content contrast and three dialog sizes`);
    }
    await group().getByRole("radio", { name: "Dark", exact: true }).click(); await settle(page);
    await page.getByRole("switch", { name: "Reader AMOLED black", exact: true }).click(); await settle(page);
    await page.keyboard.press("Escape"); await settle(page); await checkReaderArticle(page, true);
    await capture(page, `${theme}-${expressive}-reader-amoled`);
    await button(page, "Reader settings").click(); await page.getByRole("switch", { name: "Reader AMOLED black", exact: true }).click();
    for (const readerTheme of ["Light", "Dark"]) {
    await group().getByRole("radio", { name: readerTheme, exact: true }).click();
    for (const font of ["Sans", "Serif", "Mono"]) for (const [size, px] of [["Small", 15], ["Medium", 17], ["Large", 19], ["Extra large", 21]]) {
      await page.getByRole("radiogroup", { name: "Font", exact: true }).getByRole("radio", { name: font, exact: true }).click();
      await page.getByRole("radiogroup", { name: "Text size", exact: true }).getByRole("radio", { name: size, exact: true }).click();
      await settle(page); await page.keyboard.press("Escape"); await settle(page);
      await checkReaderArticle(page, readerTheme === "Dark", px);
      await capture(page, `${theme}-${expressive}-reader-${readerTheme}-${font}-${size.replaceAll(" ", "-")}`);
      await button(page, "Reader settings").click();
    }
    }
    const lightRadio = group().getByRole("radio", { name: "Light", exact: true });
    await lightRadio.click(); await lightRadio.focus(); await lightRadio.press("ArrowRight"); await settle(page);
    assert.equal(await group().getByRole("radio", { name: "Dark", exact: true }).getAttribute("aria-checked"), "true");
    await group().getByRole("radio", { name: "Dark", exact: true }).press("Home"); await settle(page);
    assert.equal(await group().getByRole("radio", { name: "System", exact: true }).getAttribute("aria-checked"), "true");
    await page.keyboard.press("Escape"); await settle(page);
    const opposite = theme === "light" ? "dark" : "light";
    await page.emulateMedia({ colorScheme: opposite, reducedMotion: "reduce" }); await settle(page);
    await capture(page, `${theme}-${expressive}-reader-system-live-change`);
    await checkReaderArticle(page, opposite === "dark", 21);
    await button(page, "More article actions").click(); await page.getByRole("menuitem", { name: "Table of contents", exact: true }).click();
    await capture(page, `${theme}-${expressive}-reader-contents`); await button(page, "Go to Keep exploring").click(); await settle(page);
    await button(page, "More article actions").click(); await page.getByRole("menuitem", { name: "Highlights", exact: true }).click();
    const remove = button(page, "Remove highlight"); const target = await remove.boundingBox(); assert.ok(target.width >= 48 && target.height >= 48);
    await capture(page, `${theme}-${expressive}-reader-highlights`); await remove.click();
    await page.getByText("Select a passage in the article to save it.", { exact: true }).waitFor();
    results.interactions.push(`${theme}-${expressive}: all fonts/sizes, AMOLED, keyboard selection, live System theme, contents and highlight removal`);
    await context.close();
  }
}
try {
  if (process.env.ORDO_UI_READER_ONLY) await readerMatrix();
  else if (process.env.ORDO_UI_SELECTION_PERF) await selectionPerformance();
  else if (process.env.ORDO_UI_POLISH_ONLY) await polishMatrix();
  else for (const theme of process.env.ORDO_UI_THEME ? [process.env.ORDO_UI_THEME] : ["light", "dark"]) for (const expressive of process.env.ORDO_UI_EXPRESSIVE ? [process.env.ORDO_UI_EXPRESSIVE === "true"] : [false, true]) {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: theme });
    await context.addInitScript(({ theme, expressive }) => {
      if (!localStorage.getItem("ordo.settings")) localStorage.setItem("ordo.settings", JSON.stringify({ themeMode: theme, expressive,
        createButtonTapAction: "menu", materialYouColors: false }));
    }, { theme, expressive });
    const page = await context.newPage(); activePage = page; await fixture(page);
    const mode = `${theme}-${expressive ? "expressive" : "standard"}`;
    if (!process.env.ORDO_UI_SKIP_SCREEN_MATRIX) for (const viewport of [{ name: "portrait", width: 390, height: 844 }, { name: "landscape", width: 1280, height: 800 }]) {
      await page.setViewportSize(viewport);
      for (const path of authRoutes) {
        await page.goto(`${base}/${path}`); await page.getByRole("textbox").first().waitFor();
        await page.waitForTimeout(900);
        await capture(page, `${mode}-${viewport.name}-${path.split("?")[0]}`); await checkAuthTargets(page);
      }
    }
    // Error labels attach to the field whose validation failed.
    await page.goto(`${base}/register`);
    await page.getByRole("textbox", { name: "Display name", exact: true }).fill("Alex");
    await page.getByRole("textbox", { name: "Email", exact: true }).fill(user.email);
    await page.getByRole("textbox", { name: "Password", exact: true }).fill("Test-password-123");
    await page.getByRole("textbox", { name: "Confirm password", exact: true }).fill("different");
    await button(page, "Create account").click();
    const confirm = page.getByRole("textbox", { name: "Confirm password", exact: true });
    assert.equal(await confirm.getAttribute("aria-invalid"), "true");
    assert.equal(await page.getByRole("textbox", { name: "Display name", exact: true }).getAttribute("aria-invalid"), "false");
    const messageId = await confirm.getAttribute("aria-describedby");
    assert.equal(await page.locator(`[id="${messageId}"]`).innerText(), "Passwords don't match.");
    results.interactions.push(`${mode}: field error ownership and accessible description`);
    await page.goto(`${base}/mfa?challengeToken=fixture`); await button(page, "Use a backup code").click();
    await button(page, "Back to sign in").click(); await button(page, "Sign in").waitFor();
    results.interactions.push(`${mode}: backup-code sign-in exit`);
    await page.goto(`${base}/reset-password?email=alex%40example.test`);
    await page.getByRole("textbox", { name: "Reset code", exact: true }).fill("123456");
    await page.getByRole("textbox", { name: "New password", exact: true }).waitFor();
    await page.getByRole("textbox", { name: "New password", exact: true }).fill("Test-password-123");
    await page.getByRole("textbox", { name: "New password", exact: true }).press("Enter");
    assert.equal(await page.getByRole("textbox", { name: "Confirm new password", exact: true }).evaluate(el => el === document.activeElement), true);
    await page.getByRole("textbox", { name: "Confirm new password", exact: true }).fill("wrong");
    await button(page, "Reset password").click();
    assert.equal(await page.getByRole("textbox", { name: "Confirm new password", exact: true }).getAttribute("aria-invalid"), "true");
    await page.getByRole("textbox", { name: "Confirm new password", exact: true }).fill("Test-password-123");
    await button(page, "Reset password").click();
    await page.getByRole("alert").waitFor();
    assert.equal(await page.getByRole("alert").innerText(), "That reset code has expired. Request a new code.");
    assert.equal(await page.getByRole("textbox", { name: "Confirm new password", exact: true }).getAttribute("aria-invalid"), "false");
    await capture(page, `${mode}-reset-password-server-error`);
    await page.getByRole("link", { name: "Back to sign in", exact: true }).click();
    results.interactions.push(`${mode}: reset-password second stage, focus progression and failure ownership`);
    await page.getByRole("textbox", { name: "Email", exact: true }).fill(user.email);
    await page.getByRole("textbox", { name: "Email", exact: true }).press("Enter");
    assert.equal(await page.getByRole("textbox", { name: "Password", exact: true }).evaluate(el => el === document.activeElement), true);
    await page.getByRole("textbox", { name: "Password", exact: true }).fill("wrong-password");
    await page.getByRole("textbox", { name: "Password", exact: true }).press("Enter");
    await page.getByRole("alert").waitFor();
    assert.equal(await page.getByRole("alert").innerText(), "Email or password is incorrect.");
    assert.equal(await page.getByRole("textbox", { name: "Email", exact: true }).getAttribute("aria-invalid"), "false");
    await capture(page, `${mode}-login-server-error`);
    results.interactions.push(`${mode}: auth keyboard progression, Enter submission, server failure announcement`);
    await button(page, "Use your own server").click();
    await page.getByRole("dialog", { name: "Use your own server", exact: true }).waitFor();
    assert.equal(await button(page, "Continue").isDisabled(), true);
    await page.getByRole("checkbox").click(); await button(page, "Continue").click();
    const address = page.getByRole("textbox", { name: "Server address", exact: true });
    await address.fill("https://reachable.example.test");
    await page.getByText("Reachable · ordo v0.1.0", { exact: true }).waitFor();
    assert.equal(await button(page, "Connect").isEnabled(), true);
    await address.fill("https://offline.example.test");
    assert.equal(await button(page, "Connect").isDisabled(), true, "A new address must not reuse the previous server's verification");
    await page.getByText("Server responded with HTTP 503.", { exact: true }).waitFor();
    assert.equal(await address.getAttribute("aria-invalid"), "true");
    await capture(page, `${mode}-self-host-server-error`);
    await address.fill("https://");
    await page.getByText("Enter a valid URL.", { exact: true }).waitFor();
    assert.equal(await button(page, "Connect").isDisabled(), true);
    await page.keyboard.press("Escape"); await settle(page);
    results.interactions.push(`${mode}: self-host responsibility gate and address-specific verification failure`);
    await login(page);
    if (!process.env.ORDO_UI_SKIP_SCREEN_MATRIX) for (const viewport of [{ name: "portrait", width: 390, height: 844 }, { name: "landscape", width: 1280, height: 800 }]) {
      await page.setViewportSize(viewport);
      for (const path of appRoutes) {
        await navigate(page, path);
        await page.getByRole("button").first().waitFor(); await page.waitForTimeout(200);
        await capture(page, `${mode}-${viewport.name}-${path.split("?")[0].replaceAll("/", "-") || "library"}`);
      }
    }
    await page.setViewportSize({ width: 390, height: 844 }); await navigate(page, "");
    await profileAction(page, `${mode}: library menu`, () => button(page, "Library actions").click()); await page.getByRole("menu").waitFor();
    await page.keyboard.press("End");
    assert.equal(await page.evaluate(() => document.activeElement?.getAttribute("role")), "menuitem");
    await capture(page, `${mode}-library-menu`); await page.keyboard.press("Escape");
    results.interactions.push(`${mode}: menu keyboard navigation and dismissal`);
    await page.getByTestId("add-bookmark-fab").click(); await page.getByRole("menuitem", { name: "Save bookmark", exact: true }).click();
    await page.getByRole("dialog", { name: "Save bookmark", exact: true }).waitFor();
    await page.getByRole("textbox", { name: "Link", exact: true }).fill("https://example.test/saved");
    await button(page, "Folder, Bookmarks").click(); await page.getByRole("menuitemradio", { name: folder.name, exact: true }).click();
    assert.equal(await page.getByRole("textbox", { name: "Link", exact: true }).inputValue(), "https://example.test/saved");
    for (const viewport of [{ name: "portrait", width: 390, height: 844 }, { name: "landscape", width: 1280, height: 800 }, { name: "constrained", width: 320, height: 420 }]) {
      await page.setViewportSize(viewport); await capture(page, `${mode}-${viewport.name}-save-dialog`);
      const rect = await page.getByRole("dialog").boundingBox();
      assert.ok(rect.y >= 0 && rect.y + rect.height <= viewport.height, `${mode}: dialog viewport`);
    }
    await page.keyboard.press("Escape"); await settle(page);
    results.interactions.push(`${mode}: nested picker preserves draft; dialog fits three sizes`);
    await page.setViewportSize({ width: 390, height: 844 }); await navigate(page, "");
    await page.getByTestId("add-bookmark-fab").click(); await page.getByRole("menuitem", { name: "New folder", exact: true }).click();
    await page.getByRole("textbox", { name: "Name", exact: true }).fill("Ideas for later");
    await page.getByRole("button", { name: /^Icon,/ }).click(); await capture(page, `${mode}-folder-icon-picker`);
    assert.equal(await page.getByRole("dialog").count(), 1); await page.keyboard.press("Escape"); await settle(page);
    assert.equal(await page.getByRole("textbox", { name: "Name", exact: true }).inputValue(), "Ideas for later");
    await capture(page, `${mode}-new-folder-dialog`); await page.keyboard.press("Escape"); await settle(page);
    const folderRow = page.getByRole("button", { name: /^Design & inspiration,/ });
    await folderRow.click({ button: "right" }); await capture(page, `${mode}-folder-menu`);
    await page.getByRole("menuitem", { name: "Rename", exact: true }).click();
    await page.getByRole("dialog", { name: "Rename folder", exact: true }).waitFor();
    assert.equal(await page.getByRole("textbox", { name: "Name", exact: true }).inputValue(), folder.name);
    await capture(page, `${mode}-rename-folder-dialog`); await page.keyboard.press("Escape"); await settle(page);
    await folderRow.click({ button: "right" }); await page.getByRole("menuitem", { name: "Lock folder", exact: true }).click();
    await capture(page, `${mode}-folder-lock-menu`);
    await page.getByRole("menuitem", { name: "Text password", exact: true }).click();
    await page.getByRole("dialog", { name: "Set a password", exact: true }).waitFor();
    await capture(page, `${mode}-folder-password-dialog`); await button(page, "Back").click();
    await page.getByRole("menuitem", { name: "PIN", exact: true }).click();
    await page.getByRole("textbox", { name: "PIN", exact: true }).fill("1234");
    await page.getByRole("dialog", { name: "Confirm PIN", exact: true }).waitFor();
    await capture(page, `${mode}-folder-pin-confirmation`);
    await page.getByRole("textbox", { name: "PIN", exact: true }).fill("9876");
    await page.getByText("PINs do not match. Try again.", { exact: true }).waitFor();
    assert.equal(await page.getByRole("textbox", { name: "PIN", exact: true }).getAttribute("aria-invalid"), "true");
    await button(page, "Back").click(); await page.getByRole("menuitem", { name: "Pattern", exact: true }).click();
    await capture(page, `${mode}-folder-pattern-dialog`); await page.keyboard.press("Escape"); await settle(page);
    await folderRow.click({ button: "right" }); await page.getByRole("menuitem", { name: "Delete folder", exact: true }).click();
    await capture(page, `${mode}-delete-folder-dialog`); await page.keyboard.press("Escape"); await settle(page);
    await page.getByRole("menuitem", { name: "Rename", exact: true }).waitFor();
    await page.keyboard.press("Escape"); await settle(page);
    for (const section of ["Folders", "Bookmarks"]) {
      await button(page, "Library actions").click(); await page.getByRole("menuitem", { name: "Sort library", exact: true }).click();
      await page.getByRole("menuitem", { name: section, exact: true }).click();
      await page.getByRole("menuitemradio").first().waitFor();
      assert.equal(await page.getByRole("menuitemradio").count(), section === "Folders" ? 3 : 4);
      await capture(page, `${mode}-sort-${section.toLowerCase()}`); await page.keyboard.press("Escape"); await settle(page);
    }
    await navigate(page, "tags"); await button(page, "New tag").click();
    await page.getByRole("textbox", { name: "Tag name", exact: true }).fill("Reading notes");
    await capture(page, `${mode}-new-tag-dialog`); await checkTagDialogSizes(page, mode, "new-tag-dialog", "Reading notes");
    await page.keyboard.press("Escape"); await settle(page);
    const tagRow = page.getByRole("button", { name: /^Design,/ });
    await tagRow.click({ button: "right" }); await capture(page, `${mode}-tag-menu`);
    await page.getByRole("menuitem", { name: "Edit tag", exact: true }).click();
    await page.getByRole("dialog", { name: "Edit tag", exact: true }).waitFor(); await settle(page);
    assert.equal(await page.getByRole("textbox", { name: "Tag name", exact: true }).inputValue(), tag.name);
    await capture(page, `${mode}-edit-tag-dialog`); await checkTagDialogSizes(page, mode, "edit-tag-dialog", tag.name);
    await page.keyboard.press("Escape"); await settle(page);
    await tagRow.click({ button: "right" }); await page.getByRole("menuitem", { name: "Delete tag", exact: true }).click();
    await capture(page, `${mode}-delete-tag-dialog`); await page.keyboard.press("Escape"); await settle(page);
    await navigate(page, "");
    results.interactions.push(`${mode}: folder rename, lock methods and PIN mismatch, folder/tag confirmations, sorting radio semantics, persistent tag field labels`);
    const articleRow = page.getByRole("button", { name: /^Building a more expressive design system,/ });
    await articleRow.click({ button: "right" }); await capture(page, `${mode}-bookmark-menu`);
    await page.getByRole("menuitem", { name: "Move to folder", exact: true }).click(); await capture(page, `${mode}-move-picker`);
    await page.keyboard.press("Escape"); await settle(page);
    await articleRow.click({ button: "right" }); await page.getByRole("menuitem", { name: "Edit tags", exact: true }).click();
    await capture(page, `${mode}-edit-tags-dialog`);
    await page.getByRole("textbox", { name: "Find a tag", exact: true }).fill("Failure test");
    await button(page, "Create tag Failure test").click();
    await page.getByText("Couldn't create the tag. Try again.", { exact: true }).waitFor();
    assert.equal(await page.getByRole("textbox", { name: "Find a tag", exact: true }).inputValue(), "Failure test");
    await capture(page, `${mode}-tag-create-error`);
    await page.keyboard.press("Escape"); await settle(page);
    results.interactions.push(`${mode}: quick-tag failure is reported and retains input`);
    if (await button(page, "Dismiss notification").count()) await button(page, "Dismiss notification").click();
    await articleRow.click({ button: "right" }); await page.getByRole("menuitem", { name: "Remind", exact: true }).click();
    await capture(page, `${mode}-reminder-menu`); await page.getByRole("menuitem", { name: "Custom…", exact: true }).click();
    await page.getByRole("textbox", { name: "Reminder date", exact: true }).waitFor();
    await page.getByRole("textbox", { name: "Reminder date", exact: true }).fill("2026-02-31");
    assert.equal(await button(page, "Remind").isDisabled(), true);
    await page.getByRole("textbox", { name: "Reminder date", exact: true }).fill("2099-10-12");
    assert.equal(await button(page, "Remind").isEnabled(), true);
    await capture(page, `${mode}-portrait-custom-reminder-dialog`);
    await page.setViewportSize({ width: 1280, height: 800 });
    await capture(page, `${mode}-landscape-custom-reminder-dialog`);
    const dates = page.getByRole("dialog").getByRole("button").filter({ hasText: /^\d{1,2}$/ });
    for (const date of await dates.all()) { const target = await date.boundingBox(); if (target) assert.ok(target.width >= 48 && target.height >= 48); }
    await page.setViewportSize({ width: 390, height: 844 });
    await page.keyboard.press("Escape"); await settle(page); await page.keyboard.press("Escape"); await settle(page);
    await articleRow.click({ button: "right" }); await page.getByRole("menuitem", { name: "Delete bookmark", exact: true }).click();
    await capture(page, `${mode}-delete-bookmark-dialog`); await page.keyboard.press("Escape"); await settle(page);
    await navigate(page, "search"); await button(page, "Search filters").click(); await capture(page, `${mode}-search-filters`);
    await page.getByRole("menuitem", { name: "Status", exact: true }).click();
    await page.getByRole("menuitemradio").first().waitFor();
    assert.equal(await page.getByRole("menuitemradio").count(), 3);
    await page.getByRole("menuitemradio", { name: "Unread", exact: true }).click(); await page.keyboard.press("Escape"); await settle(page);
    await navigate(page, "reader/article"); await profileAction(page, `${mode}: reader settings`, () => button(page, "Reader settings").click()); await capture(page, `${mode}-reader-controls-default`);
    await profileAction(page, `${mode}: reader font-size change`, () => page.getByRole("radiogroup", { name: "Text size", exact: true }).getByRole("radio", { name: "Extra large", exact: true }).click());
    const selectedSize = page.getByRole("radio", { name: "Extra large", exact: true });
    assert.equal(await selectedSize.getAttribute("aria-checked"), "true");
    assert.equal(await selectedSize.getByTestId("material-segment-check").count(), 1);
    assert.equal(await selectedSize.evaluate(el => getComputedStyle(el).borderTopWidth), expressive ? "0px" : "1px");
    const readerThemes = page.getByRole("radiogroup", { name: "Reader theme", exact: true });
    assert.equal(await readerThemes.getByRole("radio").count(), 3);
    await readerThemes.getByRole("radio", { name: "Light", exact: true }).click(); await settle(page);
    assert.equal(await readerThemes.getByRole("radio", { name: "Light", exact: true }).getAttribute("aria-checked"), "true");
    await capture(page, `${mode}-portrait-reader-controls`);
    await page.setViewportSize({ width: 1280, height: 800 });
    await capture(page, `${mode}-landscape-reader-controls`);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.keyboard.press("Escape"); await settle(page);
    results.interactions.push(`${mode}: creation, icon draft, bookmark actions, move, tags, reminders, destructive confirmation, search filters, reader controls`);
    await page.setViewportSize({ width: 390, height: 844 }); await navigate(page, "settings/account");
    await button(page, "Profile picture").hover();
    assert.equal(await button(page, "Profile picture").evaluate(el => parseFloat(getComputedStyle(el).borderRadius) >= el.getBoundingClientRect().width / 2), true);
    await capture(page, `${mode}-profile-feedback`);
    await button(page, "Profile picture").click(); await capture(page, `${mode}-profile-menu`); await page.keyboard.press("Escape");
    await navigate(page, "settings/appearance"); await page.getByRole("button", { name: /^Theme,/ }).click();
    await page.getByRole("menuitemradio").first().waitFor();
    assert.equal(await page.getByRole("menuitemradio").count(), 3); await page.keyboard.press("Escape");
    results.interactions.push(`${mode}: settings selection exposes radio semantics`);
    const expressiveSwitch = page.getByRole("switch", { name: "Expressive", exact: true });
    const switchTarget = await expressiveSwitch.boundingBox();
    await page.mouse.move(switchTarget.x + switchTarget.width / 2, switchTarget.y + switchTarget.height / 2); await page.mouse.down();
    await page.waitForTimeout(400);
    const pressedHandle = await expressiveSwitch.getByTestId("material-switch-handle").boundingBox();
    assert.ok(Math.abs(pressedHandle.width - 28) < 0.5 && Math.abs(pressedHandle.height - 28) < 0.5);
    await page.mouse.move(1, 1); await page.mouse.up(); await settle(page);
    assert.equal(await expressiveSwitch.getAttribute("aria-checked"), String(expressive));
    await navigate(page, "settings/data");
    await page.getByRole("radiogroup", { name: "Export format", exact: true }).waitFor();
    await button(page, "Include").click();
    await page.getByRole("checkbox", { name: /^Design & inspiration/ }).click();
    assert.equal(await page.getByRole("checkbox", { name: /^Design & inspiration/ }).getAttribute("aria-checked"), "true");
    assert.equal(await page.getByRole("radio", { name: "Entire library", exact: true }).getAttribute("aria-checked"), "false");
    await capture(page, `${mode}-export-folder-selection`);
    const chooser = page.waitForEvent("filechooser"); await button(page, "Import from file, Add bookmarks from JSON, HTML, or CSV.").click();
    await (await chooser).setFiles({ name: "reading.json", mimeType: "application/json", buffer: Buffer.from("[]") });
    await page.getByText("2 new bookmarks", { exact: true }).waitFor();
    await button(page, "Advanced").click();
    await page.getByRole("radiogroup", { name: "Duplicate bookmarks", exact: true }).waitFor();
    await capture(page, `${mode}-import-preview`);
    await button(page, "Import").click(); await page.getByText("Import complete", { exact: true }).waitFor();
    await capture(page, `${mode}-import-complete`); await button(page, "Done").click(); await settle(page);
    results.interactions.push(`${mode}: pressed switch geometry, segmented outlines/checks, reader theme, date input/calendar targets, export selection and import completion`);
    await navigate(page, "settings/sessions"); await button(page, "Revoke").click();
    await capture(page, `${mode}-revoke-dialog`); await page.keyboard.press("Escape");
    await navigate(page, "settings"); await button(page, "Sign out").click();
    await capture(page, `${mode}-signout-dialog`); await page.keyboard.press("Escape");
    await navigate(page, "settings/security"); await button(page, "Set up authenticator").click();
    await capture(page, `${mode}-authenticator-setup`);
    await page.getByRole("textbox", { name: "Authenticator code", exact: true }).fill("123456");
    await page.getByRole("dialog", { name: "Save your backup codes", exact: true }).waitFor();
    await capture(page, `${mode}-backup-codes-dialog`); await page.keyboard.press("Escape");
    results.interactions.push(`${mode}: authenticator enrollment and one-time backup-code surface`);
    await page.emulateMedia({ reducedMotion: "reduce" }); await navigate(page, "");
    await button(page, "Library actions").click(); await capture(page, `${mode}-reduced-motion-menu`); await page.keyboard.press("Escape");
    results.interactions.push(`${mode}: reduced-motion overlay`);
    await context.close();
    for (const state of ["loading", "error"]) {
      const stateContext = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: theme });
      await stateContext.addInitScript(({ theme, expressive }) => localStorage.setItem("ordo.settings", JSON.stringify({ themeMode: theme, expressive, materialYouColors: false })), { theme, expressive });
      const statePage = await stateContext.newPage(); activePage = statePage;
      let release;
      const scenario = { libraryState: state === "loading" ? "empty" : "error",
        gate: state === "loading" ? new Promise(resolve => { release = resolve; }) : null };
      await fixture(statePage, scenario); await login(statePage);
      if (state === "loading") {
        assert.equal(await statePage.getByText("No bookmarks yet", { exact: true }).count(), 0);
        await capture(statePage, `${mode}-library-loading`); release();
      } else {
        await statePage.getByText("Couldn't load bookmarks", { exact: true }).waitFor();
        await capture(statePage, `${mode}-library-error`);
        scenario.libraryState = "empty"; await button(statePage, "Retry").click();
      }
      await statePage.getByText("No bookmarks yet", { exact: true }).waitFor();
      await capture(statePage, `${mode}-library-${state === "loading" ? "empty" : "retry-recovered"}`);
      await button(statePage, "Save bookmark").and(statePage.locator(':not([data-testid="add-bookmark-fab"])')).click();
      await statePage.getByRole("dialog", { name: "Save bookmark", exact: true }).waitFor();
      await statePage.keyboard.press("Escape");
      results.interactions.push(`${mode}: library ${state} to empty and working empty-state action`);
      await stateContext.close();
    }
    const catalogueContext = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: theme });
    await catalogueContext.addInitScript(({ theme, expressive }) => localStorage.setItem("ordo.settings", JSON.stringify({ themeMode: theme, expressive, materialYouColors: false })), { theme, expressive });
    const cataloguePage = await catalogueContext.newPage(); activePage = cataloguePage;
    await fixture(cataloguePage, { catalogue: true }); await login(cataloguePage);
    await navigate(cataloguePage, "search"); await button(cataloguePage, "Search filters").click();
    await cataloguePage.getByRole("menuitem", { name: "Tags", exact: true }).click();
    await cataloguePage.getByRole("textbox", { name: "Filter tags", exact: true }).waitFor();
    const order = await cataloguePage.getByRole("menuitemcheckbox").evaluateAll(items => items.map(item => item.getAttribute("aria-label")));
    await cataloguePage.getByRole("menuitemcheckbox", { name: "Topic 0", exact: true }).click(); await settle(cataloguePage);
    assert.deepEqual(await cataloguePage.getByRole("menuitemcheckbox").evaluateAll(items => items.map(item => item.getAttribute("aria-label"))), order);
    await cataloguePage.getByRole("textbox", { name: "Filter tags", exact: true }).fill("Topic 0");
    await settle(cataloguePage);
    assert.equal(await cataloguePage.getByRole("menuitemcheckbox").count(), 1);
    await capture(cataloguePage, `${mode}-tag-filter-query`);
    await cataloguePage.getByRole("menuitem", { name: "Back", exact: true }).click();
    await cataloguePage.getByRole("menuitem", { name: "Folders", exact: true }).click();
    await cataloguePage.getByRole("textbox", { name: "Filter folders", exact: true }).fill("Design");
    await cataloguePage.getByRole("menuitemcheckbox", { name: folder.name, exact: true }).waitFor();
    await capture(cataloguePage, `${mode}-folder-filter-query`);
    results.interactions.push(`${mode}: larger filter catalogues, named search fields and stable selection order`);
    await catalogueContext.close();
    const importContext = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: theme });
    await importContext.addInitScript(({ theme, expressive }) => localStorage.setItem("ordo.settings", JSON.stringify({ themeMode: theme, expressive, materialYouColors: false })), { theme, expressive });
    const importPage = await importContext.newPage(); activePage = importPage;
    const importScenario = { protected: true };
    await fixture(importPage, importScenario); await login(importPage); await navigate(importPage, "settings/data");
    const importChooser = importPage.waitForEvent("filechooser"); await button(importPage, "Import from file, Add bookmarks from JSON, HTML, or CSV.").click();
    await (await importChooser).setFiles({ name: "reading.json", mimeType: "application/json", buffer: Buffer.from("[]") });
    await importPage.getByText("2 new bookmarks", { exact: true }).waitFor();
    await button(importPage, folder.name).click();
    await importPage.getByRole("textbox", { name: "Password", exact: true }).waitFor();
    assert.equal(await importPage.getByRole("dialog").count(), 1, "Only the unlock surface is exposed");
    await capture(importPage, `${mode}-import-unlock-active`);
    await importPage.keyboard.press("Escape"); await settle(importPage);
    await importPage.getByRole("dialog").waitFor();
    await importPage.getByText("2 new bookmarks", { exact: true }).waitFor();
    await capture(importPage, `${mode}-import-preview-retained`);
    await button(importPage, "Discard").click(); await settle(importPage);
    importScenario.importStatus = "failed";
    const failedChooser = importPage.waitForEvent("filechooser"); await button(importPage, "Import from file, Add bookmarks from JSON, HTML, or CSV.").click();
    await (await failedChooser).setFiles({ name: "broken.json", mimeType: "application/json", buffer: Buffer.from("{") });
    await importPage.getByText("The file could not be parsed. Choose a JSON, HTML, or CSV export.", { exact: true }).waitFor();
    await capture(importPage, `${mode}-import-parse-failure`);
    await button(importPage, "Try again").click(); await settle(importPage);
    results.interactions.push(`${mode}: import parse failure, protected-folder unlock focus ownership and retained preview`);
    await importContext.close();
  }
  assert.deepEqual(results.errors, []);
  console.log(JSON.stringify({ passed: true, screenCount: results.screens.length, interactionCount: results.interactions.length,
    hoverSurfaces: results.hoverSurfaces, selectionBenchmark: results.selectionBenchmark, performanceSamples: results.performanceSamples }, null, 2));
} catch (error) {
  if (activePage && !activePage.isClosed()) {
    await activePage.screenshot({ path: `${output}/failure.png` });
    console.error(activePage.url(), (await activePage.locator("body").innerText()).slice(-5000));
  }
  results.failure = error.stack; console.error(error); process.exitCode = 1;
} finally {
  await writeFile(`${output}/results.json`, JSON.stringify(results, null, 2)); await browser.close();
}
