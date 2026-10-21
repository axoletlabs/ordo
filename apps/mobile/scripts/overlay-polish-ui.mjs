#!/usr/bin/env node
/**
 * Fixture-backed overlay polish regression/performance harness for the Expo web
 * export. It is intentionally web-only: it never claims native frame rate,
 * native gestures, or native Focus behavior.
 *
 * RUN (no build/server is started here; use an existing export + server):
 *   PLAYWRIGHT_MODULE=/tmp/opencode/node_modules/playwright/index.mjs \
 *   ORDO_UI_URL=http://127.0.0.1:8355 \
 *   node apps/mobile/scripts/overlay-polish-ui.mjs
 *
 * Defaults: dark + Expressive in portrait 390x844 (touch) and wide 1280x800
 * (mouse), 4x CPU throttle, one repeat. Every HTTP response is mocked locally.
 *
 * ORDO_UI_MATRIX=1   full matrix: light/dark x standard/expressive x portrait/
 *                    wide (8 modes), plus reduced-motion dark-expressive in both
 *                    layouts (10 total). Default remains dark portrait + wide.
 * ORDO_UI_REDUCED=0 with ORDO_UI_MATRIX=1 skips the two reduced-motion modes.
 * ORDO_UI_REPEATS=N  repeats each configuration (report keeps every repeat).
 * ORDO_UI_CPU=N      Chromium CPU throttle rate; 0 disables throttling.
 * ORDO_UI_BOOKMARKS=N fixture library size (default 300).
 * ORDO_UI_OUTPUT=... output directory (default /tmp/opencode/ordo-overlay-polish).
 * ORDO_UI_CAPTURE_MS=... extra settle time before a *screenshot only* (default
 *                    450). It is never part of a timing measurement.
 * ORDO_UI_MAX_FIRST_MS / ORDO_UI_MAX_SETTLE_MS  budgets (defaults 2500/6000).
 *
 * Coverage:
 *   - click -> first painted frame and a separate entrance-settled duration for
 *     library overflow, reader overflow, reader settings, TOC (overflow handoff
 *     and FAB), highlights, Save sheet and the folder picker;
 *   - real mouse/touch long-hold on bookmark body and folder body opens the
 *     context menu while the pointer is still down (right-click is not the only
 *     path). A rAF sampler records the RowHighlight first child's computed
 *     color/opacity (plus the selection/state layers) from pointerdown through
 *     the menu handoff to pointerup. It quantifies the highlight handoff and
 *     fails on a post-open opacity drop/flash, navigation, or a lost row/body;
 *   - leading-icon long-hold enters selection instead of the context menu;
 *   - focused menu item + immediate pointerdown/up still hands off to its dialog;
 *   - library search focused -> Save -> Folders -> click outside the Save card:
 *     focus must return to Link, never the background library search;
 *   - article remains mounted/visible behind open overlays; no blank/black
 *     frames, no invisible backdrop orphan, no retained inert background;
 *   - a completed article opens at scroll top with a zero progress bar, while
 *     a partially-read article restores and paints its acknowledged position;
 *   - rapid open/Escape/reopen during the exit fade for reader overflow and
 *     reader settings, plus the built-in overflow -> Contents handoff;
 *   - zero console/page errors.
 *
 * Screenshots: dark portrait/wide settled states, plus screencast frame
 * sequences for the body long-hold and the overflow -> Contents handoff in dark
 * modes. Every saved frame is decoded and checked for a non-blank/non-black
 * image. results.json records samples, checks, frame health and failure data.
 *
 * The harness never edits production files and never calls a real API.
 */
import assert from "node:assert/strict";
import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { PNG } from "pngjs";

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? "playwright");
const base = (process.env.ORDO_UI_URL ?? "http://127.0.0.1:8355").replace(/\/+$/, "");
const output = process.env.ORDO_UI_OUTPUT ?? "/tmp/opencode/ordo-overlay-polish";
const previousFiles = /^(?:dark|light)-(?:expressive|standard)-\d+(?:-reduced)?(?:-r\d+)?-.*\.(?:png|txt|json)$|^results\.json$/;
const cpuThrottle = Number(process.env.ORDO_UI_CPU ?? 4);
const repeats = Math.max(1, Number(process.env.ORDO_UI_REPEATS ?? 1));
const fixtureBookmarks = Math.max(12, Number(process.env.ORDO_UI_BOOKMARKS ?? 300));
const matrix = process.env.ORDO_UI_MATRIX === "1";
const reducedMatrix = matrix && process.env.ORDO_UI_REDUCED !== "0";
const captureSettleMs = Number(process.env.ORDO_UI_CAPTURE_MS ?? 450);
const maxFirstMs = Number(process.env.ORDO_UI_MAX_FIRST_MS ?? 2500);
const maxSettleMs = Number(process.env.ORDO_UI_MAX_SETTLE_MS ?? 6000);
const keepOutput = process.env.ORDO_UI_KEEP_OUTPUT === "1";
const stamp = "2026-10-20T12:00:00Z";
const HIDDEN_FOCUS_MS = 60;

const LAYOUTS = [
  { name: "portrait-390", viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true },
  { name: "wide-1280", viewport: { width: 1280, height: 800 }, hasTouch: false, isMobile: false },
];
const matrixModes = ["dark", "light"].flatMap((theme) =>
  [true, false].flatMap((expressive) => LAYOUTS.map((layout) => ({ theme, expressive, layout, reducedMotion: false }))));
const reducedModes = reducedMatrix
  ? LAYOUTS.map((layout) => ({ theme: "dark", expressive: true, layout, reducedMotion: true }))
  : [];
const MODES = (matrix ? [...matrixModes, ...reducedModes] : [
  { theme: "dark", expressive: true, layout: LAYOUTS[0], reducedMotion: false },
  { theme: "dark", expressive: true, layout: LAYOUTS[1], reducedMotion: false },
]).map((mode) => ({
  ...mode,
  id: `${mode.theme}-${mode.expressive ? "expressive" : "standard"}-${mode.layout.viewport.width}${mode.reducedMotion ? "-reduced" : ""}`,
}));

/* ------------------------------------------------------------------ */
/* Fixtures                                                            */
/* ------------------------------------------------------------------ */

const folderNames = ["Recipes", "Reading list", "Shopping", "Work projects", "Travel plans", "Archive 2026"];
const folderSeed = folderNames.map((name, index) => ({
  id: `folder-${index + 1}`,
  name,
  icon: ["book-outline", "reader-outline", "folder-outline", "briefcase-outline", "airplane-outline", "archive-outline"][index],
  pinned: index === 1,
  protected: false,
  lockType: null,
  pinLength: null,
  bookmarkCount: index === 0 ? 2 : 0,
  unreadCount: 0,
  createdAt: stamp,
  updatedAt: stamp,
}));
const tagSeed = [
  { id: "tag-design", name: "Design", color: "blue", bookmarkCount: 0, createdAt: stamp, updatedAt: stamp },
  { id: "tag-reading", name: "Reading", color: "teal", bookmarkCount: 0, createdAt: stamp, updatedAt: stamp },
];
const user = {
  id: "overlay-polish-fixture",
  displayName: "Fixture reader",
  email: "reader@example.test",
  emailVerified: true,
  hasAvatar: false,
  mfaEnabled: false,
  libraryEncrypted: false,
  canRenameInstance: false,
  createdAt: stamp,
  preferences: { fontFamily: "sans", fontSize: "medium", lineSpacing: "default", theme: "system", amoled: false },
};
const serverInfo = {
  name: "Fixture Ordo",
  version: "0.3.0",
  registrationEnabled: true,
  emailVerificationRequired: false,
  smtpConfigured: false,
  profilePictureMaxBytes: 2 * 1024 * 1024,
  avatarAllowAnimated: false,
  mfaRequired: false,
  folderLockTypes: true,
  reminders: true,
};

const articleContent = Array.from({ length: 80 }, (_, index) => {
  const section = index + 1;
  return `<h2>Section ${section}</h2><p>Section ${section} marker sentence. ${"An article should remain responsive while opening its controls. ".repeat(10)}</p>`;
}).join("");
const highlightSeed = [
  {
    id: "highlight-2",
    exact: "Section 2 marker sentence.",
    prefix: "Section 2",
    suffix: "An article should remain",
    href: null,
    createdAt: stamp,
  },
  {
    id: "highlight-5",
    exact: "Section 5 marker sentence.",
    prefix: "Section 5",
    suffix: "An article should remain",
    href: "https://example.test/source",
    createdAt: stamp,
  },
];
const articleSeed = (id, title, readProgress, isRead) => ({
  id,
  folderId: null,
  title,
  url: `https://example.test/${id}`,
  domain: "example.test",
  description: "A saved article for overlay polish checks.",
  fetchStatus: "ok",
  extractionReason: null,
  contentKind: "article",
  contentKindOverride: null,
  extractionVersion: 1,
  author: "Fixture author",
  publishedAt: stamp,
  readingTimeMinutes: 4,
  readProgress,
  completedAt: isRead ? stamp : null,
  isRead,
  remindAt: null,
  tags: id === "overlay-main" ? [{ ...tagSeed[0] }] : [],
  suggestedTags: [],
  createdAt: id === "overlay-main" ? stamp : new Date(Date.parse(stamp) - 60_000).toISOString(),
  updatedAt: stamp,
});
const mainArticle = articleSeed("overlay-main", "Overlay polish article", 0, false);
const partialArticle = articleSeed("overlay-partial", "Partial restore article", 0.42, false);
const completeArticle = articleSeed("overlay-complete", "Complete restore article", 1, true);
const extraBookmarks = Array.from({ length: Math.max(0, fixtureBookmarks - 3) }, (_, index) => ({
  ...articleSeed(`saved-${index}`, `Saved reading ${index + 1}`, 0, false),
  tags: [],
  createdAt: new Date(Date.parse(stamp) - (index + 2) * 60_000).toISOString(),
}));

const results = {
  kind: "overlay-polish-ui web regression/performance harness",
  nativeClaim: false,
  platform: "Expo web export in headless Chromium",
  baseUrl: base,
  startedAt: new Date().toISOString(),
  environment: {
    cpuThrottle,
    repeats,
    matrix,
    reducedMatrix,
    fixtureBookmarks,
    captureSettleMs,
    hiddenFocusThresholdMs: HIDDEN_FOCUS_MS,
    budgets: { firstVisibleMs: maxFirstMs, settleMs: maxSettleMs },
    measurement: {
      firstVisibleMs: "real click event -> first rAF with effective opacity >0.01 and a non-zero target rect; Playwright click/poll waits are outside the measured interval",
      settleMs: "same click event -> effective opacity >=0.995 and a rect stable for three rAFs; separate from first paint",
      baselineComparable: "frozen and current runs use the same in-page start event, target match and budgets",
    },
    note: "Screenshot settle time is capture-only and never contributes to timing samples.",
  },
  fixture: {
    articles: [mainArticle.title, partialArticle.title, completeArticle.title],
    folders: folderSeed.length,
    tags: tagSeed.length,
    highlights: highlightSeed.length,
    libraryRows: fixtureBookmarks,
  },
  coverage: [
    "click -> first painted frame + separate settled duration",
    "library overflow vs reader overflow",
    "real touch/mouse body long-hold -> bookmark and folder context menus",
    "RowHighlight first-child color/opacity rAF handoff trace",
    "leading-icon long-hold -> selection (different path)",
    "focused menu item immediate pointerdown/up handoff",
    "Save -> Folders -> outside click -> Link focus, not library search",
    "TOC via overflow handoff and via FAB",
    "highlights panel",
    "reader settings open + one text-size change",
    "rapid open/Escape/reopen during exit",
    "article present behind overlays, blank/black frame detection",
    "no invisible backdrop/inert orphan after exit",
    "progress=1 and partial stored-progress restore, bar at top",
    "zero console/page errors",
  ],
  unsupported: [
    "native frame rate, native gesture recognition and native focus behavior (this is a web export harness)",
    "Android hardware Back and native IME/keyboard viewport shrink",
    "touch pressure, radius and haptic feedback semantics",
    "pixel-diff against a design baseline; captures only fail on blank/near-uniform/black frames",
    "reduced motion beyond prefers-reduced-motion media emulation",
  ],
  modes: [],
  samples: [],
  captures: [],
  frameSequences: [],
  errors: [],
};
await mkdir(output, { recursive: true });
if (!keepOutput) {
  const previous = await readdir(output).catch(() => []);
  for (const name of previous) {
    if (name === "frames" || previousFiles.test(name)) {
      await rm(`${output}/${name}`, { recursive: true, force: true }).catch(() => {});
    }
  }
}

/* ------------------------------------------------------------------ */
/* Page init scripts                                                   */
/* ------------------------------------------------------------------ */

function focusProbeInit() {
  const probe = (window.__overlayProbe = {
    seq: 0,
    events: [],
    pointerEvents: [],
    hiddenFocus: [],
    startedAt: performance.now(),
    baselineScroll: null,
  });
  let hiddenSince = null;
  const labelOf = (node) => {
    if (!node) return null;
    return node.getAttribute?.("aria-label")
      ?? node.getAttribute?.("data-testid")
      ?? node.getAttribute?.("role")
      ?? node.tagName;
  };
  const describe = (node) => {
    if (!node) return null;
    const style = getComputedStyle(node);
    const rect = node.getBoundingClientRect();
    const overlay = node.closest?.('[data-material-overlay="true"]');
    return {
      tag: node.tagName,
      role: node.getAttribute?.("role"),
      label: node.getAttribute?.("aria-label"),
      testid: node.getAttribute?.("data-testid"),
      text: (node.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 80),
      hidden: !!node.closest?.('[aria-hidden="true"]'),
      hiddenBy: labelOf(node.closest?.('[aria-hidden="true"]')),
      inert: !!node.closest?.("[inert]"),
      body: node === document.body,
      overlayFlag: overlay?.getAttribute?.("data-material-overlay") ?? null,
      inTopOverlay: !!overlay,
      visible: rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none",
      at: Math.round(performance.now()),
    };
  };
  const sweep = () => {
    const active = describe(document.activeElement);
    if (active && !active.body && (active.hidden || active.inert)) {
      if (!hiddenSince || hiddenSince.active.label !== active.label || hiddenSince.active.hiddenBy !== active.hiddenBy) {
        if (hiddenSince) {
          hiddenSince.endedAt = performance.now();
          hiddenSince.duration = hiddenSince.endedAt - hiddenSince.at;
        }
        hiddenSince = { at: performance.now(), endedAt: null, active };
        probe.hiddenFocus.push(hiddenSince);
      } else {
        hiddenSince.duration = performance.now() - hiddenSince.at;
      }
    } else if (hiddenSince) {
      hiddenSince.endedAt = performance.now();
      hiddenSince.duration = hiddenSince.endedAt - hiddenSince.at;
      hiddenSince = null;
    }
  };
  document.addEventListener("focusin", () => {
    probe.seq += 1;
    probe.events.push({ seq: probe.seq, at: Math.round(performance.now()), active: describe(document.activeElement) });
    sweep();
  }, true);
  for (const type of ["pointerdown", "pointerup", "pointercancel", "touchstart", "touchend", "click", "contextmenu"]) {
    document.addEventListener(type, (event) => {
      probe.pointerEvents.push({ type, at: Math.round(performance.now()), label: labelOf(event.target),
        overlay: event.target.closest?.('[data-material-overlay="true"]')?.getAttribute("role") ?? null });
    }, true);
  }
  new MutationObserver(sweep).observe(document, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ["aria-hidden", "inert", "style", "class"],
  });
  setInterval(sweep, 40);
  probe.describeActive = () => describe(document.activeElement);
  probe.reset = () => {
    hiddenSince = null;
    probe.seq = 0;
    probe.events.length = 0;
    probe.pointerEvents.length = 0;
    probe.hiddenFocus.length = 0;
  };
  probe.rememberScroll = () => {
    probe.baselineScroll = {
      html: document.documentElement.style.overflow,
      body: document.body.style.overflow,
    };
  };
  probe.hiddenPersistent = (threshold = 60) => {
    const now = performance.now();
    return probe.hiddenFocus
      .filter((entry) => ((entry.endedAt ?? now) - entry.at) >= threshold)
      .map((entry) => ({
        at: Math.round(entry.at),
        duration: Math.round((entry.endedAt ?? now) - entry.at),
        label: entry.active?.label,
        hiddenBy: entry.active?.hiddenBy,
      }));
  };
}
function rowSamplerInit() {
  window.__rowSample = null;
}

async function installFixtures(page, mode) {
  await page.addInitScript(({ user, theme, expressive }) => {
    localStorage.setItem("ordo.settings", JSON.stringify({
      themeMode: theme,
      expressive,
      materialYouColors: false,
      serverUrl: "https://fixture.example.test",
      hapticsEnabled: false,
    }));
    localStorage.setItem("secure.ordo.auth", JSON.stringify({
      user,
      tokens: { accessToken: "fixture-access", refreshToken: "fixture-refresh", expiresIn: 86400 },
      accessExpiresAt: Date.now() + 86400000,
      sessionUpdatedAt: Date.now(),
    }));
    localStorage.removeItem("ordo.readerFonts");
  }, { user, theme: mode.theme, expressive: mode.expressive });
  await page.addInitScript(focusProbeInit);
  await page.addInitScript(rowSamplerInit);

  let folders = folderSeed.map((folder) => ({ ...folder }));
  let tags = tagSeed.map((tag) => ({ ...tag }));
  let bookmarks = [mainArticle, partialArticle, completeArticle, ...extraBookmarks]
    .map((entry) => ({ ...entry, tags: entry.tags.map((tag) => ({ ...tag })) }));
  let currentUser = { ...user, preferences: { ...user.preferences } };
  let sequence = 0;
  const now = () => new Date().toISOString();
  const json = (route, payload, status = 200) => route.fulfill({
    status,
    contentType: "application/json",
    headers: {
      "access-control-allow-origin": "*",
      "access-control-allow-headers": "*",
      "access-control-allow-methods": "*",
    },
    body: JSON.stringify(payload),
  });

  await page.route("**/*", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const method = request.method();
    if (url.origin === new URL(base).origin) return route.continue();
    if (method === "OPTIONS") {
      return route.fulfill({
        status: 204,
        headers: {
          "access-control-allow-origin": "*",
          "access-control-allow-headers": "*",
          "access-control-allow-methods": "*",
        },
      });
    }
    if (request.resourceType() === "image" || url.hostname === "www.google.com") {
      return route.fulfill({
        contentType: "image/svg+xml",
        headers: { "access-control-allow-origin": "*" },
        body: '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"/>',
      });
    }
    if (url.hostname === "api.github.com") return json(route, []);

    let body = {};
    try {
      const parsed = request.postDataJSON();
      if (parsed && typeof parsed === "object") body = parsed;
    } catch { body = {}; }

    if (path === "/api/health") return json(route, { status: "ok" });
    if (path === "/api/server/info" || path === "/api/server/name") return json(route, serverInfo);
    if (path === "/api/auth/me") return json(route, currentUser);
    if (path === "/api/auth/refresh") {
      return json(route, {
        user: currentUser,
        tokens: { accessToken: "fixture-access", refreshToken: "fixture-refresh", expiresIn: 86400 },
      });
    }
    if (path === "/api/auth/preferences") {
      currentUser = { ...currentUser, preferences: { ...currentUser.preferences, ...body } };
      return json(route, currentUser);
    }
    if (path === "/api/auth/logout") return json(route, { success: true });
    if (path === "/api/folders" && method === "GET") return json(route, folders);
    if (path === "/api/folders" && method === "POST") {
      const folder = {
        id: `folder-created-${++sequence}`,
        name: String(body.name ?? "").trim().slice(0, 100) || "Untitled",
        icon: String(body.icon ?? "folder-outline"),
        pinned: false,
        protected: false,
        lockType: null,
        pinLength: null,
        bookmarkCount: 0,
        unreadCount: 0,
        createdAt: now(),
        updatedAt: now(),
      };
      folders = [...folders, folder];
      return json(route, folder);
    }
    if (path === "/api/folders/batch") {
      const ids = new Set(body.ids ?? []);
      if (body.action === "delete") folders = folders.filter((folder) => !ids.has(folder.id));
      return json(route, { updated: ids.size });
    }
    if (/^\/api\/folders\/[^/]+$/.test(path)) {
      const id = decodeURIComponent(path.split("/")[3]);
      const folder = folders.find((entry) => entry.id === id);
      if (method === "DELETE") folders = folders.filter((entry) => entry.id !== id);
      else if (folder && method === "PATCH") Object.assign(folder, body, { id, updatedAt: now() });
      return json(route, folder ?? { success: true });
    }
    if (path === "/api/tags" && method === "GET") return json(route, tags);
    if (path === "/api/tags" && method === "POST") {
      const tag = {
        id: `tag-created-${++sequence}`,
        name: String(body.name ?? "").trim() || "Untitled",
        color: String(body.color ?? "blue"),
        bookmarkCount: 0,
        createdAt: now(),
        updatedAt: now(),
      };
      tags = [...tags, tag];
      return json(route, tag);
    }
    if (/^\/api\/tags\/[^/]+$/.test(path)) {
      const id = decodeURIComponent(path.split("/")[3]);
      const tag = tags.find((entry) => entry.id === id);
      if (method === "DELETE") tags = tags.filter((entry) => entry.id !== id);
      else if (tag && method === "PATCH") Object.assign(tag, body, { id, updatedAt: now() });
      return json(route, tag ?? { success: true });
    }
    if (path === "/api/bookmarks/extraction-progress") return json(route, { pending: 0, total: bookmarks.length });
    if (path === "/api/bookmarks/reminders") return json(route, []);
    if (path === "/api/bookmarks/prefetch") return json(route, { success: true });
    if (path === "/api/bookmarks/mark-all-read") return json(route, { updated: bookmarks.length });
    if (path === "/api/bookmarks/batch") {
      const ids = new Set(body.ids ?? []);
      if (body.action === "move") {
        bookmarks = bookmarks.map((entry) => (ids.has(entry.id)
          ? { ...entry, folderId: body.folderId ?? null, updatedAt: now() }
          : entry));
      } else if (body.action === "delete") {
        bookmarks = bookmarks.filter((entry) => !ids.has(entry.id));
      } else if (body.action === "markRead" || body.action === "markUnread") {
        bookmarks = bookmarks.map((entry) => (ids.has(entry.id)
          ? { ...entry, isRead: body.action === "markRead", updatedAt: now() }
          : entry));
      }
      return json(route, { updated: ids.size });
    }
    if (path === "/api/bookmarks/search") {
      const query = (url.searchParams.get("q") ?? "").trim().toLocaleLowerCase();
      const items = bookmarks.filter((entry) => !query
        || entry.title.toLocaleLowerCase().includes(query)
        || entry.domain.toLocaleLowerCase().includes(query)
        || entry.tags.some((tag) => tag.name.toLocaleLowerCase().includes(query)));
      return json(route, { items, nextCursor: null, hasMore: false });
    }
    if (path === "/api/bookmarks" && method === "GET") {
      const folderId = url.searchParams.get("folderId");
      const items = bookmarks.filter((entry) => (folderId === null ? entry.folderId === null : entry.folderId === folderId));
      return json(route, { items, nextCursor: null, hasMore: false });
    }
    if (path === "/api/bookmarks" && method === "POST") {
      const raw = String(body.url ?? "").trim();
      const normalized = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
      let hostname = "example.test";
      try { hostname = new URL(normalized).hostname; } catch { /* fixture fallback */ }
      const created = {
        ...articleSeed(`created-${++sequence}`, hostname, 0, false),
        url: normalized,
        domain: hostname,
        folderId: body.folderId ?? null,
        fetchStatus: "pending",
        contentKind: null,
        tags: (body.tagIds ?? []).map((id) => tags.find((tag) => tag.id === id)).filter(Boolean),
        createdAt: now(),
        updatedAt: now(),
      };
      bookmarks = [created, ...bookmarks];
      return json(route, created);
    }
    if (/^\/api\/bookmarks\/[^/]+$/.test(path)) {
      const id = decodeURIComponent(path.split("/")[3]);
      const entry = bookmarks.find((item) => item.id === id);
      if (method === "DELETE") bookmarks = bookmarks.filter((item) => item.id !== id);
      else if (entry && method === "PATCH") Object.assign(entry, body, { id, updatedAt: now() });
      if (!entry) return json(route, { success: true });
      return json(route, {
        ...entry,
        contentHtml: articleContent,
        highlights: id === mainArticle.id ? highlightSeed : [],
      });
    }
    if (path.startsWith("/api/import/")) return json(route, { status: "failed", failure: "Fixture import has no job." });
    return json(route, { success: true });
  });
  page.on("pageerror", (error) => {
    results.errors.push({ kind: "pageerror", mode: mode.id, message: error.message });
  });
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    results.errors.push({
      kind: "console",
      mode: mode.id,
      message: message.text(),
      location: message.location(),
    });
  });
}

/* ------------------------------------------------------------------ */
/* DOM + screenshot helpers                                            */
/* ------------------------------------------------------------------ */

const button = (page, name) => page.getByRole("button", { name, exact: true });
const activeMenu = (page) => page.locator('[role="menu"]:not([aria-hidden="true"])').last();
const activeDialog = (page) => page.locator('[role="dialog"][data-material-overlay="true"]').last();
const librarySearch = (page) => page.getByRole("textbox", { name: "Search your library", exact: true });
const saveDialog = (page) => page.getByRole("dialog", { name: "Save bookmark" });
const folderTrigger = (page) => page.getByRole("button", { name: /^Folder, / }).last();
const linkInput = (page) => page.locator('input[aria-label="Link"]');
const readerRow = (page) => page.getByRole("button", { name: /^Overlay polish article,/ }).first();
const partialRow = (page) => page.getByRole("button", { name: /^Partial restore article,/ }).first();
const completeRow = (page) => page.getByRole("button", { name: /^Complete restore article,/ }).first();

async function rAF(page, count = 2) {
  await page.evaluate((frames) => new Promise((resolve) => {
    let left = frames;
    const tick = () => (--left <= 0 ? resolve() : requestAnimationFrame(tick));
    requestAnimationFrame(tick);
  }), count);
}

async function focusState(page) {
  return page.evaluate(() => window.__overlayProbe?.describeActive() ?? null);
}

async function waitForFocusTop(page, label, timeout = 6000) {
  try {
    await page.waitForFunction(() => {
      const active = window.__overlayProbe?.describeActive();
      return !!active && !active.body && !active.hidden && !active.inert
        && active.visible && active.overlayFlag === "true";
    }, null, { timeout });
  } catch (error) {
    const state = await focusState(page).catch(() => null);
    throw new Error(`${label}: expected focus inside the top overlay; observed ${JSON.stringify(state)}; ${error.message}`);
  }
}

async function waitForBackgroundFocus(page, label, timeout = 5000) {
  try {
    await page.waitForFunction(() => {
      const active = window.__overlayProbe?.describeActive();
      return !!active && !active.body && !active.hidden && !active.inert
        && active.visible && !active.overlayFlag;
    }, null, { timeout });
  } catch (error) {
    const state = await focusState(page).catch(() => null);
    throw new Error(`${label}: expected visible background focus; observed ${JSON.stringify(state)}; ${error.message}`);
  }
}

async function assertNoHiddenFocus(page, label) {
  const persistent = await page.evaluate((threshold) => window.__overlayProbe?.hiddenPersistent(threshold) ?? [], HIDDEN_FOCUS_MS);
  assert.deepEqual(persistent, [], `${label}: focus must not remain on an aria-hidden/inert surface`);
}

async function assertFocusReleased(page, label) {
  // A touch long-press does not necessarily focus the row body. Body focus is
  // acceptable after the surface exits; hidden/inert/overlay focus is not.
  const active = await focusState(page);
  assert.equal(await page.locator('[data-material-overlay="true"]').count(), 0, `${label}: no active overlay remains`);
  assert.ok(active && !active.hidden && !active.inert,
    `${label}: released focus must not remain on a hidden/inert surface (${JSON.stringify(active)})`);
}

async function waitForExit(page, label, timeout = 10000) {
  try {
    // FloatingPanel keepMounted surfaces stay in the overlay host at
    // visibility:hidden after their exit (Contents prepares its list). A
    // finished exit therefore means every retained overlay is dormant, not
    // that the portal layer count is zero.
    await page.waitForFunction(() => {
      const visible = (node) => {
        const style = getComputedStyle(node);
        return style.display !== "none" && style.visibility !== "hidden";
      };
      if (document.querySelectorAll('[data-material-overlay="true"]').length) return false;
      const overlays = [...document.querySelectorAll("[data-material-overlay]")];
      if (overlays.some(visible)) return false;
      const dismissers = [...document.querySelectorAll('[aria-label="Dismiss"], [aria-label="Dismiss menu"]')]
        .filter((node) => {
          const rect = node.getBoundingClientRect();
          return rect.width >= innerWidth * 0.9 && rect.height >= innerHeight * 0.9
            && visible(node) && getComputedStyle(node).pointerEvents !== "none";
        });
      return dismissers.length === 0;
    }, null, { timeout });
  } catch (error) {
    const state = await page.evaluate(() => ({
      layers: document.querySelectorAll("[data-overlay-layer]").length,
      overlays: [...document.querySelectorAll("[data-material-overlay]")].map((node) => {
        const style = getComputedStyle(node);
        return {
          role: node.getAttribute("role"),
          label: node.getAttribute("aria-label"),
          hidden: node.getAttribute("aria-hidden"),
          value: node.getAttribute("data-material-overlay"),
          display: style.display,
          visibility: style.visibility,
        };
      }),
      active: window.__overlayProbe?.describeActive(),
    })).catch(() => null);
    throw new Error(`${label}: overlay did not fully exit (${JSON.stringify(state)}); ${error.message}`);
  }
}

async function assertNoOrphan(page, label) {
  const state = await page.evaluate(() => {
    const visible = (node) => {
      const style = getComputedStyle(node);
      const rect = node.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
    };
    const hit = document.elementFromPoint(innerWidth / 2, innerHeight / 2);
    const overlays = [...document.querySelectorAll("[data-material-overlay]")];
    const visibleOverlays = overlays.filter(visible);
    const openMenus = [...document.querySelectorAll('[role="menu"], [role="dialog"]')]
      .filter((node) => node.getAttribute("aria-hidden") !== "true" && visible(node));
    const dismissers = [...document.querySelectorAll('[aria-label="Dismiss"], [aria-label="Dismiss menu"]')]
      .filter((node) => {
        const rect = node.getBoundingClientRect();
        return rect.width >= innerWidth * 0.9 && rect.height >= innerHeight * 0.9
          && visible(node) && getComputedStyle(node).pointerEvents !== "none";
      });
    return {
      layers: document.querySelectorAll("[data-overlay-layer]").length,
      overlays: overlays.length,
      activeOverlays: document.querySelectorAll('[data-material-overlay="true"]').length,
      visibleOverlays: visibleOverlays.length,
      dormantOverlays: overlays.filter((node) => !visible(node)).map((node) => ({
        role: node.getAttribute("role"),
        label: node.getAttribute("aria-label"),
        hidden: node.getAttribute("aria-hidden"),
        value: node.getAttribute("data-material-overlay"),
      })),
      openMenus: openMenus.length,
      dismissers: dismissers.length,
      // Inactive search accessories and prepared panels are intentionally
      // inert. Detect leaked isolation on live screen controls instead of
      // incorrectly treating every dormant control as an orphan modal.
      inert: [...document.querySelectorAll('[aria-label="Search your library"], [aria-label="More article actions"], [aria-label="Reader settings"]')]
        .filter((node) => {
          const rect = node.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.top < innerHeight
            && rect.right > 0 && rect.left < innerWidth && !!node.closest("[inert]");
        }).length,
      totalInert: document.querySelectorAll("[inert]").length,
      hitInOverlay: !!hit?.closest?.('[data-material-overlay="true"]'),
      scroll: {
        html: document.documentElement.style.overflow,
        body: document.body.style.overflow,
      },
      baseline: window.__overlayProbe?.baselineScroll ?? null,
    };
  });
  assert.deepEqual({
    activeOverlays: state.activeOverlays,
    visibleOverlays: state.visibleOverlays,
    openMenus: state.openMenus,
    dismissers: state.dismissers,
    inert: state.inert,
    hitInOverlay: state.hitInOverlay,
  }, { activeOverlays: 0, visibleOverlays: 0, openMenus: 0, dismissers: 0, inert: 0, hitInOverlay: false },
  `${label}: no invisible backdrop/menu/dialog/inert orphan may remain (${JSON.stringify(state)})`);
  if (state.baseline) {
    assert.deepEqual(state.scroll, state.baseline, `${label}: modal scroll isolation must be released`);
  }
}

async function overlayState(page) {
  return page.evaluate(() => {
    const roots = [...document.querySelectorAll('[data-material-overlay="true"]')];
    return roots.map((root) => {
      const rect = root.getBoundingClientRect();
      const layer = root.closest("[data-overlay-layer]") ?? root.parentElement;
      const scrim = layer?.querySelector('[aria-label="Dismiss"], [aria-label="Dismiss menu"]');
      const scrimRect = scrim?.getBoundingClientRect();
      const style = scrim ? getComputedStyle(scrim) : null;
      return {
        role: root.getAttribute("role"),
        label: root.getAttribute("aria-label"),
        rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
        scrim: scrim ? {
          width: scrimRect.width,
          height: scrimRect.height,
          visible: style.visibility !== "hidden" && style.display !== "none" && Number(style.opacity) > 0.01,
          covers: scrimRect.width >= innerWidth * 0.9 && scrimRect.height >= innerHeight * 0.9,
        } : null,
      };
    });
  });
}

async function assertOverlayOpen(page, label, { name, role = "dialog" } = {}) {
  const roots = await overlayState(page);
  assert.equal(roots.length, 1, `${label}: exactly one active overlay layer`);
  const root = roots[0];
  assert.equal(root.role, role, `${label}: active layer role is ${role}`);
  if (name) assert.equal(root.label, name, `${label}: active layer is ${name}`);
  assert.ok(root.scrim?.visible, `${label}: the dimming backdrop is visible`);
  assert.ok(root.scrim?.covers, `${label}: the dimming backdrop covers the viewport`);
  await waitForFocusTop(page, label);
}

async function articlePresence(page) {
  return page.evaluate(() => {
    const rendered = (node) => {
      if (!node) return false;
      const rect = node.getBoundingClientRect();
      const style = getComputedStyle(node);
      return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
    };
    const leaf = (text) => {
      const matches = [];
      for (const node of document.querySelectorAll("div,span,h1,h2,h3,p")) {
        if (node.textContent.trim() !== text) continue;
        if (node.querySelector("div,span,h1,h2,h3,p")) continue;
        matches.push(node);
      }
      return matches.find(rendered) ?? matches[0] ?? null;
    };
    // Router screens are retained. Prefer the rendered reader's title rather
    // than a same-text bookmark title in the hidden Library screen.
    const titles = ["Overlay polish article", "Partial restore article", "Complete restore article"].map(leaf);
    const title = titles.find(rendered) ?? titles.find(Boolean);
    const headings = [...document.querySelectorAll("h1,h2,h3,div,span")].filter((node) =>
      /^Section \d+$/.test(node.textContent.trim())
      && ![...node.children].some((child) => /^Section \d+$/.test(child.textContent.trim())));
    let scroller = title;
    while (scroller && !(scroller.scrollHeight > scroller.clientHeight + 100
      && /auto|scroll/.test(getComputedStyle(scroller).overflowY))) scroller = scroller.parentElement;
    return {
      titlePresent: !!title?.isConnected,
      titleVisible: rendered(title),
      headingCount: headings.length,
      articleChars: document.body.innerText.length,
      scrollable: !!scroller,
      scrollTop: scroller?.scrollTop ?? 0,
      scrollHeight: scroller?.scrollHeight ?? 0,
      clientHeight: scroller?.clientHeight ?? 0,
    };
  });
}

async function assertArticlePresent(page, label, { top = false } = {}) {
  const state = await articlePresence(page);
  assert.equal(state.titlePresent, true, `${label}: article title node is still mounted`);
  assert.equal(state.titleVisible, true, `${label}: article title is not display:none/zero-sized`);
  assert.ok(state.headingCount >= 20, `${label}: article headings are present (${state.headingCount})`);
  assert.ok(state.articleChars > 500, `${label}: article text is present (${state.articleChars} chars)`);
  if (top) assert.ok(state.scrollTop < 8, `${label}: article is at the top (scrollTop=${state.scrollTop})`);
}

async function assertLibraryPresent(page, label) {
  const state = await page.evaluate(() => ({
    rows: document.querySelectorAll('[data-testid="bookmark-row"]').length,
    search: !!document.querySelector('[aria-label="Search your library"]'),
    text: document.body.innerText,
  }));
  assert.ok(state.rows >= 1, `${label}: library rows remain mounted (${state.rows})`);
  assert.equal(state.search, true, `${label}: library search remains mounted`);
  assert.ok(state.text.includes("Overlay polish article"), `${label}: library content is still painted`);
}

function analyzePng(buffer) {
  const png = PNG.sync.read(buffer);
  const { width, height, data } = png;
  const counts = new Map();
  let samples = 0;
  let luminance = 0;
  for (let y = 0; y < height; y += 2) {
    for (let x = 0; x < width; x += 2) {
      const index = (y * width + x) * 4;
      const r = data[index], g = data[index + 1], b = data[index + 2];
      const key = `${r >> 4},${g >> 4},${b >> 4}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
      luminance += 0.21 * r + 0.72 * g + 0.07 * b;
      samples += 1;
    }
  }
  const dominant = Math.max(...counts.values()) / Math.max(1, samples);
  const uniqueColors = counts.size;
  const meanLuminance = luminance / Math.max(1, samples);
  const differing = 1 - dominant;
  return {
    width,
    height,
    dominantFraction: Number(dominant.toFixed(4)),
    differingFraction: Number(differing.toFixed(4)),
    uniqueColors,
    meanLuminance: Number(meanLuminance.toFixed(1)),
    ok: differing >= 0.01 && uniqueColors >= 16 && !(meanLuminance < 2 && uniqueColors < 8),
  };
}

async function capture(page, mode, name, { force = false, settleMs = captureSettleMs } = {}) {
  const wanted = force || mode.theme === "dark" || ["bookmark-longpress-menu", "reader-settings"].includes(name);
  if (!wanted) return null;
  await page.evaluate(() => document.fonts?.ready).catch(() => {});
  if (settleMs > 0) await page.waitForTimeout(settleMs);
  const path = `${output}/${mode.id}-${name}.png`;
  const buffer = await page.screenshot({ path });
  const health = analyzePng(buffer);
  const record = { mode: mode.id, name, path, health };
  results.captures.push(record);
  assert.ok(health.ok, `${mode.id} ${name}: screenshot must not be blank/black (${JSON.stringify(health)})`);
  return record;
}

async function writeFailure(page, mode, label) {
  const prefix = `${output}/${mode.id}-${label}`;
  await page.screenshot({ path: `${prefix}-failure.png` }).catch(() => {});
  await writeFile(`${prefix}-failure.txt`, await page.locator("body").innerText().catch(() => "Page unavailable")).catch(() => {});
  const state = await page.evaluate(() => ({
    url: location.href,
    active: window.__overlayProbe?.describeActive?.(),
    overlays: [...document.querySelectorAll("[data-material-overlay]")].map((node) => ({
      role: node.getAttribute("role"),
      label: node.getAttribute("aria-label"),
      hidden: node.getAttribute("aria-hidden"),
      value: node.getAttribute("data-material-overlay"),
    })),
    layers: document.querySelectorAll("[data-overlay-layer]").length,
    hiddenFocus: window.__overlayProbe?.hiddenPersistent?.(60) ?? [],
    pointerEvents: window.__overlayProbe?.pointerEvents ?? [],
    rowSamples: window.__rowSample?.samples?.slice(-15) ?? [],
  })).catch(() => null);
  await writeFile(`${prefix}-failure.json`, JSON.stringify(state, null, 2)).catch(() => {});
}

/* ------------------------------------------------------------------ */
/* Timing + interaction helpers                                        */
/* ------------------------------------------------------------------ */

async function measureOverlay(page, label, trigger, target) {
  await trigger.evaluate((node, wanted) => {
    window.__overlaySample = null;
    let start = 0;
    const frames = [];
    const longTasks = [];
    let last = 0;
    let observer = null;
    try {
      observer = new PerformanceObserver((list) => longTasks.push(...list.getEntries().map((entry) => entry.duration)));
    } catch { observer = null; }
    let firstVisibleAt = null;
    let settleAt = null;
    let lastRect = null;
    let stable = 0;
    let peakActive = 0;
    let peakRetained = 0;
    const matches = (node) => {
      if (!node || node.closest('[aria-hidden="true"]')) return false;
      const label = node.getAttribute("aria-label") ?? "";
      if (wanted.label != null && label !== wanted.label) return false;
      if (wanted.labelPrefix && !label.startsWith(wanted.labelPrefix)) return false;
      if (wanted.text && !(node.textContent ?? "").includes(wanted.text)) return false;
      if (wanted.requiresOverlay !== false && !node.closest('[data-material-overlay="true"]')) return false;
      return true;
    };
    const targetNode = () => [...document.querySelectorAll(wanted.selector)].find(matches) ?? null;
    const effectiveOpacity = (node) => {
      let opacity = 1;
      for (let parent = node; parent; parent = parent.parentElement) {
        const style = getComputedStyle(parent);
        if (style.display === "none" || style.visibility === "hidden") return 0;
        opacity *= Number(style.opacity);
        if (opacity <= 0.001) return 0;
      }
      return opacity;
    };
    const finish = (now, timedOut) => {
      longTasks.push(...(observer?.takeRecords?.() ?? []).map((entry) => entry.duration));
      observer?.disconnect();
      window.__overlaySample = {
        clickEpochMs: performance.timeOrigin + start,
        firstVisibleMs: firstVisibleAt,
        settleMs: settleAt ?? now - start,
        maxFrameMs: Math.max(0, ...frames),
        longTaskCount: longTasks.length,
        maxLongTaskMs: Math.max(0, ...longTasks),
        peakActiveLayers: peakActive,
        peakRetainedLayers: peakRetained,
        coexistence: peakActive > 0 && peakRetained > 0,
        timedOut,
      };
    };
    const frame = () => {
      const now = performance.now();
      frames.push(now - last);
      last = now;
      peakActive = Math.max(peakActive, document.querySelectorAll('[data-material-overlay="true"]').length);
      peakRetained = Math.max(peakRetained, document.querySelectorAll('[data-material-overlay="false"]').length);
      const node = targetNode();
      if (node) {
        const opacity = effectiveOpacity(node);
        const rect = node.getBoundingClientRect();
        if (firstVisibleAt == null && opacity > 0.01 && rect.width > 0 && rect.height > 0) {
          firstVisibleAt = now - start;
        }
        if (firstVisibleAt != null) {
          const current = { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
          const same = lastRect
            && Math.abs(current.x - lastRect.x) < 0.5
            && Math.abs(current.y - lastRect.y) < 0.5
            && Math.abs(current.width - lastRect.width) < 0.5
            && Math.abs(current.height - lastRect.height) < 0.5;
          stable = same ? stable + 1 : 0;
          lastRect = current;
          if (opacity > 0.995 && stable >= 3) settleAt = now - start;
        }
      }
      if (settleAt != null) return finish(now, false);
      if (now - start > 12000) return finish(now, true);
      requestAnimationFrame(frame);
    };
    node.addEventListener("click", () => {
      start = performance.now();
      last = start;
      observer?.observe({ type: "longtask" });
      requestAnimationFrame(frame);
    }, { once: true });
  }, target);

  await trigger.click();
  await page.waitForFunction(() => window.__overlaySample !== null, null, { timeout: 15000 });
  const sample = await page.evaluate(() => window.__overlaySample);
  assert.equal(sample.timedOut, false, `${label}: ${JSON.stringify(sample)}`);
  assert.ok(sample.firstVisibleMs != null, `${label}: destination painted a first frame`);
  assert.ok(sample.firstVisibleMs <= maxFirstMs, `${label}: first frame ${sample.firstVisibleMs.toFixed(0)}ms <= ${maxFirstMs}ms`);
  assert.ok(sample.settleMs <= maxSettleMs, `${label}: settled in ${sample.settleMs.toFixed(0)}ms <= ${maxSettleMs}ms`);
  return { label, ...sample, firstVisibleMs: Math.round(sample.firstVisibleMs), settleMs: Math.round(sample.settleMs) };
}

async function waitVisualSettled(page, target, timeout = 6000) {
  await page.evaluate(({ selector, label, text, timeoutMs }) => new Promise((resolve, reject) => {
    const started = performance.now();
    let lastRect = null;
    let stable = 0;
    const matches = (node) => {
      if (!node || node.closest('[aria-hidden="true"]')) return false;
      const aria = node.getAttribute("aria-label") ?? "";
      if (label != null && aria !== label) return false;
      if (text && !(node.textContent ?? "").includes(text)) return false;
      return true;
    };
    const effectiveOpacity = (node) => {
      let opacity = 1;
      for (let parent = node; parent; parent = parent.parentElement) {
        const style = getComputedStyle(parent);
        if (style.display === "none" || style.visibility === "hidden") return 0;
        opacity *= Number(style.opacity);
      }
      return opacity;
    };
    const tick = () => {
      const node = [...document.querySelectorAll(selector)].find(matches);
      if (node) {
        const rect = node.getBoundingClientRect();
        const current = { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
        const same = lastRect
          && Math.abs(current.x - lastRect.x) < 0.5
          && Math.abs(current.y - lastRect.y) < 0.5
          && Math.abs(current.width - lastRect.width) < 0.5
          && Math.abs(current.height - lastRect.height) < 0.5;
        stable = same ? stable + 1 : 0;
        lastRect = current;
        if (effectiveOpacity(node) > 0.995 && stable >= 3) return resolve();
      }
      if (performance.now() - started > timeoutMs) return reject(new Error("visual settle timed out"));
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }), { ...target, timeoutMs: timeout });
}

async function openReaderMenu(page) {
  await button(page, "More article actions").click();
  await activeMenu(page).waitFor({ state: "visible" });
  await waitVisualSettled(page, { selector: '[role="menuitem"]', label: "Highlights" });
}

async function waitReaderReady(page) {
  await button(page, "Reader settings").waitFor({ state: "visible", timeout: 30000 });
  await page.getByText("Section 80", { exact: true }).waitFor({ state: "attached", timeout: 30000 });
  await page.locator('[data-testid="material-linear-progress"]').waitFor({ state: "visible" });
  await page.evaluate(() => document.fonts?.ready).catch(() => {});
}

async function backToLibrary(page) {
  await button(page, "Back").click();
  await librarySearch(page).waitFor({ state: "visible", timeout: 20000 });
  await page.getByTestId("bookmark-row").first().waitFor({ state: "attached", timeout: 20000 });
}

async function progressState(page) {
  return page.evaluate(() => {
    const bar = document.querySelector('[data-testid="material-linear-progress"]');
    const rect = bar?.getBoundingClientRect();
    const leaf = (text) => {
      for (const node of document.querySelectorAll("div,span,h1,h2,h3,p")) {
        if (node.textContent.trim() !== text) continue;
        if (node.querySelector("div,span,h1,h2,h3,p")) continue;
        return node;
      }
      return null;
    };
    let scroller = leaf("Section 1");
    while (scroller && !(scroller.scrollHeight > scroller.clientHeight + 100
      && /auto|scroll/.test(getComputedStyle(scroller).overflowY))) scroller = scroller.parentElement;
    return {
      barPresent: !!bar && bar.isConnected,
      barWidth: rect?.width ?? null,
      barLeft: rect?.left ?? null,
      barTop: rect?.top ?? null,
      barBottom: rect?.bottom ?? null,
      value: bar ? Number(bar.getAttribute("aria-valuenow")) : null,
      scrollTop: scroller?.scrollTop ?? null,
      scrollable: !!scroller,
    };
  });
}

async function assertProgressBarAtTop(page, label, { value, scroll }) {
  await page.waitForFunction(({ expectedValue, expectedScroll }) => {
    const bar = document.querySelector('[data-testid="material-linear-progress"]');
    const leaf = (text) => {
      for (const node of document.querySelectorAll("div,span,h1,h2,h3,p")) {
        if (node.textContent.trim() !== text) continue;
        if (node.querySelector("div,span,h1,h2,h3,p")) continue;
        return node;
      }
      return null;
    };
    let scroller = leaf("Section 1");
    while (scroller && !(scroller.scrollHeight > scroller.clientHeight + 100
      && /auto|scroll/.test(getComputedStyle(scroller).overflowY))) scroller = scroller.parentElement;
    if (!bar || !scroller) return false;
    const current = Number(bar.getAttribute("aria-valuenow"));
    if (expectedValue === "complete") return current === 0 && scroller.scrollTop < 8;
    return current >= 30 && current <= 55 && scroller.scrollTop > 80 && expectedScroll !== false;
  }, { expectedValue: value, expectedScroll: scroll }, { timeout: 20000 });
  const state = await progressState(page);
  assert.equal(state.barPresent, true, `${label}: reading progress bar is mounted`);
  assert.ok(state.barTop != null && state.barTop >= 0 && state.barTop < 150,
    `${label}: progress bar sits at the header top (top=${state.barTop})`);
  const viewportWidth = page.viewportSize().width;
  assert.ok(state.barWidth >= Math.min(640, viewportWidth - 32),
    `${label}: progress track spans the reader pane (${state.barWidth}px)`);
  assert.ok(Math.abs(state.barLeft - (viewportWidth - state.barWidth) / 2) < 2,
    `${label}: progress track is centered, not right-anchored`);
  assert.ok(state.barBottom != null && state.barBottom > state.barTop, `${label}: progress bar has height`);
  if (value === "complete") {
    assert.equal(state.value, 0, `${label}: completed article reopens at the top with a zero bar`);
    assert.ok(state.scrollTop < 8, `${label}: completed article is not restore-scrolled (${state.scrollTop})`);
  } else {
    assert.ok(state.value >= 30 && state.value <= 55, `${label}: partial stored progress is restored (${state.value}%)`);
    assert.ok(state.scrollTop > 80, `${label}: partial article restores its scroll position (${state.scrollTop})`);
  }
  return state;
}

async function touchOrMouseHold(page, cdp, locator, { touch }) {
  if (touch) await page.mouse.move(-1, -1);
  await locator.scrollIntoViewIfNeeded();
  const box = await locator.boundingBox();
  assert.ok(box, "long-hold target has a bounding box");
  const x = box.x + Math.min(56, box.width * 0.25);
  const y = box.y + Math.min(24, box.height / 2);
  assert.ok(await locator.evaluate((node, { x, y }) => node.contains(document.elementFromPoint(x, y)), { x, y }),
    "the held point hits the body target, not an offscreen row or nested action");
  await page.evaluate(() => window.__rowSample?.mark?.("down"));
  if (touch) {
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ x, y, id: 1, radiusX: 6, radiusY: 6, force: 1 }],
    });
  } else {
    await page.mouse.move(x, y);
    await page.mouse.down();
  }
  return {
    x,
    y,
    release: async () => {
      if (touch) await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
      else await page.mouse.up();
      await page.evaluate(() => window.__rowSample?.mark?.("up"));
    },
  };
}

async function armRowSampler(page, bodyLocator) {
  await bodyLocator.evaluate((body) => {
    const row = body.closest('[data-testid="bookmark-row"]') ?? body.parentElement;
    if (!row) throw new Error("row root not found");
    const first = row.firstElementChild;
    const selection = row.querySelector('[data-testid="material-row-selection"]');
    const stateLayer = row.querySelector('[data-testid="material-row-state-layer"]');
    const sample = window.__rowSample = {
      body,
      row,
      first,
      firstTestId: first?.getAttribute?.("data-testid") ?? null,
      samples: [],
      phase: "armed",
      phaseAt: {},
      startedAt: performance.now(),
      running: true,
      menuAt: null,
      label: body.getAttribute("aria-label"),
      path: location.pathname,
    };
    const read = (node) => {
      if (!node || !node.isConnected) return null;
      const style = getComputedStyle(node);
      return {
        color: style.backgroundColor,
        opacity: Number(style.opacity),
        transform: style.transform,
      };
    };
    const loop = () => {
      if (!sample.running) return;
      const menu = document.querySelector('[role="menu"]:not([aria-hidden="true"])');
      const t = performance.now() - sample.startedAt;
      if (menu && sample.menuAt == null) sample.menuAt = t;
      sample.samples.push({
        t,
        phase: sample.phase,
        menu: !!menu,
        first: read(sample.first),
        selection: read(selection),
        state: read(stateLayer),
        bodyConnected: body.isConnected,
        firstConnected: sample.first?.isConnected ?? false,
      });
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
    sample.mark = (phase) => {
      sample.phase = phase;
      sample.phaseAt[phase] = performance.now() - sample.startedAt;
    };
    sample.stop = () => {
      sample.running = false;
      sample.stoppedAt = performance.now() - sample.startedAt;
    };
    document.addEventListener("pointerdown", () => {
      if (sample.phase === "armed") sample.mark("down");
    }, { capture: true, once: true });
    document.addEventListener("pointerup", () => sample.mark("up"), { capture: true, once: true });
  });
}

async function readRowSample(page, label, { expectMenuText }) {
  const trace = await page.evaluate((menuText) => {
    const sample = window.__rowSample;
    if (!sample) throw new Error("row sampler was not armed");
    sample.stop();
    const menu = [...document.querySelectorAll('[role="menu"]:not([aria-hidden="true"])')].find((node) =>
      (node.textContent ?? "").includes(menuText));
    const relevant = sample.samples.filter((entry) => entry.t >= (sample.menuAt ?? 0) - 34);
    let reached = false;
    let previous = null;
    let maxDrop = 0;
    let minAfter = 1;
    let final = null;
    let selectionOnAt = null;
    for (const entry of relevant) {
      const opacity = entry.selection?.opacity;
      if (opacity == null) continue;
      final = opacity;
      if (selectionOnAt == null && opacity >= 0.9) selectionOnAt = entry.t;
      if (!reached && opacity >= 0.5) reached = true;
      if (!reached) continue;
      minAfter = Math.min(minAfter, opacity);
      if (previous != null) maxDrop = Math.max(maxDrop, previous - opacity);
      previous = opacity;
    }
    const firstOpacities = relevant.map((entry) => entry.first?.opacity).filter((value) => value != null);
    const firstColors = [...new Set(relevant.map((entry) => entry.first?.color).filter(Boolean))];
    return {
      rowConnected: sample.row.isConnected,
      bodyConnected: sample.body.isConnected && sample.body.getAttribute("aria-label") === sample.label,
      firstConnected: sample.first?.isConnected ?? false,
      firstTestId: sample.firstTestId,
      rowStillFirstChild: sample.row.firstElementChild === sample.first,
      menuVisible: !!menu,
      path: location.pathname,
      beforePath: sample.path,
      menuAt: sample.menuAt,
      downAt: sample.phaseAt.down ?? null,
      holdToMenuMs: sample.menuAt != null && sample.phaseAt.down != null
        ? Math.round(sample.menuAt - sample.phaseAt.down) : null,
      menuPhaseAt: sample.phaseAt["menu-shown"] ?? null,
      upAt: sample.phaseAt.up ?? null,
      sampleCount: sample.samples.length,
      selectionOnAt,
      handoffGapMs: selectionOnAt != null && sample.menuAt != null ? Math.round(selectionOnAt - sample.menuAt) : null,
      selectionMaxDrop: Number(maxDrop.toFixed(3)),
      selectionMinAfterMenu: Number(minAfter.toFixed(3)),
      selectionFinal: final,
      firstOpacityMin: firstOpacities.length ? Math.min(...firstOpacities) : null,
      firstOpacityMax: firstOpacities.length ? Math.max(...firstOpacities) : null,
      firstColorChanges: Math.max(0, firstColors.length - 1),
      firstColors: firstColors.slice(0, 6),
      sampledPhases: [...new Set(sample.samples.map((entry) => entry.phase))],
      firstChildTrace: sample.samples.map((entry) => ({
        t: Math.round(entry.t),
        phase: entry.phase,
        menu: entry.menu,
        color: entry.first?.color ?? null,
        opacity: entry.first?.opacity ?? null,
        selectionOpacity: entry.selection?.opacity ?? null,
      })),
    };
  }, expectMenuText);
  (results.gestureTraces ??= []).push({ label, ...trace });
  assert.equal(trace.menuVisible, true, `${label}: context menu is visible while/after the hold`);
  assert.ok(trace.menuAt != null, `${label}: rAF trace observed the menu`);
  assert.ok(trace.holdToMenuMs != null && trace.holdToMenuMs >= 300, `${label}: long-press timer preceded the menu (${trace.holdToMenuMs}ms from pointerdown)`);
  assert.equal(trace.path, trace.beforePath, `${label}: long-hold must not navigate`);
  assert.equal(trace.rowConnected, true, `${label}: row root is still connected`);
  assert.equal(trace.bodyConnected, true, `${label}: row body keeps its selector identity/label`);
  assert.equal(trace.firstConnected, true, `${label}: RowHighlight first child is still connected`);
  assert.equal(trace.rowStillFirstChild, true, `${label}: RowHighlight remains the row's first child`);
  assert.equal(trace.selectionMaxDrop <= 0.2, true,
    `${label}: no highlight flash/drop after menu open (maxDrop=${trace.selectionMaxDrop})`);
  assert.ok(trace.selectionMinAfterMenu >= 0.8,
    `${label}: selected RowHighlight stays painted while the menu is open (min=${trace.selectionMinAfterMenu})`);
  assert.ok(trace.selectionFinal == null || trace.selectionFinal >= 0.8,
    `${label}: selected RowHighlight remains after pointerup (final=${trace.selectionFinal})`);
  assert.ok(trace.firstOpacityMax == null || trace.firstOpacityMax > 0.05,
    `${label}: first RowHighlight child never disappears`);
  return trace;
}

/* ------------------------------------------------------------------ */
/* Screencast + press trace                                            */
/* ------------------------------------------------------------------ */

async function withScreencast(page, cdp, mode, name, run) {
  if (mode.theme !== "dark") return run();
  // Keep the normal timing matrix uninstrumented on these paths. An explicit
  // visual run records the first-open animations with compositor timestamps.
  if (name.endsWith("-open") && process.env.ORDO_UI_OPENING_FRAMES !== "1") return run();
  const chunks = [];
  const onFrame = (event) => {
    chunks.push({ data: event.data, metadata: event.metadata });
    cdp.send("Page.screencastFrameAck", { sessionId: event.sessionId }).catch(() => {});
  };
  cdp.on("Page.screencastFrame", onFrame);
  await cdp.send("Page.startScreencast", {
    format: "png",
    everyNthFrame: 1,
    maxWidth: 640,
    maxHeight: 640,
  });
  // Capture-only warm-up so the first compositor frame is not missed. Timing
  // samples never include this wait.
  await page.waitForTimeout(120);
  let result;
  try {
    result = await run();
  } finally {
    await cdp.send("Page.stopScreencast").catch(() => {});
    await page.waitForTimeout(80);
    cdp.off("Page.screencastFrame", onFrame);
  }
  const directory = `${output}/frames`;
  await mkdir(directory, { recursive: true });
  const frames = [];
  const frameLimit = name.endsWith("-open") ? 90 : 30;
  for (let index = 0; index < Math.min(chunks.length, frameLimit); index += 1) {
    const path = `${directory}/${mode.id}-${name}-${String(index + 1).padStart(2, "0")}.png`;
    const buffer = Buffer.from(chunks[index].data, "base64");
    await writeFile(path, buffer);
    const health = analyzePng(buffer);
    const epochMs = chunks[index].metadata.timestamp * 1000;
    frames.push({ index: index + 1, path, health, epochMs,
      sinceClickMs: result?.clickEpochMs != null ? epochMs - result.clickEpochMs : null });
    assert.ok(health.ok, `${mode.id} ${name} frame ${index + 1}: blank/black frame (${JSON.stringify(health)})`);
  }
  const record = { mode: mode.id, name, frameCount: frames.length, frames };
  results.frameSequences.push(record);
  assert.ok(frames.length > 0, `${mode.id} ${name}: screencast captured at least one frame`);
  return result;
}

/* ------------------------------------------------------------------ */
/* Cases                                                               */
/* ------------------------------------------------------------------ */

async function libraryPhase(page, mode, check, note) {
  await page.goto(base, { waitUntil: "domcontentloaded" });
  await librarySearch(page).waitFor({ state: "visible", timeout: 30000 });
  await page.getByText("Recipes", { exact: true }).first().waitFor({ state: "visible", timeout: 20000 });
  await readerRow(page).waitFor({ state: "visible", timeout: 20000 });
  await page.evaluate(() => {
    window.__overlayProbe?.rememberScroll();
    window.__overlayProbe?.reset();
  });
  note("libraryRows", await page.locator('[data-testid="bookmark-row"]').count());

  const samples = [];
  samples.push(await measureOverlay(page, "library overflow", button(page, "Library actions"), {
    selector: '[role="menuitem"]', label: "Manage tags",
  }));
  await assertOverlayOpen(page, "Library overflow open", { role: "menu" });
  await assertLibraryPresent(page, "Library overflow open");
  await capture(page, mode, "library-overflow");
  await page.keyboard.press("Escape");
  await waitForExit(page, "Library overflow close");
  await assertNoOrphan(page, "Library overflow close");
  await waitForBackgroundFocus(page, "Library overflow close");
  await assertNoHiddenFocus(page, "Library overflow close");
  return samples;
}

async function bookmarkLongHoldPhase(page, mode, cdp, check, note) {
  const body = readerRow(page);
  const run = async () => {
    await armRowSampler(page, body);
    const hold = await touchOrMouseHold(page, cdp, body, { touch: mode.layout.hasTouch });
    await page.waitForFunction(() => {
      const menu = document.querySelector('[role="menu"]:not([aria-hidden="true"])');
      return !!menu && (menu.textContent ?? "").includes("Edit tags");
    }, null, { timeout: 15000 });
    await page.evaluate(() => window.__rowSample?.mark?.("menu-shown"));
    await rAF(page, 2);
    await hold.release();
    await rAF(page, 3);
    const trace = await readRowSample(page, "Bookmark body long-hold", { expectMenuText: "Edit tags" });
    note("bookmarkLongHold", trace);
    check(trace.holdToMenuMs != null && trace.holdToMenuMs >= 300, "bookmark body long-hold opens the menu only after the hold timer");
    check(trace.selectionMaxDrop <= 0.2, "bookmark RowHighlight handoff has no post-open opacity drop");
    check(trace.sampledPhases.includes("up"), "bookmark long-hold trace spans pointerup");
    await waitVisualSettled(page, { selector: '[role="menuitem"]', label: "Edit tags" });
    await assertLibraryPresent(page, "Bookmark long-hold menu");
    await capture(page, mode, "bookmark-longpress-menu");
  };
  await withScreencast(page, cdp, mode, "bookmark-hold", run);

  // Focused item + immediate pointerdown/up: still a real handoff, no lost
  // focus on the trigger chain.
  const item = activeMenu(page).getByRole("menuitem", { name: "Edit tags", exact: true });
  await item.focus();
  check(await activeMenu(page).evaluate((node) => node.contains(document.activeElement)), "focused menu item owns focus");
  const box = await item.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.up();
  const dialog = page.getByRole("dialog", { name: "Edit tags" });
  await dialog.waitFor({ state: "visible", timeout: 10000 });
  await waitForFocusTop(page, "Focused menu item rapid release");
  await assertNoHiddenFocus(page, "Focused menu item rapid release");
  await capture(page, mode, "edit-tags-handoff");
  await page.keyboard.press("Escape");
  await waitForExit(page, "Edit tags close");
  await assertNoOrphan(page, "Edit tags close");
  await assertFocusReleased(page, "Edit tags close");
  await page.waitForFunction(() => {
    const row = document.querySelector('[data-testid="bookmark-row"]');
    const selection = row?.querySelector('[data-testid="material-row-selection"]');
    return !selection || Number(getComputedStyle(selection).opacity) < 0.1;
  }, null, { timeout: 5000 }).catch(() => {});
  const highlightAfter = await page.evaluate(() => {
    const row = document.querySelector('[data-testid="bookmark-row"]');
    const selection = row?.querySelector('[data-testid="material-row-selection"]');
    return selection ? Number(getComputedStyle(selection).opacity) : 0;
  });
  check(highlightAfter < 0.1, "bookmark highlight clears after the menu/dialog closes");
}

async function folderLongHoldPhase(page, mode, cdp, check, note) {
  const body = page.getByRole("button", { name: /^Recipes, / }).first();
  await body.waitFor({ state: "visible", timeout: 20000 });
  await armRowSampler(page, body);
  const hold = await touchOrMouseHold(page, cdp, body, { touch: mode.layout.hasTouch });
  await page.waitForFunction(() => {
    const menu = document.querySelector('[role="menu"]:not([aria-hidden="true"])');
    return !!menu && (menu.textContent ?? "").includes("Rename");
  }, null, { timeout: 15000 });
  await page.evaluate(() => window.__rowSample?.mark?.("menu-shown"));
  await rAF(page, 2);
  await hold.release();
  await rAF(page, 3);
  const trace = await readRowSample(page, "Folder body long-hold", { expectMenuText: "Rename" });
  note("folderLongHold", trace);
  check(trace.holdToMenuMs != null && trace.holdToMenuMs >= 300, "folder body long-hold opens the menu only after the hold timer");
  check(trace.selectionMaxDrop <= 0.2, "folder RowHighlight handoff has no post-open opacity drop");
  await waitVisualSettled(page, { selector: '[role="menuitem"]', label: "Rename" });
  await assertLibraryPresent(page, "Folder long-hold menu");
  await capture(page, mode, "folder-longpress-menu");
  await page.keyboard.press("Escape");
  await waitForExit(page, "Folder long-hold menu close");
  await assertNoOrphan(page, "Folder long-hold menu close");
  await assertFocusReleased(page, "Folder long-hold menu close");
  await page.waitForFunction(() => {
    const body = [...document.querySelectorAll('[role="button"]')].find((node) =>
      (node.getAttribute("aria-label") ?? "").startsWith("Recipes, "));
    const selection = body?.parentElement?.querySelector('[data-testid="material-row-selection"]');
    return !selection || Number(getComputedStyle(selection).opacity) < 0.1;
  }, null, { timeout: 5000 }).catch(() => {});
  const highlightAfter = await page.evaluate(() => {
    const body = [...document.querySelectorAll('[role="button"]')].find((node) =>
      (node.getAttribute("aria-label") ?? "").startsWith("Recipes, "));
    const row = body?.parentElement;
    const selection = row?.querySelector('[data-testid="material-row-selection"]');
    return selection ? Number(getComputedStyle(selection).opacity) : 0;
  });
  check(highlightAfter < 0.1, "folder highlight clears after its menu closes");
}

async function leadingSelectionPhase(page, mode, cdp, check) {
  const leading = page.getByRole("button", { name: "Select Overlay polish article", exact: true }).first();
  await leading.waitFor({ state: "visible", timeout: 20000 });
  const before = await page.evaluate(() => location.pathname);
  const hold = await touchOrMouseHold(page, cdp, leading, { touch: mode.layout.hasTouch });
  await page.getByText("1 selected", { exact: true }).waitFor({ state: "visible", timeout: 15000 });
  await rAF(page, 2);
  await hold.release();
  await button(page, "Cancel selection").waitFor({ state: "visible", timeout: 10000 });
  check(await activeMenu(page).count() === 0, "leading-icon long-hold enters selection, not the context menu");
  check((await page.evaluate(() => location.pathname)) === before, "leading-icon long-hold does not navigate");
  await capture(page, mode, "leading-selection");
  await page.keyboard.press("Escape");
  await page.waitForFunction(() => !document.querySelector('[role="button"][aria-label="Cancel selection"]'), null, { timeout: 10000 });
  await librarySearch(page).waitFor({ state: "visible" });
  await assertNoOrphan(page, "Leading selection exit");
}

async function saveFocusPhase(page, mode, check) {
  const search = librarySearch(page);
  await search.click();
  await search.fill("Overlay");
  await waitForBackgroundFocus(page, "Library search focused");
  await page.waitForFunction(() => Number(getComputedStyle(document.querySelector('[data-testid="library-search-focus-ring"]')).opacity) > 0.99);

  const saveSamples = [];
  saveSamples.push(await measureOverlay(page, "save sheet", page.getByTestId("add-bookmark-fab").last(), {
    selector: "input", label: "Link",
  }));
  await saveDialog(page).waitFor({ state: "visible" });
  await waitForFocusTop(page, "Save opened");
  await linkInput(page).waitFor({ state: "visible" });
  check(await page.evaluate(() => document.activeElement?.getAttribute("aria-label") === "Link"), "Save opens with Link focused");
  check(await page.evaluate(() => document.activeElement?.getAttribute("aria-label") !== "Search your library"),
    "Save never leaves focus on the background library search");
  await linkInput(page).fill("focus.example.test/outside");

  saveSamples.push(await measureOverlay(page, "folder picker", folderTrigger(page), {
    selector: "input", label: "Find a folder",
  }));
  await activeMenu(page).waitFor({ state: "visible" });
  await waitForFocusTop(page, "Folder picker opened");
  check(await page.getByRole("textbox", { name: "Find a folder" }).evaluate((node) => node === document.activeElement),
    "folder picker owns focus from the Save trigger");

  // Real click outside the Save card (on the picker backdrop). It closes only
  // the picker; focus must go back to Link, never the background search.
  await page.mouse.click(4, mode.layout.viewport.height - 4);
  await page.waitForFunction(() => !document.querySelector('[role="menu"]:not([aria-hidden="true"])'), null, { timeout: 10000 });
  await page.waitForFunction(() => document.activeElement?.getAttribute("aria-label") === "Link", null, { timeout: 5000 })
    .catch(async () => {
      const active = await focusState(page);
      assert.fail(`outside click: expected Link focus, observed ${JSON.stringify(active)}`);
    });
  const afterOutside = await focusState(page);
  check(afterOutside?.label === "Link", "outside click returns focus to Link");
  check(afterOutside?.label !== "Search your library", "outside click never returns focus to the library search");
  await assertNoHiddenFocus(page, "Outside folder picker");
  check(await saveDialog(page).isVisible(), "outside click dismisses the picker but keeps Save open");
  check((await linkInput(page).inputValue()) === "focus.example.test/outside", "Save draft survives the outside click");

  await page.keyboard.press("Escape");
  await saveDialog(page).waitFor({ state: "hidden", timeout: 10000 });
  await waitForExit(page, "Save close");
  await assertNoOrphan(page, "Save close");
  await waitForBackgroundFocus(page, "Save close");
  check((await search.inputValue()) === "Overlay", "library query survives Save");
  await search.fill("");
  await readerRow(page).waitFor({ state: "visible" });
  return saveSamples;
}

async function progressPhase(page, mode, check, note) {
  await partialRow(page).click();
  await waitReaderReady(page);
  const partial = await assertProgressBarAtTop(page, "Partial restore", { value: "partial", scroll: true });
  note("partialProgress", partial);
  await assertArticlePresent(page, "Partial restore");
  await capture(page, mode, "partial-restore");
  await backToLibrary(page);

  await completeRow(page).click();
  await waitReaderReady(page);
  const complete = await assertProgressBarAtTop(page, "Complete restore", { value: "complete", scroll: false });
  note("completeProgress", complete);
  await assertArticlePresent(page, "Complete restore");
  await capture(page, mode, "complete-restore");
  await backToLibrary(page);
}

async function readerPhase(page, mode, cdp, check, note) {
  await readerRow(page).click();
  await waitReaderReady(page);
  await page.getByText("Overlay polish article", { exact: true }).first().waitFor({ state: "attached", timeout: 20000 });
  await assertArticlePresent(page, "Reader opened", { top: true });
  const initial = await progressState(page);
  check(initial.barPresent, "reader progress bar is mounted");
  check(initial.barTop != null && initial.barTop < 150, "reader progress bar starts at the header top");
  await capture(page, mode, "reader-settled");

  const samples = [];
  samples.push(await withScreencast(page, cdp, mode, "reader-overflow-open", () => measureOverlay(page, "reader overflow", button(page, "More article actions"), {
    selector: '[role="menuitem"]', label: "Highlights",
  })));
  await assertOverlayOpen(page, "Reader overflow open", { role: "menu" });
  await assertArticlePresent(page, "Reader overflow open");
  await capture(page, mode, "reader-overflow");
  await page.keyboard.press("Escape");
  await waitForExit(page, "Reader overflow close");
  await assertNoOrphan(page, "Reader overflow close");
  await waitForBackgroundFocus(page, "Reader overflow close");

  // TOC through the overflow menu: menu exit + panel entrance handoff.
  await openReaderMenu(page);
  const tocItem = activeMenu(page).getByRole("menuitem", { name: "Table of contents", exact: true });
  const handoff = await withScreencast(page, cdp, mode, "toc-handoff", async () =>
    measureOverlay(page, "TOC via overflow handoff", tocItem, {
      selector: '[role="button"]', label: "Go to Section 1",
    }));
  samples.push(handoff);
  await assertOverlayOpen(page, "Contents open", { name: "Contents" });
  note("tocHandoff", handoff);
  check(handoff.peakActiveLayers === 1, `Contents owns the only active overlay during handoff (${JSON.stringify(handoff)})`);
  check(await page.getByRole("button", { name: /^Go to Section \d+$/ }).count() >= 3,
    "Contents lists article sections");
  await assertArticlePresent(page, "Contents open");
  await capture(page, mode, "toc-open");
  await page.keyboard.press("Escape");
  await waitForExit(page, "Contents close");
  await assertNoOrphan(page, "Contents close");
  await waitForBackgroundFocus(page, "Contents close");

  samples.push(await measureOverlay(page, "TOC via FAB", button(page, "Table of contents"), {
    selector: '[role="button"]', label: "Go to Section 1",
  }));
  await assertOverlayOpen(page, "Contents FAB open", { name: "Contents" });
  await assertArticlePresent(page, "Contents FAB open");
  await page.keyboard.press("Escape");
  await waitForExit(page, "Contents FAB close");
  await assertNoOrphan(page, "Contents FAB close");
  await waitForBackgroundFocus(page, "Contents FAB close");

  // Highlights panel.
  await openReaderMenu(page);
  const highlightItem = activeMenu(page).getByRole("menuitem", { name: "Highlights", exact: true });
  samples.push(await measureOverlay(page, "highlights", highlightItem, {
    selector: '[role="button"]', labelPrefix: "Copy highlight:",
  }));
  await assertOverlayOpen(page, "Highlights open", { name: "Highlights" });
  check(await page.getByRole("button", { name: /^Copy highlight:/ }).count() === highlightSeed.length,
    "all fixture highlights are listed");
  await assertArticlePresent(page, "Highlights open");
  await capture(page, mode, "highlights-open");
  await page.keyboard.press("Escape");
  await waitForExit(page, "Highlights close");
  await assertNoOrphan(page, "Highlights close");
  await waitForBackgroundFocus(page, "Highlights close");

  // Reader settings: one text-size change only (the smoothness harness owns
  // the full preference matrix).
  samples.push(await withScreencast(page, cdp, mode, "reader-settings-open", () => measureOverlay(page, "reader settings", button(page, "Reader settings"), {
    selector: '[role="radio"]', label: "Large",
  })));
  const settings = page.getByRole("dialog", { name: "Reader" });
  await settings.waitFor({ state: "visible" });
  await waitForFocusTop(page, "Reader settings open");
  check(await settings.getByText("Text size", { exact: true }).first().isVisible(), "reader settings exposes text size");
  await capture(page, mode, "reader-settings", { settleMs: 1500 });
  const beforeSize = await page.evaluate(() => {
    const heading = [...document.querySelectorAll("h1,h2,h3,div,span")].find((node) =>
      node.textContent.trim() === "Section 1" && ![...node.children].some((child) => child.textContent.trim() === "Section 1"));
    return heading ? parseFloat(getComputedStyle(heading).fontSize) : null;
  });
  assert.ok(beforeSize != null, "reader body heading exposes a computed font size");
  await page.getByRole("radio", { name: "Large", exact: true }).click();
  await page.waitForFunction((size) => {
    const heading = [...document.querySelectorAll("h1,h2,h3,div,span")].find((node) =>
      node.textContent.trim() === "Section 1" && ![...node.children].some((child) => child.textContent.trim() === "Section 1"));
    return heading && parseFloat(getComputedStyle(heading).fontSize) > size;
  }, beforeSize, { timeout: 10000 });
  await assertArticlePresent(page, "Reader size changed");
  await page.keyboard.press("Escape");
  await waitForExit(page, "Reader settings close");
  await assertNoOrphan(page, "Reader settings close");
  await waitForBackgroundFocus(page, "Reader settings close");
  check((await progressState(page)).barPresent, "progress bar survives the settings handoff");

  // Rapid open/Escape/reopen while the previous surface is still exiting.
  const stress = [];
  for (let cycle = 0; cycle < 3; cycle += 1) {
    await openReaderMenu(page);
    await page.keyboard.press("Escape");
    await page.evaluate(() => {
      const node = document.querySelector('[role="button"][aria-label="More article actions"]');
      window.__reopenRetained = document.querySelectorAll("[data-overlay-layer]").length > 0;
      node?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    });
    await activeMenu(page).waitFor({ state: "visible", timeout: 10000 });
    const retained = await page.evaluate(() => window.__reopenRetained);
    stress.push({ cycle, retainedExit: retained });
    await assertArticlePresent(page, `Rapid overflow reopen ${cycle}`);
    await waitForFocusTop(page, `Rapid overflow reopen ${cycle}`);
    await assertNoHiddenFocus(page, `Rapid overflow reopen ${cycle}`);
    check(await page.locator('[role="menu"]:not([aria-hidden="true"])').count() === 1,
      `rapid overflow reopen ${cycle}: exactly one active menu`);
    check(mode.reducedMotion || retained, `rapid overflow reopen ${cycle}: reopened while the prior menu was exiting`);
    await page.keyboard.press("Escape");
    await waitForExit(page, `Rapid overflow close ${cycle}`);
    await assertNoOrphan(page, `Rapid overflow close ${cycle}`);
    await waitForBackgroundFocus(page, `Rapid overflow close ${cycle}`);
    await page.evaluate(() => window.__overlayProbe?.reset());
  }
  note("rapidOverflow", stress);

  const settingsStress = [];
  for (let cycle = 0; cycle < 2; cycle += 1) {
    await button(page, "Reader settings").click();
    await page.getByRole("dialog", { name: "Reader" }).waitFor({ state: "visible", timeout: 10000 });
    await waitForFocusTop(page, `Rapid settings ${cycle}`);
    await page.keyboard.press("Escape");
    await page.evaluate(() => {
      const node = document.querySelector('[role="button"][aria-label="Reader settings"]');
      window.__settingsRetained = document.querySelectorAll("[data-overlay-layer]").length > 0;
      node?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    });
    await page.getByRole("dialog", { name: "Reader" }).waitFor({ state: "visible", timeout: 10000 });
    const retained = await page.evaluate(() => window.__settingsRetained);
    settingsStress.push({ cycle, retainedExit: retained });
    await assertArticlePresent(page, `Rapid settings reopen ${cycle}`);
    await waitForFocusTop(page, `Rapid settings reopen ${cycle}`);
    await assertNoHiddenFocus(page, `Rapid settings reopen ${cycle}`);
    check(await page.locator('[role="dialog"][data-material-overlay="true"]').count() === 1,
      `rapid settings reopen ${cycle}: exactly one active dialog`);
    check(mode.reducedMotion || retained, `rapid settings reopen ${cycle}: reopened while the prior dialog was exiting`);
    await page.keyboard.press("Escape");
    await waitForExit(page, `Rapid settings close ${cycle}`);
    await assertNoOrphan(page, `Rapid settings close ${cycle}`);
    await waitForBackgroundFocus(page, `Rapid settings close ${cycle}`);
    await page.evaluate(() => window.__overlayProbe?.reset());
  }
  note("rapidSettings", settingsStress);
  await assertArticlePresent(page, "Reader after stress", { top: true });
  await capture(page, mode, "reader-stressed");
  return samples;
}

/* ------------------------------------------------------------------ */
/* Runner                                                              */
/* ------------------------------------------------------------------ */

const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.PLAYWRIGHT_CHROMIUM,
  args: ["--no-sandbox"],
});

try {
  for (const definition of MODES) {
    for (let repeat = 0; repeat < repeats; repeat += 1) {
      const mode = {
        ...definition,
        id: repeats > 1 ? `${definition.id}-r${repeat + 1}` : definition.id,
      };
      const context = await browser.newContext({
        viewport: mode.layout.viewport,
        colorScheme: mode.theme,
        reducedMotion: mode.reducedMotion ? "reduce" : "no-preference",
        hasTouch: mode.layout.hasTouch,
        isMobile: mode.layout.isMobile,
        deviceScaleFactor: 1,
      });
      const page = await context.newPage();
      page.setDefaultTimeout(30000);
      await installFixtures(page, mode);
      const cdp = await context.newCDPSession(page);
      if (cpuThrottle > 0) await cdp.send("Emulation.setCPUThrottlingRate", { rate: cpuThrottle });
      const modeResult = {
        id: mode.id,
        theme: mode.theme,
        expressive: mode.expressive,
        layout: mode.layout.name,
        viewport: mode.layout.viewport,
        input: mode.layout.hasTouch ? "touch" : "mouse",
        reducedMotion: mode.reducedMotion,
        cpuThrottle,
        checks: {},
        notes: {},
        samples: [],
        captures: [],
        frameSequences: [],
      };
      results.modes.push(modeResult);
      const check = (ok, label) => {
        modeResult.checks[label] = !!ok;
        assert.ok(ok, `${mode.id}: ${label}`);
      };
      const note = (label, value) => { modeResult.notes[label] = value; };
      const phase = async (label, run) => {
        try {
          await page.evaluate(() => window.__overlayProbe?.reset());
          await run();
        } catch (error) {
          results.errors.push({ kind: "phase", mode: mode.id, phase: label, message: error?.message ?? String(error) });
          await writeFailure(page, mode, label);
          throw error;
        }
      };
      try {
        await phase("library", async () => {
          modeResult.samples.push(...await libraryPhase(page, mode, check, note));
        });
        await phase("bookmark-long-hold", async () => {
          await bookmarkLongHoldPhase(page, mode, cdp, check, note);
        });
        await phase("folder-long-hold", async () => {
          await folderLongHoldPhase(page, mode, cdp, check, note);
        });
        await phase("leading-selection", async () => {
          await leadingSelectionPhase(page, mode, cdp, check);
        });
        await phase("save-focus", async () => {
          modeResult.samples.push(...await saveFocusPhase(page, mode, check));
        });
        await phase("progress", async () => {
          await progressPhase(page, mode, check, note);
        });
        await phase("reader", async () => {
          modeResult.samples.push(...await readerPhase(page, mode, cdp, check, note));
        });
        await assertNoHiddenFocus(page, "End of mode");
        assert.equal(await page.locator('[data-material-overlay="true"]').count(), 0, `${mode.id}: no active overlay remains at mode end`);
        await assertNoOrphan(page, "End of mode");
        modeResult.captures = results.captures.filter((entry) => entry.mode === mode.id).map((entry) => entry.name);
        modeResult.frameSequences = results.frameSequences.filter((entry) => entry.mode === mode.id).map((entry) => entry.name);
        console.log(JSON.stringify({
          mode: mode.id,
          samples: modeResult.samples.map(({ label, firstVisibleMs, settleMs }) => ({ label, firstVisibleMs, settleMs })),
          checks: Object.keys(modeResult.checks).length,
        }));
      } finally {
        await context.close();
      }
    }
  }

  const median = (values) => {
    const sorted = values.toSorted((a, b) => a - b);
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
  };
  results.summary = results.modes.map((mode) => ({
    mode: mode.id,
    samples: [...new Set(mode.samples.map((sample) => sample.label))].map((label) => {
      const group = mode.samples.filter((sample) => sample.label === label);
      return {
        label,
        count: group.length,
        medianFirstVisibleMs: median(group.map((sample) => sample.firstVisibleMs)),
        medianSettleMs: median(group.map((sample) => sample.settleMs)),
        maxLongTaskMs: Math.max(...group.map((sample) => sample.maxLongTaskMs)),
      };
    }),
  }));
  assert.deepEqual(results.errors, [], "Overlay polish run must have no console/page/phase errors");
} finally {
  results.finishedAt = new Date().toISOString();
  await writeFile(`${output}/results.json`, JSON.stringify(results, null, 2)).catch(() => {});
  await browser.close();
}
