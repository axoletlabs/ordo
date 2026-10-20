/** Fixture-backed smoothness/seam checks for release-web (not native claims):
 * a compact single-tag WEBSITE library row, multi-select (context-menu Select
 * when present, otherwise the leading press-and-hold) with hover/pressed
 * selection-toolbar seams, and the Save bookmark sheet's folder picker search
 * (never the library search) with draft preservation and keyboard behavior.
 *
 * Export Expo web, serve with SPA fallback, then run:
 * PLAYWRIGHT_MODULE=/tmp/opencode/node_modules/playwright/index.mjs \
 *   ORDO_UI_URL=http://127.0.0.1:8340 node apps/mobile/scripts/smoothness-ui.mjs
 * Default covers dark + current design mode in 390x844 and 1280x800.
 * ORDO_UI_MATRIX=1 covers all 8 (light/dark x standard/expressive x layouts).
 * ORDO_UI_CPU=0 disables CPU throttling (default 4x).
 *
 * Captures per mode: library-tagged, selection-toolbar, selection-toolbar-pressed,
 * save-folder-picker. results.json records checks, seam measurements, and
 * draft-preservation observations for before/after comparison.
 *
 * Overlay locators must respect the app's portal retention: surfaces kept
 * during their exit fade (and dialogs obscured by sibling pickers) carry
 * aria-hidden="true", so scope queries to :not([aria-hidden="true"]) and
 * query the obscured parent only after its picker closes.
 */
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? "playwright");
const base = process.env.ORDO_UI_URL ?? "http://127.0.0.1:8255";
const output = process.env.ORDO_UI_OUTPUT ?? "/tmp/opencode/ordo-smoothness-ui";
const cpuThrottle = Number(process.env.ORDO_UI_CPU ?? 4);
const trace = (...args) => { if (process.env.ORDO_UI_TRACE === "1") console.error(new Date().toISOString().slice(11, 23), ...args); };
const stamp = "2026-10-20T12:00:00Z";

// Fixture: one compact unfiled WEBSITE row tagged "Shopping list" (no
// description), folders worth searching, and CRUD-capable state so the save
// draft flow can create a folder through the picker.
const tagSummary = { id: "shopping", name: "Shopping list", color: "teal" };
const shoppingTag = { ...tagSummary, bookmarkCount: 1, createdAt: stamp, updatedAt: stamp };
const folderIcons = ["book-outline", "reader-outline", "folder-outline", "folder-outline", "bookmark-outline", "newspaper-outline"];
const folderSeed = ["Recipes", "Reading list", "Shopping", "Work projects", "Travel plans", "Archive 2026"].map((name, i) => ({
  id: `folder-${i + 1}`, name, icon: folderIcons[i], pinned: false, protected: false, lockType: null,
  pinLength: null, bookmarkCount: 0, unreadCount: 0, createdAt: stamp, updatedAt: stamp,
}));
const websiteBookmark = {
  id: "grocery", folderId: null, title: "Grocery run", url: "https://shop.example.test/weekly",
  domain: "shop.example.test", description: null, fetchStatus: "unsupported", extractionReason: "not_an_article",
  contentKind: "web", contentKindOverride: null, extractionVersion: null, author: null, publishedAt: null,
  readingTimeMinutes: null, readProgress: 0, completedAt: null, isRead: false, remindAt: null,
  tags: [tagSummary], suggestedTags: [], createdAt: stamp, updatedAt: stamp,
};
const user = { id: "smoothness-fixture", displayName: "Fixture reader", email: "reader@example.test", emailVerified: true,
  hasAvatar: false, mfaEnabled: false, libraryEncrypted: false, canRenameInstance: false, createdAt: stamp,
  preferences: { fontFamily: "sans", fontSize: "medium", lineSpacing: "default", theme: "system", amoled: false } };

const results = { fixture: { folders: folderSeed.length, tags: 1, bookmarks: 1, row: "compact tagged WEBSITE, no description" },
  cpuThrottle, captures: [], modes: [], errors: [] };
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM, args: ["--no-sandbox"] });
const button = (page, name) => page.getByRole("button", { name, exact: true });

async function setup(page, theme, expressive) {
  await page.addInitScript(({ user, theme, expressive }) => {
    localStorage.setItem("ordo.settings", JSON.stringify({ themeMode: theme, expressive, materialYouColors: false,
      serverUrl: "https://fixture.example.test", hapticsEnabled: false }));
    localStorage.setItem("secure.ordo.auth", JSON.stringify({ user, tokens: {
      accessToken: "fixture-access", refreshToken: "fixture-refresh", expiresIn: 86400,
    }, accessExpiresAt: Date.now() + 86400000 }));
  }, { user, theme, expressive });
  page.on("pageerror", error => results.errors.push({ mode: "pageerror", message: error.message }));
  let folders = folderSeed.map(folder => ({ ...folder }));
  let bookmarks = [{ ...websiteBookmark, tags: [{ ...tagSummary }] }];
  let tags = [{ ...shoppingTag }];
  let currentUser = { ...user, preferences: { ...user.preferences } };
  let sequence = 0;
  const now = () => new Date().toISOString();
  await page.route("**/*", async route => {
    const request = route.request(), url = new URL(request.url()), path = url.pathname, method = request.method();
    if (url.origin === new URL(base).origin) return route.continue();
    let body = {};
    try {
      const parsed = request.postDataJSON();
      if (parsed && typeof parsed === "object") body = parsed;
    } catch { body = {}; }
    let payload = { success: true };
    if (path === "/api/auth/me") payload = currentUser;
    else if (path === "/api/auth/refresh") payload = { user: currentUser, tokens: { accessToken: "fixture-access", refreshToken: "fixture-refresh", expiresIn: 86400 } };
    else if (path === "/api/auth/preferences") {
      currentUser = { ...currentUser, preferences: { ...currentUser.preferences, ...body } };
      payload = currentUser;
    }
    else if (path === "/api/server/info") payload = { name: "ordo", version: "0.3.0", reminders: true, folderLockTypes: true };
    else if (path === "/api/folders/batch") {
      const ids = new Set(body.ids ?? []);
      if (body.action === "delete") folders = folders.filter(folder => !ids.has(folder.id));
      else if (body.action === "pin") folders = folders.map(folder => (ids.has(folder.id) ? { ...folder, pinned: !!body.pinned, updatedAt: now() } : folder));
      payload = { updated: ids.size };
    }
    else if (path === "/api/folders" && method === "GET") payload = folders;
    else if (path === "/api/folders" && method === "POST") {
      const folder = { id: `folder-created-${++sequence}`, name: String(body.name ?? "").trim().slice(0, 100) || "Untitled",
        icon: folderIcons.includes(body.icon) ? body.icon : "folder-outline", pinned: false, protected: false, lockType: null,
        pinLength: null, bookmarkCount: 0, unreadCount: 0, createdAt: now(), updatedAt: now() };
      folders = [...folders, folder];
      payload = folder;
    }
    else if (/^\/api\/folders\/[^/]+$/.test(path)) {
      const id = path.split("/")[3];
      const folder = folders.find(entry => entry.id === id);
      if (method === "DELETE") folders = folders.filter(entry => entry.id !== id);
      else if (folder && method === "PATCH") Object.assign(folder, body, { id, updatedAt: now() });
      payload = folder ?? { success: true };
    }
    else if (path === "/api/tags" && method === "GET") payload = tags;
    else if (path === "/api/tags" && method === "POST") {
      const tag = { id: `tag-created-${++sequence}`, name: String(body.name ?? "").trim() || "Untitled",
        color: body.color ?? "blue", bookmarkCount: 0, createdAt: now(), updatedAt: now() };
      tags = [...tags, tag];
      payload = tag;
    }
    else if (/^\/api\/tags\/[^/]+$/.test(path)) {
      const id = path.split("/")[3];
      const tag = tags.find(entry => entry.id === id);
      if (method === "DELETE") tags = tags.filter(entry => entry.id !== id);
      else if (tag && method === "PATCH") Object.assign(tag, body, { id, updatedAt: now() });
      payload = tag ?? { success: true };
    }
    else if (path === "/api/bookmarks/extraction-progress") payload = { pending: 0, total: 1 };
    else if (path === "/api/bookmarks/reminders") payload = [];
    else if (path === "/api/bookmarks/prefetch") payload = { success: true };
    else if (path === "/api/bookmarks/mark-all-read") payload = { updated: bookmarks.length };
    else if (path === "/api/bookmarks/batch") {
      const ids = new Set(body.ids ?? []);
      if (body.action === "move") bookmarks = bookmarks.map(entry => (ids.has(entry.id) ? { ...entry, folderId: body.folderId ?? null, updatedAt: now() } : entry));
      else if (body.action === "delete") bookmarks = bookmarks.filter(entry => !ids.has(entry.id));
      else if (body.action === "markRead" || body.action === "markUnread") bookmarks = bookmarks.map(entry => (ids.has(entry.id) ? { ...entry, isRead: body.action === "markRead", updatedAt: now() } : entry));
      payload = { updated: ids.size };
    }
    else if (path === "/api/bookmarks/search") {
      const query = (url.searchParams.get("q") ?? "").trim().toLocaleLowerCase();
      payload = { items: bookmarks.filter(entry => !query || entry.title.toLocaleLowerCase().includes(query) || entry.domain.includes(query)),
        nextCursor: null, hasMore: false };
    }
    else if (path === "/api/bookmarks" && method === "GET") {
      const folderId = url.searchParams.get("folderId");
      const items = bookmarks.filter(entry => (folderId === null ? entry.folderId === null : entry.folderId === folderId));
      payload = { items, nextCursor: null, hasMore: false };
    }
    else if (path === "/api/bookmarks" && method === "POST") {
      const raw = String(body.url ?? "").trim();
      const created = { ...websiteBookmark, id: `created-${++sequence}`, url: raw, domain: new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`).hostname,
        title: new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`).hostname, folderId: body.folderId ?? null,
        tags: (body.tagIds ?? []).map(id => tags.find(tag => tag.id === id)).filter(Boolean),
        fetchStatus: "pending", extractionReason: null, contentKind: null, createdAt: now(), updatedAt: now() };
      bookmarks = [created, ...bookmarks];
      payload = created;
    }
    else if (path.startsWith("/api/bookmarks/article") || /^\/api\/bookmarks\/[^/]+$/.test(path)) {
      const id = path.split("/")[3];
      const entry = bookmarks.find(item => item.id === id);
      if (method === "DELETE") bookmarks = bookmarks.filter(item => item.id !== id);
      else if (entry && method === "PATCH") Object.assign(entry, body, { id, updatedAt: now() });
      payload = entry ? { ...entry, contentHtml: "<p>Fixture article body.</p>", highlights: [] } : { success: true };
    }
    else if (url.hostname === "api.github.com") payload = [];
    if (url.hostname === "www.google.com") return route.fulfill({ contentType: "image/svg+xml", body: '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"/>' });
    await route.fulfill({ contentType: "application/json", status: 200, headers: { "access-control-allow-origin": "*" }, body: JSON.stringify(payload) });
  });
}

try {
  const matrix = process.env.ORDO_UI_MATRIX === "1";
  const themes = matrix ? ["dark", "light"] : ["dark"];
  const designs = matrix ? [true, false] : [true];
  const viewports = [{ width: 390, height: 844 }, { width: 1280, height: 800 }];
  for (const theme of themes) {
    for (const expressive of designs) {
      for (const viewport of viewports) {
        const mode = `${theme}-${expressive ? "expressive" : "standard"}-${viewport.width}`;
        const context = await browser.newContext({ viewport, colorScheme: theme });
        const page = await context.newPage();
        page.setDefaultTimeout(20000);
        await setup(page, theme, expressive);
        if (cpuThrottle > 0) {
          const session = await context.newCDPSession(page);
          await session.send("Emulation.setCPUThrottlingRate", { rate: cpuThrottle });
        }
        const modeResult = { mode, checks: {}, measures: {}, notes: {} };
        results.modes.push(modeResult);
        const check = (ok, label) => { modeResult.checks[label] = !!ok; assert.ok(ok, `${mode}: ${label}`); };
        const note = (label, value) => { modeResult.notes[label] = value; };
        const step = (...args) => trace(mode, ...args);
        const capture = async (name, settleMs) => {
          if (settleMs) await page.waitForTimeout(settleMs);
          await page.screenshot({ path: `${output}/${mode}-${name}.png` });
          results.captures.push(`${mode}-${name}.png`);
        };
        const phase = async (label, run) => {
          try { trace(mode, "phase start", label); await run(); trace(mode, "phase done", label); }
          catch (error) {
            results.errors.push({ mode, phase: label, message: error?.message ?? String(error) });
            await page.screenshot({ path: `${output}/${mode}-${label}-failure.png` }).catch(() => {});
            await writeFile(`${output}/${mode}-${label}-failure.txt`, await page.locator("body").innerText().catch(() => "Page unavailable")).catch(() => {});
          }
        };
        // Only active overlays: retained exits carry aria-hidden="true".
        const activeMenu = () => page.locator('[role="menu"]:not([aria-hidden="true"])');

        try {
          await page.goto(base);
          await phase("library", async () => {
            await button(page, "Account and settings").waitFor();
            await page.getByRole("button", { name: /^Grocery run, shop\.example\.test/ }).waitFor();
            await page.getByText("Shopping list", { exact: true }).first().waitFor();
            await page.getByText("Recipes", { exact: true }).first().waitFor();
            await page.waitForTimeout(2500); // settle fonts/skeletons before judging the row
            const row = page.getByRole("button", { name: /^Grocery run, shop\.example\.test/ }).first();
            const label = await row.getAttribute("aria-label");
            check(label.includes("Tag Shopping list"), "row exposes its single tag");
            check(label.includes("Opens as website"), "row exposes WEBSITE kind");
            check(label.includes("Unread"), "row exposes unread state");
            // Live DOM geometry: the compact tagged row is exactly one 104dp
            // cell (standard font sizes) and the inline chip target stays 32dp
            // with its 48dp target carried by hitSlop, not layout.
            const rowEl = page.getByTestId("bookmark-row").first();
            await rowEl.waitFor();
            const rowBox = await rowEl.boundingBox();
            modeResult.measures.rowHeight = rowBox?.height;
            check(!!rowBox && Math.abs(rowBox.height - 104) <= 1, "tagged row is exactly 104dp tall");
            const chip = page.getByRole("button", { name: "Show bookmarks tagged Shopping list" });
            const chipBox = await chip.boundingBox();
            modeResult.measures.chipHeight = chipBox?.height;
            modeResult.measures.chipWidth = chipBox?.width;
            check(!!chipBox && Math.abs(chipBox.height - 32) <= 1, "inline tag chip target is 32dp tall");
            check(await page.getByTestId("bookmark-unread-indicator").count() >= 1, "unread dot rendered");
            await capture("library-tagged");
          });

          await phase("selection", async () => {
            const row = page.getByRole("button", { name: /^Grocery run, shop\.example\.test/ }).first();
            await row.click({ button: "right" });
            await activeMenu().waitFor();
            const selectItem = activeMenu().locator('[role="menuitem"], [role="menuitemradio"], [role="menuitemcheckbox"]').filter({ hasText: /^\s*Select\b/ });
            if (await selectItem.count()) {
              note("selectionEntry", "context-menu Select");
              await selectItem.first().click();
            } else {
              note("selectionEntry", "leading press-and-hold");
              await page.keyboard.press("Escape");
              await page.waitForTimeout(500);
              const lead = page.getByRole("button", { name: /^Select Grocery run/ });
              const hold = async holdMs => {
                const box = await lead.boundingBox();
                await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
                await page.mouse.down();
                await page.waitForTimeout(holdMs);
                await page.mouse.up();
              };
              await hold(750);
              try { await page.getByText("1 selected", { exact: true }).waitFor({ timeout: 2500 }); }
              catch { await hold(1000); }
            }
            await page.getByText("1 selected", { exact: true }).waitFor();
            await button(page, "Cancel selection").waitFor();
            const move = button(page, "Move");
            await move.waitFor();
            for (const label of ["Read", "More", "Delete"]) await button(page, label).waitFor();
            // Hover seam: state layer on one pill, neighbors at rest.
            await move.hover();
            await page.waitForTimeout(600);
            const restBox = await move.boundingBox();
            modeResult.measures.pillWidthRest = restBox?.width;
            await capture("selection-toolbar");
            // Pressed seam: 15% expansion + adjacent compression mid-hold.
            await page.mouse.down();
            await page.waitForTimeout(700);
            const pressedBox = await move.boundingBox();
            modeResult.measures.pillWidthPressed = pressedBox?.width;
            await capture("selection-toolbar-pressed");
            await page.mouse.up();
            const moveDialog = page.getByRole("dialog", { name: "Move to folder" });
            await moveDialog.waitFor();
            await page.keyboard.press("Tab");
            await page.waitForTimeout(250);
            check(await moveDialog.evaluate(node => node.contains(document.activeElement)), "Tab keeps focus inside the move sheet");
            await page.keyboard.press("Escape");
            await page.waitForTimeout(600);
            check(await page.getByRole("dialog", { name: "Move to folder" }).count() === 0, "Escape releases the move sheet");
            await page.keyboard.press("Escape");
            await page.waitForTimeout(600);
            check(await button(page, "Move").count() === 0, "Escape exits selection and drops the toolbar");
            check(await page.getByRole("textbox", { name: "Search your library" }).count() === 1, "library search bar returns after selection");
          });

          await phase("save-picker", async () => {
            const typedUrl = "shop.example.test/grocery-run";
            const openSaveSheet = async () => {
              const fab = (await page.getByTestId("add-bookmark-fab").count()) ? page.getByTestId("add-bookmark-fab")
                : page.getByRole("button", { name: /^(Save bookmark|Create|New folder)$/ }).first();
              await fab.click();
              const item = activeMenu().getByRole("menuitem", { name: "Save bookmark", exact: true });
              if (await item.count()) await item.first().click();
              await page.getByRole("dialog", { name: "Save bookmark" }).waitFor();
            };
            await openSaveSheet();
            const link = page.getByRole("textbox", { name: "Link", exact: true });
            await link.waitFor();
            const focused = await page.waitForFunction(
              () => document.activeElement?.getAttribute("aria-label") === "Link", null, { timeout: 5000 },
            ).then(() => true, () => false);
            check(focused, "Save bookmark opens with the URL field focused");
            await link.fill(typedUrl);
            const librarySearch = page.getByRole("textbox", { name: "Search your library" });
            const folderField = () => page.getByRole("button", { name: /^Folder, / });
            await folderField().click();
            const picker = activeMenu();
            await picker.waitFor();
            const search = page.getByRole("textbox", { name: "Find a folder" });
            await search.waitFor();
            check((await librarySearch.count()) <= 1, "library search stays a single field while the picker is open");
            // Measure the painted field, not the input's inner text padding:
            // internal padding can pass while the container touches the menu.
            const menuBox = await picker.boundingBox();
            const searchBox = await search.evaluate(node => {
              const rect = node.parentElement.getBoundingClientRect();
              return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
            });
            const insets = {
              left: searchBox.x - menuBox.x,
              right: menuBox.x + menuBox.width - (searchBox.x + searchBox.width),
              top: searchBox.y - menuBox.y,
              bottom: menuBox.y + menuBox.height - (searchBox.y + searchBox.height),
            };
            const padding = await search.evaluate(node => {
              const box = node.parentElement;
              const style = getComputedStyle(box);
              return { left: parseFloat(style.paddingLeft), right: parseFloat(style.paddingRight) };
            });
            modeResult.measures.pickerSearchInsets = insets;
            modeResult.measures.pickerSearchPadding = padding;
            check(insets.left >= -0.5 && insets.right >= -0.5, "picker search stays inside the menu surface");
            check(insets.left >= 15.5 && insets.right >= 15.5, "painted picker search keeps 16dp outer insets");
            check(padding.left >= 15.5 && padding.right >= 15.5, "picker search keeps 16dp content insets");
            // Filter through the picker search, never the library search.
            await search.fill("rec");
            await page.waitForTimeout(400);
            await picker.getByRole("menuitemradio", { name: "Recipes", exact: true }).waitFor();
            check(await picker.getByRole("menuitemradio", { name: "Reading list", exact: true }).count() === 0, "picker search filters non-matching folders out");
            check(await picker.getByRole("menuitemradio", { name: "Bookmarks", exact: true }).count() === 0, "picker search hides the root row when it does not match");
            check((await librarySearch.count()) === 0 || (await librarySearch.inputValue()) === "", "typing in the picker never touches the library search");
            await capture("save-folder-picker", 2500);
            // Active keyboard: Tab stays in the menu, Escape closes only the picker.
            check(await picker.evaluate(node => node.contains(document.activeElement)), "picker search owns keyboard focus");
            await page.keyboard.press("Tab");
            await page.waitForTimeout(250);
            check(await picker.evaluate(node => node.contains(document.activeElement)), "Tab keeps focus inside the picker with the keyboard active");
            await page.keyboard.press("Escape");
            await page.waitForTimeout(600);
            check(await activeMenu().count() === 0, "Escape dismisses the folder picker only");
            const sheet = page.getByRole("dialog", { name: "Save bookmark" });
            check(await sheet.count() === 1, "save sheet survives picker dismissal");
            check((await link.inputValue()) === typedUrl, "typed URL preserved after picker dismiss");
            // Reopen: draft (typed URL) must survive dismiss/reopen of the picker.
            // The sheet behind an open picker is aria-hidden, so read the URL
            // after closing the picker again.
            await folderField().click();
            await picker.waitFor();
            await search.waitFor();
            note("pickerQueryAfterReopen", await search.inputValue());
            await page.keyboard.press("Escape");
            await page.waitForTimeout(600);
            check(await activeMenu().count() === 0, "reopened picker dismisses again");
            check((await page.getByRole("textbox", { name: "Link", exact: true }).inputValue()) === typedUrl, "typed URL preserved after picker reopen");
            await folderField().click();
            await picker.waitFor();
            await picker.getByRole("menuitemradio", { name: "Recipes", exact: true }).click();
            await page.waitForTimeout(500);
            await page.getByRole("button", { name: "Folder, Recipes" }).waitFor();
            // Folder CRUD from the picker keeps the save draft alive.
            await folderField().click();
            await picker.waitFor();
            await picker.getByRole("menuitem", { name: "New folder", exact: true }).click();
            const createDialog = page.getByRole("dialog", { name: "New folder" });
            await createDialog.waitFor();
            await createDialog.getByRole("textbox", { name: "Name", exact: true }).fill("Draft picks");
            await createDialog.getByRole("button", { name: "Create folder", exact: true }).click();
            await page.getByRole("button", { name: "Folder, Draft picks" }).waitFor({ timeout: 8000 });
            check((await page.getByRole("textbox", { name: "Link", exact: true }).inputValue()) === typedUrl, "typed URL survives folder creation");
            await sheet.getByRole("button", { name: "Cancel", exact: true }).click();
            await page.waitForTimeout(700);
            check(await page.getByRole("dialog", { name: "Save bookmark" }).count() === 0, "Cancel closes the save sheet");
            step("reopening save sheet after cancel");
            await openSaveSheet();
            step("save sheet reopened, reading url");
            note("urlAfterSheetReopen", await page.getByRole("textbox", { name: "Link", exact: true }).inputValue());
            step("url after sheet reopen noted");
            // Reduced motion: Escape still closes picker then sheet, in order.
            await page.emulateMedia({ reducedMotion: "reduce" });
            step("reduced motion on, opening picker");
            await folderField().click();
            await picker.waitFor();
            await page.keyboard.press("Escape");
            await page.waitForTimeout(400);
            check(await activeMenu().count() === 0, "reduced motion: Escape still releases the picker");
            await page.keyboard.press("Escape");
            await page.waitForTimeout(400);
            check(await page.getByRole("dialog", { name: "Save bookmark" }).count() === 0, "reduced motion: Escape still closes the save sheet");
            const libraryField = page.getByRole("textbox", { name: "Search your library", exact: true });
            await libraryField.fill("Grocery");
            await page.waitForTimeout(500);
            const ringOpacity = () => page.getByTestId("library-search-focus-ring").evaluate(node => Number(getComputedStyle(node).opacity));
            check(await ringOpacity() > 0.99, "library ring appears on actual search focus");
            await openSaveSheet();
            await page.getByRole("textbox", { name: "Link", exact: true }).focus();
            await page.waitForTimeout(250);
            check(await ringOpacity() < 0.01, "background library ring clears when the save dialog takes focus");
            check(await libraryField.inputValue() === "Grocery", "opening a save dialog preserves the active library query");
            await page.keyboard.press("Escape");
            await page.waitForTimeout(400);
            await libraryField.focus();
            check(await libraryField.inputValue() === "Grocery", "resuming library search preserves the query");
            check(await ringOpacity() > 0.99, "library ring returns on real refocus");
          });

          console.log(JSON.stringify({ mode, checks: modeResult.checks, measures: modeResult.measures, notes: modeResult.notes }));
        } finally { await context.close(); }
      }
    }
  }
  assert.deepEqual(results.errors, [], "Smoothness fixture phases must pass");
} finally {
  await writeFile(`${output}/results.json`, JSON.stringify(results, null, 2));
  await browser.close();
}
