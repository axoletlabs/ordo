/**
 * Save bookmark focus-edge regression harness (fixture-backed, web export).
 *
 * RUN (frozen baseline or final port; no build/server is started here):
 *   PLAYWRIGHT_MODULE=/tmp/opencode/node_modules/playwright/index.mjs \
 *   ORDO_UI_URL=http://127.0.0.1:8355 \
 *   node apps/mobile/scripts/save-focus-edges.mjs
 *
 * Defaults: dark color scheme + Expressive, 390x844 touch/isMobile portrait and
 * 1280x800 desktop-wide, every HTTP response mocked locally (no external
 * network), clipboard controlled per case through navigator.clipboard.
 *
 * Output: /tmp/opencode/ordo-save-focus-edges/{results.json,baseline-failures.json}
 * plus {portrait-390,desktop-1280}-<case>-<state>.png screenshots.
 *
 * ORDO_FOCUS_CASES=fast-folder-before-120,... limits cases.
 * ORDO_FOCUS_REPORT_ONLY=1 exits 0 even when cases fail (for baseline capture).
 * ORDO_FOCUS_CPU=4 optionally throttles CPU (default 0: focus, not timing).
 * ORDO_FOCUS_SHARE_ROUTE=/__fixture/share?url=... tests a parent-provided
 * share-intake route. Without it the web baseline has no share-intake surface:
 * expo-share-intent is disabled on web, so that case is reported as skipped.
 *
 * Focus invariant: activeElement must never remain on a background, aria-hidden,
 * or inert surface, and must not sit in the save form while a picker/menu or
 * sibling create dialog is the top active overlay. A handoff may cross a couple
 * of animation frames; hidden focus lasting >= HIDDEN_FOCUS_MS is a failure.
 * Every focusin plus mutation-triggered sweep is recorded for the case trace.
 *
 * This harness never edits production files and never invokes a real API.
 */
import assert from "node:assert/strict";
import { mkdir, readdir, rm, writeFile } from "node:fs/promises";

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? "playwright");
const base = (process.env.ORDO_UI_URL ?? "http://127.0.0.1:8355").replace(/\/+$/, "");
const output = process.env.ORDO_UI_OUTPUT ?? "/tmp/opencode/ordo-save-focus-edges";
const cpuThrottle = Number(process.env.ORDO_UI_CPU ?? 0);
const reportOnly = process.env.ORDO_FOCUS_REPORT_ONLY === "1";
const shareRoute = process.env.ORDO_FOCUS_SHARE_ROUTE ?? "";
const caseFilter = new Set((process.env.ORDO_FOCUS_CASES ?? "").split(",").map((value) => value.trim()).filter(Boolean));
const HIDDEN_FOCUS_MS = 60;
const FOCUS_WAIT_MS = 6000;
const stamp = "2026-10-20T12:00:00Z";

const LAYOUTS = [
  { name: "portrait-390", viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, shrunk: { width: 390, height: 500 } },
  { name: "desktop-1280", viewport: { width: 1280, height: 800 }, hasTouch: false, isMobile: false, shrunk: { width: 1280, height: 520 } },
];

const folderNames = [
  "Recipes", "Reading list", "Shopping", "Work projects", "Travel plans", "Archive 2026",
  "Design", "Cooking", "Garden", "Music", "Drafts", "Shared", "Research", "History",
  "Longform", "Weekend", "Locked diaries", "Inbox",
];
const tagNames = [
  "Shopping list", "Design", "To read", "Inspiration", "Recipes", "Travel", "Work", "Later",
  "Favorites", "Research", "Longform", "Notes", "Cooking", "Garden", "Music", "Shared",
  "Archive", "Ideas",
];
const folderSeed = folderNames.map((name, index) => ({
  id: `folder-${index + 1}`,
  name,
  icon: ["book-outline", "reader-outline", "folder-outline", "briefcase-outline", "airplane-outline"][index % 5],
  pinned: index === 1,
  protected: index === 16,
  lockType: index === 16 ? "pin" : null,
  pinLength: index === 16 ? 4 : null,
  bookmarkCount: index === 0 ? 2 : index < 4 ? 1 : 0,
  unreadCount: index < 2 ? 1 : 0,
  createdAt: stamp,
  updatedAt: stamp,
}));
const tagSummary = (index) => ({ id: `tag-${index + 1}`, name: tagNames[index], color: ["teal", "blue", "amber", "purple"][index % 4] });
const tagSeed = tagNames.map((name, index) => ({
  ...tagSummary(index),
  bookmarkCount: index < 4 ? 2 : index < 8 ? 1 : 0,
  createdAt: stamp,
  updatedAt: stamp,
}));
const bookmark = (id, folderId, title, domain, tagIndexes = []) => ({
  id,
  folderId,
  title,
  url: `https://${domain}/${id}`,
  domain,
  description: id === "probe-library" ? "A fixture bookmark behind every dialog." : null,
  fetchStatus: "ok",
  extractionReason: null,
  contentKind: "article",
  contentKindOverride: null,
  extractionVersion: 1,
  author: "Fixture author",
  publishedAt: stamp,
  readingTimeMinutes: 4,
  readProgress: 0,
  completedAt: null,
  isRead: false,
  remindAt: null,
  tags: tagIndexes.map((index) => tagSummary(index)),
  suggestedTags: [],
  createdAt: stamp,
  updatedAt: stamp,
});
const bookmarkSeed = [
  bookmark("probe-library", null, "Probe library bookmark", "example.test", [0, 1]),
  bookmark("probe-second", null, "Second library bookmark", "reading.example.test", [2]),
  bookmark("probe-third", null, "Third library bookmark", "notes.example.test", []),
  bookmark("probe-fourth", null, "Fourth library bookmark", "longform.example.test", [3]),
  bookmark("probe-recipe-one", "folder-1", "Recipe one", "cooking.example.test", [4]),
  bookmark("probe-recipe-two", "folder-1", "Recipe two", "cooking.example.test", []),
  bookmark("probe-reading", "folder-2", "Reading list item", "books.example.test", [0]),
  bookmark("probe-work", "folder-3", "Work item", "work.example.test", [2]),
];
const user = {
  id: "save-focus-fixture",
  displayName: "Fixture reader",
  email: "reader@example.test",
  emailVerified: true,
  hasAvatar: false,
  avatarUpdatedAt: null,
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

const results = {
  baseUrl: base,
  startedAt: new Date().toISOString(),
  layouts: LAYOUTS.map(({ name, viewport, hasTouch, isMobile }) => ({ name, viewport, hasTouch, isMobile, colorScheme: "dark", expressive: true })),
  environment: {
    cpuThrottle,
    hiddenFocusThresholdMs: HIDDEN_FOCUS_MS,
    note: "Variable viewport shrink is a web IME emulation, not a native keyboard claim.",
    shareRoute: shareRoute || null,
  },
  fixture: {
    folders: folderSeed.length,
    tags: tagSeed.length,
    bookmarks: bookmarkSeed.length,
    clipboard: "navigator.clipboard.readText controlled per case",
    network: "all non-app origins fulfilled locally",
  },
  cases: [],
  captures: [],
  errors: [],
};

await mkdir(output, { recursive: true });
if (process.env.ORDO_FOCUS_KEEP_OUTPUT !== "1") {
  const previous = await readdir(output).catch(() => []);
  const ownFile = /^(portrait-390|desktop-1280)-.+\.(png|txt)$|^(results|baseline-failures)\.json$/;
  for (const name of previous) {
    if (ownFile.test(name)) await rm(`${output}/${name}`, { force: true }).catch(() => {});
  }
}

/* ------------------------------------------------------------------ */
/* Init scripts                                                        */
/* ------------------------------------------------------------------ */

function focusProbeInit() {
  const probe = (window.__focusProbe = {
    seq: 0,
    events: [],
    hiddenFocus: [],
    marks: [],
    linkNode: null,
    race: {},
    startedAt: performance.now(),
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
    const hiddenAncestor = node.closest?.('[aria-hidden="true"]') ?? null;
    const inertAncestor = node.closest?.("[inert]") ?? null;
    const activeOverlays = [...document.querySelectorAll('[data-material-overlay="true"]')];
    const top = activeOverlays[activeOverlays.length - 1] ?? null;
    const rect = node.getBoundingClientRect();
    const style = getComputedStyle(node);
    const dialog = node.closest?.('[role="dialog"]') ?? null;
    const menu = node.closest?.('[role="menu"]') ?? null;
    return {
      tag: node.tagName,
      role: node.getAttribute?.("role"),
      label: node.getAttribute?.("aria-label"),
      testid: node.getAttribute?.("data-testid"),
      value: typeof node.value === "string" ? node.value : undefined,
      text: (node.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 80),
      dialog: dialog?.getAttribute?.("aria-label") ?? (dialog ? "dialog" : null),
      menu: menu ? (menu.getAttribute?.("aria-label") ?? "menu") : null,
      hidden: !!hiddenAncestor,
      hiddenBy: labelOf(hiddenAncestor),
      inert: !!inertAncestor,
      overlayFlag: node.closest?.("[data-material-overlay]")?.getAttribute?.("data-material-overlay") ?? null,
      inTopOverlay: !!top && top.contains(node),
      topOverlayCount: activeOverlays.length,
      body: node === document.body,
      background: !node.closest?.("[data-material-overlay]"),
      visible: rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none",
      pointerEvents: style.pointerEvents,
      at: Math.round(performance.now()),
    };
  };
  const sweep = () => {
    const active = describe(document.activeElement);
    if (active && !active.body && (active.hidden || active.inert)) {
      if (!hiddenSince || hiddenSince.active.label !== active.label || hiddenSince.active.hiddenBy !== active.hiddenBy) {
        hiddenSince = { at: performance.now(), endedAt: null, duration: 0, active };
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
  let scheduled = false;
  const scheduleSweep = () => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      sweep();
    });
  };
  document.addEventListener("focusin", () => {
    const active = describe(document.activeElement);
    probe.seq += 1;
    probe.events.push({ seq: probe.seq, kind: "focusin", at: Math.round(performance.now()), active });
    sweep();
  }, true);
  document.addEventListener("keydown", (event) => {
    if (event.target?.getAttribute?.("aria-label") === "Link") probe.race.lastLinkKeyAt = performance.now();
  }, true);
  document.addEventListener("click", (event) => {
    if (event.target?.closest?.('button[aria-label^="Folder, "]')) probe.race.folderClickAt = performance.now();
    if (event.target?.closest?.('button[aria-label^="Tags, "]')) probe.race.tagsClickAt = performance.now();
  }, true);
  for (const type of ["scroll", "wheel", "touchmove"]) {
    document.addEventListener(type, (event) => {
      const target = event.target;
      probe.events.push({ seq: ++probe.seq, kind: type, at: Math.round(performance.now()),
        target: { tag: target?.tagName ?? "document", role: target?.getAttribute?.("role"),
          label: target?.getAttribute?.("aria-label"), scrollTop: target?.scrollTop,
          dialog: target?.closest?.('[role="dialog"]')?.getAttribute("aria-label") },
        active: describe(document.activeElement) });
    }, true);
  }
  const observer = new MutationObserver(scheduleSweep);
  const observeRoot = () => {
    const root = document.documentElement;
    if (!root) {
      requestAnimationFrame(observeRoot);
      return;
    }
    observer.observe(root, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["aria-hidden", "inert", "style", "class"],
    });
  };
  observeRoot();
  setInterval(sweep, 50);
  probe.describeActive = () => describe(document.activeElement);
  probe.mark = (name) => {
    probe.seq += 1;
    const entry = { seq: probe.seq, kind: "mark", name, at: Math.round(performance.now()), active: describe(document.activeElement) };
    probe.marks.push(entry);
    probe.events.push(entry);
  };
  probe.clear = () => {
    hiddenSince = null;
    probe.seq = 0;
    probe.events.length = 0;
    probe.hiddenFocus.length = 0;
    probe.marks.length = 0;
    probe.linkNode = null;
    probe.race = {};
    probe.mark("case-start");
  };
  probe.hiddenPersistent = (threshold = 60) => {
    const now = performance.now();
    return probe.hiddenFocus
      .filter((entry) => ((entry.endedAt ?? now) - entry.at) >= threshold)
      .map((entry) => ({ at: Math.round(entry.at), duration: Math.round((entry.endedAt ?? now) - entry.at), active: entry.active }));
  };
  probe.summary = () => ({
    active: describe(document.activeElement),
    events: probe.events,
    hiddenFocus: probe.hiddenFocus.map((entry) => ({
      at: Math.round(entry.at),
      duration: Math.round((entry.endedAt ?? performance.now()) - entry.at),
      active: entry.active,
    })),
    marks: probe.marks,
    linkIdentity: !!probe.linkNode && probe.linkNode === document.querySelector('input[aria-label="Link"]'),
    linkConnected: !!probe.linkNode?.isConnected,
    race: probe.race,
  });
}

function clipboardInit() {
  const control = (window.__clipboardControl = {
    manual: true,
    text: "",
    delay: 0,
    pending: [],
    calls: [],
    written: [],
    resolveAll(value = null) {
      for (const entry of control.pending) {
        if (!entry.settled) {
          entry.settled = true;
          entry.resolve(value == null ? entry.text : value);
        }
      }
    },
    resolve(index = 0, value = null) {
      const entry = control.pending[index];
      if (!entry || entry.settled) return;
      entry.settled = true;
      entry.resolve(value == null ? entry.text : value);
    },
    reset() {
      control.manual = true;
      control.text = "";
      control.delay = 0;
      control.pending = [];
      control.calls = [];
      control.written = [];
    },
  });
  const stub = {
    readText() {
      return new Promise((resolve) => {
        const entry = {
          at: performance.now(),
          text: control.text,
          manual: control.manual,
          settled: false,
          resolve,
        };
        control.pending.push(entry);
        control.calls.push({ at: Math.round(entry.at), manual: control.manual, text: control.text });
        if (!control.manual) {
          const finish = () => {
            if (entry.settled) return;
            entry.settled = true;
            resolve(entry.text);
          };
          if (control.delay > 0) setTimeout(finish, control.delay);
          else queueMicrotask(finish);
        }
      });
    },
    async read() {
      const text = await stub.readText();
      return [{
        types: ["text/plain"],
        getType: async () => new Blob([text], { type: "text/plain" }),
      }];
    },
    async writeText(text) {
      control.written.push(text);
    },
    async write() { return true; },
  };
  try {
    Object.defineProperty(navigator, "clipboard", { configurable: true, get: () => stub });
  } catch {
    try { navigator.clipboard = stub; } catch { /* fixture records the gap below */ }
  }
}

async function installFixtures(page, layout) {
  await page.addInitScript(({ user, layout }) => {
    localStorage.setItem("ordo.settings", JSON.stringify({
      themeMode: "dark",
      expressive: true,
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
    void layout;
  }, { user, layout });
  await page.addInitScript(focusProbeInit);
  await page.addInitScript(clipboardInit);

  let folders = folderSeed.map((folder) => ({ ...folder }));
  let tags = tagSeed.map((tag) => ({ ...tag }));
  let bookmarks = bookmarkSeed.map((entry) => ({ ...entry, tags: entry.tags.map((tag) => ({ ...tag })) }));
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
        ...bookmark(`created-${++sequence}`, body.folderId ?? null, hostname, hostname,
          (body.tagIds ?? []).map((id) => tags.findIndex((tag) => tag.id === id)).filter((index) => index >= 0)),
        url: normalized,
        fetchStatus: "pending",
        extractionReason: null,
        contentKind: null,
        readingTimeMinutes: null,
        createdAt: now(),
        updatedAt: now(),
      };
      bookmarks = [created, ...bookmarks];
      return json(route, created);
    }
    if (path.startsWith("/api/bookmarks/article") || /^\/api\/bookmarks\/[^/]+$/.test(path)) {
      const id = decodeURIComponent(path.split("/")[3]);
      const entry = bookmarks.find((item) => item.id === id);
      if (method === "DELETE") bookmarks = bookmarks.filter((item) => item.id !== id);
      else if (entry && method === "PATCH") Object.assign(entry, body, { id, updatedAt: now() });
      return json(route, entry ? { ...entry, contentHtml: "<p>Fixture article body.</p>", highlights: [] } : { success: true });
    }
    if (path.startsWith("/api/import/")) return json(route, { status: "failed", failure: "Fixture import has no job." });
    return json(route, { success: true });
  });
  page.on("pageerror", (error) => {
    results.errors.push({ layout: layout.name, message: error.message });
  });
}

/* ------------------------------------------------------------------ */
/* DOM helpers                                                          */
/* ------------------------------------------------------------------ */

const activeOverlayMenu = (page) => page.locator('[role="menu"]:not([aria-hidden="true"])').last();
const saveDialog = (page) => page.getByRole("dialog", { name: "Save bookmark" });
const linkInput = (page) => page.locator('input[aria-label="Link"]');
const visibleLink = (page) => page.getByRole("textbox", { name: "Link", exact: true });
const folderTrigger = (page) => page.getByRole("button", { name: /^Folder, / }).last();
const tagsTrigger = (page) => page.getByRole("button", { name: /^Tags, / }).last();

async function waitForFocus(page, expected, timeout = FOCUS_WAIT_MS) {
  try {
    await page.waitForFunction((wanted) => {
      const describe = window.__focusProbe?.describeActive;
      if (!describe) return false;
      const active = describe();
      if (!active) return false;
      if (wanted.label != null && active.label !== wanted.label) return false;
      if (wanted.dialog != null && active.dialog !== wanted.dialog) return false;
      if (wanted.menu && !active.menu) return false;
      if (wanted.top && !active.inTopOverlay) return false;
      if (wanted.background && !active.background) return false;
      if (wanted.notBody && active.body) return false;
      if (wanted.visible && !active.visible) return false;
      if (wanted.notHidden !== false && (active.hidden || active.inert)) return false;
      return true;
    }, expected, { timeout });
  } catch (error) {
    const observed = await focusState(page).catch(() => null);
    const overlays = await overlayState(page).catch(() => null);
    throw new Error(
      `focus expectation timed out after ${timeout}ms; expected ${JSON.stringify(expected)}; `
      + `observed ${JSON.stringify(observed && { label: observed.label, tag: observed.tag, dialog: observed.dialog, hidden: observed.hidden, inert: observed.inert, body: observed.body, overlayFlag: observed.overlayFlag })}; `
      + `active overlays ${JSON.stringify(overlays?.top ?? null)}; ${error.message}`,
    );
  }
  return page.evaluate(() => window.__focusProbe.describeActive());
}

async function focusState(page) {
  return page.evaluate(() => window.__focusProbe?.describeActive() ?? null);
}

async function overlayState(page) {
  return page.evaluate(() => {
    const activeLayers = [...document.querySelectorAll('[data-material-overlay="true"]')];
    const top = activeLayers[activeLayers.length - 1] ?? null;
    return {
      activeLayers: activeLayers.length,
      top: top ? {
        role: top.getAttribute("role"),
        label: top.getAttribute("aria-label"),
        dialog: top.closest?.('[role="dialog"]')?.getAttribute("aria-label") ?? null,
        menu: !!top.querySelector?.('[role="menu"]') || top.getAttribute("role") === "menu",
      } : null,
      active: window.__focusProbe?.describeActive() ?? null,
      dialogs: [...document.querySelectorAll('[role="dialog"]')].map((node) => ({
        label: node.getAttribute("aria-label"),
        hidden: node.getAttribute("aria-hidden"),
        overlay: node.getAttribute("data-material-overlay"),
      })),
      menus: [...document.querySelectorAll('[role="menu"]')].map((node) => ({
        hidden: node.getAttribute("aria-hidden"),
        overlay: node.getAttribute("data-material-overlay"),
      })),
    };
  });
}

async function hiddenPersistent(page) {
  return page.evaluate((threshold) => window.__focusProbe?.hiddenPersistent(threshold) ?? [], HIDDEN_FOCUS_MS);
}

async function assertClean(page, label, { dialog = null, menu = false, background = false } = {}) {
  const active = await focusState(page);
  assert.ok(active, `${label}: activeElement is observable`);
  assert.ok(!active.body, `${label}: focus is on a control, not the document body (got ${active.label ?? active.tag})`);
  assert.ok(!active.hidden, `${label}: focus is not on an aria-hidden surface (focus: ${active.label ?? active.tag}, hidden by ${active.hiddenBy ?? "?"})`);
  assert.ok(!active.inert, `${label}: focus is not on an inert surface (focus: ${active.label ?? active.tag})`);
  assert.ok(active.visible, `${label}: focused control is visible`);
  if (background) assert.ok(active.background, `${label}: focus returned to the background (got ${active.label ?? active.tag})`);
  else assert.ok(active.inTopOverlay, `${label}: focus is inside the top active overlay (got ${active.label ?? active.tag})`);
  if (dialog) assert.equal(active.dialog, dialog, `${label}: focus is inside the ${dialog} dialog`);
  if (menu) assert.ok(active.menu, `${label}: focus is inside the open menu`);
}

async function assertNoHiddenFocus(page, label) {
  const persistent = await hiddenPersistent(page);
  assert.deepEqual(
    persistent.map((entry) => ({ duration: entry.duration, label: entry.active?.label, hiddenBy: entry.active?.hiddenBy, dialog: entry.active?.dialog })),
    [],
    `${label}: focus never remains on a hidden/inert/background surface`,
  );
}

async function markLink(page) {
  await page.evaluate(() => {
    window.__focusProbe.linkNode = document.querySelector('input[aria-label="Link"]');
    window.__focusProbe.mark("link-marked");
  });
}

async function assertLinkIdentity(page, label) {
  const same = await page.evaluate(() => {
    const probe = window.__focusProbe;
    const current = document.querySelector('input[aria-label="Link"]');
    return { same: !!probe.linkNode && probe.linkNode === current, connected: !!probe.linkNode?.isConnected, hasCurrent: !!current };
  });
  assert.ok(same.hasCurrent, `${label}: Link input still exists`);
  assert.ok(same.connected, `${label}: original Link input is still connected`);
  assert.ok(same.same, `${label}: Link input DOM identity survives the text/picker flow`);
}

async function linkDraft(page) {
  return linkInput(page).evaluate((node) => node.value).catch(() => null);
}

async function assertDraft(page, expected, label) {
  const value = await linkDraft(page);
  assert.equal(value, expected, `${label}: URL draft is ${JSON.stringify(expected)}`);
}

async function capture(page, layout, record, state) {
  const path = `${output}/${layout.name}-${record.id}-${state}.png`;
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await page.screenshot({ path });
  results.captures.push({ layout: layout.name, case: record.id, state, path });
  record.captures.push(state);
}

async function waitLibraryReady(page) {
  await page.getByTestId("add-bookmark-fab").last().waitFor({ state: "visible", timeout: 20000 });
  await page.getByRole("textbox", { name: "Search your library" }).waitFor({ state: "visible" });
  await page.getByRole("button", { name: /^Recipes, / }).first().waitFor({ state: "visible" });
  await page.evaluate(() => document.fonts?.ready).catch(() => {});
}

async function gotoLibrary(page) {
  await page.goto(base, { waitUntil: "domcontentloaded" });
  await waitLibraryReady(page);
  await page.evaluate(() => window.__focusProbe?.clear());
}

async function openSave(page) {
  const fab = page.getByTestId("add-bookmark-fab").last();
  await fab.waitFor({ state: "visible" });
  await fab.click();
  const dialog = saveDialog(page);
  const menuItem = page.getByRole("menuitem", { name: "Save bookmark", exact: true });
  await page.waitForFunction(() => {
    const dialogNode = document.querySelector('[role="dialog"][aria-label="Save bookmark"]');
    if (dialogNode && dialogNode.getAttribute("aria-hidden") !== "true") return true;
    return [...document.querySelectorAll('[role="menuitem"]')].some((node) => (node.textContent ?? "").trim() === "Save bookmark");
  });
  if (!(await dialog.isVisible().catch(() => false))) await menuItem.click();
  await dialog.waitFor({ state: "visible" });
  await waitForFocus(page, { label: "Link", dialog: "Save bookmark", top: true });
  await page.evaluate(() => window.__focusProbe.mark("save-open"));
}

async function closeSave(page, { waitForRestore = true } = {}) {
  await page.keyboard.press("Escape");
  await saveDialog(page).waitFor({ state: "hidden" });
  if (waitForRestore) {
    await waitForFocus(page, { background: true, notBody: true }, 3000);
    await assertNoHiddenFocus(page, "Save closed");
  }
}

async function closeSaveViaButton(page) {
  const close = page.getByRole("button", { name: "Close dialog", exact: true });
  await close.focus();
  await close.click();
  await saveDialog(page).waitFor({ state: "hidden" });
  await waitForFocus(page, { background: true, notBody: true }, 3000);
  await assertNoHiddenFocus(page, "Save closed via header button");
}

async function openFolderPicker(page) {
  await folderTrigger(page).click();
  await activeOverlayMenu(page).waitFor({ state: "visible" });
  await page.mouse.move(1, 1);
  await waitForFocus(page, { label: "Find a folder", menu: true, top: true });
  await page.evaluate(() => window.__focusProbe.mark("folder-picker-open"));
}

async function openTagsPicker(page) {
  await tagsTrigger(page).click();
  await activeOverlayMenu(page).waitFor({ state: "visible" });
  await page.mouse.move(1, 1);
  await waitForFocus(page, { label: "Find a tag", menu: true, top: true });
  await page.evaluate(() => window.__focusProbe.mark("tags-picker-open"));
}

async function chooseFolder(page, name) {
  const menu = activeOverlayMenu(page);
  await menu.getByRole("menuitemradio", { name, exact: true }).click();
  await page.getByRole("button", { name: `Folder, ${name}`, exact: true }).waitFor({ state: "visible" });
  await waitForFocus(page, { dialog: "Save bookmark", top: true });
}

async function createFolderFromPicker(page, { submit = false, name = "Fresh folder" } = {}) {
  await openFolderPicker(page);
  const menu = activeOverlayMenu(page);
  await menu.getByRole("menuitem", { name: "New folder", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "New folder" });
  await dialog.waitFor({ state: "visible" });
  await waitForFocus(page, { label: "Name", dialog: "New folder", top: true });
  if (submit) {
    await dialog.getByRole("textbox", { name: "Name", exact: true }).fill(name);
    await dialog.getByRole("button", { name: "Create folder", exact: true }).click();
    await page.getByRole("button", { name: `Folder, ${name}`, exact: true }).waitFor({ state: "visible" });
  } else {
    await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  }
  await dialog.waitFor({ state: "hidden" });
  await waitForFocus(page, { dialog: "Save bookmark", top: true });
}

async function createTagFromPicker(page, { submit = false, name = "Fresh tag" } = {}) {
  await openTagsPicker(page);
  await activeOverlayMenu(page).getByRole("menuitem", { name: "New tag", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "New tag" });
  await dialog.waitFor({ state: "visible" });
  await waitForFocus(page, { label: "Tag name", dialog: "New tag", top: true });
  if (submit) {
    await dialog.getByRole("textbox", { name: "Tag name", exact: true }).fill(name);
    await dialog.getByRole("button", { name: "Create", exact: true }).click();
    await page.getByRole("button", { name: `Tags, ${name}`, exact: true }).waitFor({ state: "visible" });
  } else {
    await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  }
  await dialog.waitFor({ state: "hidden" });
  await waitForFocus(page, { dialog: "Save bookmark", top: true });
}

async function configureClipboard(page, { manual = true, text = "", delay = 0 } = {}) {
  await page.evaluate(({ manual, text, delay }) => {
    const control = window.__clipboardControl;
    control.manual = manual;
    control.text = text;
    control.delay = delay;
    control.pending = [];
    control.calls = [];
    control.written = [];
  }, { manual, text, delay });
}

async function resolveClipboard(page, value = null) {
  await page.evaluate((text) => window.__clipboardControl.resolveAll(text), value);
}

async function clickPaste(page) {
  await page.getByRole("button", { name: "Paste link from clipboard" }).click();
}

async function waitClipboardPending(page, count = 1) {
  await page.waitForFunction((expected) => (window.__clipboardControl?.pending?.length ?? 0) >= expected, count);
}

/* ------------------------------------------------------------------ */
/* Cases                                                                */
/* ------------------------------------------------------------------ */

const cases = [
  {
    id: "library-search-to-save",
    description: "A previously focused library search loses focus to Save, keeps its query, and never keeps a stale focus ring.",
    run: async ({ page, layout, record, check }) => {
      const search = page.getByRole("textbox", { name: "Search your library" });
      await search.click();
      await page.keyboard.type("Probe");
      await waitForFocus(page, { label: "Search your library" });
      await page.waitForFunction(() => Number(getComputedStyle(document.querySelector('[data-testid="library-search-focus-ring"]')).opacity) > 0.99);
      await capture(page, layout, record, "library-search-focused");

      await openSave(page);
      await assertClean(page, "Save opened", { dialog: "Save bookmark" });
      await assertNoHiddenFocus(page, "Save opened");
      const libraryActive = await page.evaluate(() => {
        const node = document.querySelector('input[aria-label="Search your library"]');
        return {
          focused: node === document.activeElement,
          hidden: !!node?.closest('[aria-hidden="true"], [inert]'),
          value: node?.value,
        };
      });
      check(!libraryActive.focused, "library search is not the active field behind Save");
      check(libraryActive.hidden, "library search sits in the isolated background surface");
      check(libraryActive.value === "Probe", "library query survives the dialog handoff");
      await page.waitForFunction(() => Number(getComputedStyle(document.querySelector('[data-testid="library-search-focus-ring"]')).opacity) < 0.01);
      await capture(page, layout, record, "save-over-search");

      await closeSave(page);
      const after = await page.evaluate(() => {
        const node = document.querySelector('input[aria-label="Search your library"]');
        return { value: node?.value, ring: Number(getComputedStyle(document.querySelector('[data-testid="library-search-focus-ring"]')).opacity) };
      });
      check(after.value === "Probe", "closing Save preserves the library query");
      check(after.ring < 0.01, "closing Save does not leave a stale library focus ring");
      await assertNoHiddenFocus(page, "Save closed");
      await capture(page, layout, record, "library-restored");

      await search.click();
      await waitForFocus(page, { label: "Search your library" });
      await page.waitForFunction(() => Number(getComputedStyle(document.querySelector('[data-testid="library-search-focus-ring"]')).opacity) > 0.99);
      check((await search.inputValue()) === "Probe", "refocusing the library search keeps its query");
    },
  },
  {
    id: "fast-folder-before-120",
    description: "Type and open Folder inside the 120ms picker-focus delay; focus must move to the top picker, never stay on the inert save form.",
    run: async ({ page, layout, record, check }) => {
      await openSave(page);
      await markLink(page);
      await page.keyboard.type("race.example.test/folder");
      await page.evaluate(() => document.querySelector('button[aria-label^="Folder, "]').click());
      const race = await page.evaluate(() => {
        const probe = window.__focusProbe;
        return {
          keyAt: probe.race.lastLinkKeyAt ?? null,
          clickAt: probe.race.folderClickAt ?? null,
          delta: probe.race.lastLinkKeyAt != null && probe.race.folderClickAt != null
            ? probe.race.folderClickAt - probe.race.lastLinkKeyAt : null,
        };
      });
      record.notes.folderRaceMs = race.delta;
      check(race.delta != null && race.delta >= 0 && race.delta < 120, `Folder opened ${race.delta?.toFixed?.(1) ?? "?"}ms after the last Link keystroke (<120ms)`);
      await waitForFocus(page, { label: "Find a folder", menu: true, top: true });
      await assertClean(page, "Folder picker owns focus", { menu: true });
      await assertNoHiddenFocus(page, "Folder picker owns focus");
      await assertDraft(page, "race.example.test/folder", "Folder picker open");
      await assertLinkIdentity(page, "Folder picker open");
      await capture(page, layout, record, "folder-picker-fast");

      await chooseFolder(page, "Recipes");
      await assertClean(page, "Folder selected", { dialog: "Save bookmark" });
      await assertNoHiddenFocus(page, "Folder selected");
      await assertDraft(page, "race.example.test/folder", "Folder selected");
      await assertLinkIdentity(page, "Folder selected");
      await capture(page, layout, record, "folder-picked");
      await closeSaveViaButton(page);
    },
  },
  {
    id: "fast-tags-before-120",
    description: "Type and open Tags inside 120ms; tag search owns focus, toggling a tag stays in the menu, and the URL draft survives.",
    run: async ({ page, layout, record, check }) => {
      await openSave(page);
      await markLink(page);
      await page.keyboard.type("race.example.test/tags");
      await page.evaluate(() => document.querySelector('button[aria-label^="Tags, "]').click());
      const race = await page.evaluate(() => {
        const probe = window.__focusProbe;
        return {
          keyAt: probe.race.lastLinkKeyAt ?? null,
          clickAt: probe.race.tagsClickAt ?? null,
          delta: probe.race.lastLinkKeyAt != null && probe.race.tagsClickAt != null
            ? probe.race.tagsClickAt - probe.race.lastLinkKeyAt : null,
        };
      });
      record.notes.tagsRaceMs = race.delta;
      check(race.delta != null && race.delta >= 0 && race.delta < 120, `Tags opened ${race.delta?.toFixed?.(1) ?? "?"}ms after the last Link keystroke (<120ms)`);
      await waitForFocus(page, { label: "Find a tag", menu: true, top: true });
      await assertClean(page, "Tag picker owns focus", { menu: true });
      await assertNoHiddenFocus(page, "Tag picker owns focus");
      await assertDraft(page, "race.example.test/tags", "Tag picker open");
      await assertLinkIdentity(page, "Tag picker open");
      await capture(page, layout, record, "tag-picker-fast");

      await activeOverlayMenu(page).getByRole("menuitemcheckbox", { name: "Design", exact: true }).click();
      await assertClean(page, "Tag toggled", { menu: true });
      await assertNoHiddenFocus(page, "Tag toggled");
      await assertDraft(page, "race.example.test/tags", "Tag toggled");
      await assertLinkIdentity(page, "Tag toggled");
      await page.keyboard.press("Escape");
      await activeOverlayMenu(page).waitFor({ state: "hidden" });
      await waitForFocus(page, { dialog: "Save bookmark", top: true });
      await assertDraft(page, "race.example.test/tags", "Tag picker dismissed");
      await capture(page, layout, record, "tag-picked");
      await closeSaveViaButton(page);
    },
  },
  {
    id: "picker-dismiss-reopen-race",
    description: "Dismiss the picker and reopen it before the first 120ms timer; the new search takes focus once, with no hidden stale focus.",
    run: async ({ page, layout, record, check }) => {
      await openSave(page);
      await page.keyboard.type("race.example.test/reopen-picker");
      await page.evaluate(() => document.querySelector('button[aria-label^="Folder, "]').click());
      await page.keyboard.press("Escape");
      await page.waitForFunction(() => {
        const menu = document.querySelector('[role="menu"]:not([aria-hidden="true"])');
        const dialog = document.querySelector('[role="dialog"][aria-label="Save bookmark"]');
        return !menu || !dialog || dialog.getAttribute("aria-hidden") === "true";
      });
      const afterDismiss = await overlayState(page);
      const menuStillOpen = afterDismiss.menus.some((menu) => menu.hidden === null);
      const saveStillVisible = await saveDialog(page).isVisible().catch(() => false);
      check(saveStillVisible && !menuStillOpen,
        `Escape before the picker owns focus dismisses only the picker (save=${saveStillVisible}, menu=${menuStillOpen})`);
      await waitForFocus(page, { dialog: "Save bookmark", top: true });
      await page.evaluate(() => document.querySelector('button[aria-label^="Folder, "]').click());
      await waitForFocus(page, { label: "Find a folder", menu: true, top: true });
      await assertClean(page, "Reopened picker owns focus", { menu: true });
      await page.waitForTimeout(350);
      const active = await focusState(page);
      check(active?.label === "Find a folder", "the new picker keeps focus after both 120ms timers settle");
      await assertNoHiddenFocus(page, "Reopened picker");
      await assertDraft(page, "race.example.test/reopen-picker", "Reopened picker");
      await capture(page, layout, record, "picker-reopened");
      await activeOverlayMenu(page).getByRole("menuitem", { name: "New folder", exact: true }).focus();
      await page.keyboard.press("Escape");
      await waitForFocus(page, { dialog: "Save bookmark", top: true });
      await page.keyboard.press("Escape");
      await saveDialog(page).waitFor({ state: "hidden" });
      await waitForFocus(page, { background: true, notBody: true }, 3000);
      await assertNoHiddenFocus(page, "Picker race closed");
    },
  },
  {
    id: "dialog-close-reopen-before-600",
    description: "Close Save and reopen it inside the 600ms trigger-restore deadline; the new dialog's Link field must win.",
    run: async ({ page, layout, record, check }) => {
      await openSave(page);
      await page.keyboard.type("first.example.test/rapid");
      const startedAt = await page.evaluate(() => performance.now());
      await page.keyboard.press("Escape");
      await page.evaluate(() => document.querySelector('[data-testid="add-bookmark-fab"]').click());
      const reopenedAt = await page.evaluate(() => performance.now());
      record.notes.reopenInsideRestoreMs = Math.round(reopenedAt - startedAt);
      check(reopenedAt - startedAt < 600, `Save reopened in ${Math.round(reopenedAt - startedAt)}ms (<600ms restore deadline)`);
      await saveDialog(page).waitFor({ state: "visible" });
      await waitForFocus(page, { label: "Link", dialog: "Save bookmark", top: true });
      await assertClean(page, "Rapid reopen", { dialog: "Save bookmark" });
      await assertDraft(page, "", "Rapid reopen starts a blank draft");
      await page.waitForTimeout(750);
      const active = await focusState(page);
      check(active?.label === "Link" && !active.hidden, "the old restore loop does not steal focus after the deadline");
      await assertNoHiddenFocus(page, "Rapid reopen");
      await capture(page, layout, record, "rapid-reopen");
      await closeSave(page);
    },
  },
  {
    id: "folder-create-cancel",
    description: "Folder -> New folder -> Cancel returns focus to the visible save form with the URL draft and Link input identity intact.",
    run: async ({ page, layout, record, check }) => {
      await openSave(page);
      await page.keyboard.type("draft.example.test/folder-cancel");
      await markLink(page);
      await openFolderPicker(page);
      await activeOverlayMenu(page).getByRole("menuitem", { name: "New folder", exact: true }).click();
      const dialog = page.getByRole("dialog", { name: "New folder" });
      await dialog.waitFor({ state: "visible" });
      await waitForFocus(page, { label: "Name", dialog: "New folder", top: true });
      await assertClean(page, "New folder owns focus", { dialog: "New folder" });
      await assertNoHiddenFocus(page, "New folder owns focus");
      await assertDraft(page, "draft.example.test/folder-cancel", "New folder open");
      await assertLinkIdentity(page, "New folder open");
      await capture(page, layout, record, "create-folder-open");

      await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
      await dialog.waitFor({ state: "hidden" });
      await waitForFocus(page, { dialog: "Save bookmark", top: true });
      await assertClean(page, "Folder create cancelled", { dialog: "Save bookmark" });
      await assertNoHiddenFocus(page, "Folder create cancelled");
      await assertDraft(page, "draft.example.test/folder-cancel", "Folder create cancelled");
      await assertLinkIdentity(page, "Folder create cancelled");
      await capture(page, layout, record, "create-folder-cancelled");
      await closeSave(page);
    },
  },
  {
    id: "folder-create-submit",
    description: "Folder -> New folder -> Create selects the new folder, returns focus to Save, and keeps the URL draft and Link node.",
    run: async ({ page, layout, record, check }) => {
      await openSave(page);
      await page.keyboard.type("draft.example.test/folder-submit");
      await markLink(page);
      await createFolderFromPicker(page, { submit: true, name: "Fresh folder" });
      await assertClean(page, "Folder created", { dialog: "Save bookmark" });
      await assertNoHiddenFocus(page, "Folder created");
      await assertDraft(page, "draft.example.test/folder-submit", "Folder created");
      await assertLinkIdentity(page, "Folder created");
      check((await folderTrigger(page).getAttribute("aria-label")) === "Folder, Fresh folder", "new folder becomes the destination");
      await capture(page, layout, record, "folder-created");
      await folderTrigger(page).focus();
      await closeSave(page);
    },
  },
  {
    id: "tag-create-cancel",
    description: "Tags -> New tag -> Cancel returns focus to the visible save form with the URL draft and Link input identity intact.",
    run: async ({ page, layout, record, check }) => {
      await openSave(page);
      await page.keyboard.type("draft.example.test/tag-cancel");
      await markLink(page);
      await openTagsPicker(page);
      await activeOverlayMenu(page).getByRole("menuitem", { name: "New tag", exact: true }).click();
      const dialog = page.getByRole("dialog", { name: "New tag" });
      await dialog.waitFor({ state: "visible" });
      await waitForFocus(page, { label: "Tag name", dialog: "New tag", top: true });
      await assertClean(page, "New tag owns focus", { dialog: "New tag" });
      await assertNoHiddenFocus(page, "New tag owns focus");
      await assertDraft(page, "draft.example.test/tag-cancel", "New tag open");
      await assertLinkIdentity(page, "New tag open");
      await capture(page, layout, record, "create-tag-open");

      await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
      await dialog.waitFor({ state: "hidden" });
      await waitForFocus(page, { dialog: "Save bookmark", top: true });
      await assertClean(page, "Tag create cancelled", { dialog: "Save bookmark" });
      await assertNoHiddenFocus(page, "Tag create cancelled");
      await assertDraft(page, "draft.example.test/tag-cancel", "Tag create cancelled");
      await assertLinkIdentity(page, "Tag create cancelled");
      await capture(page, layout, record, "create-tag-cancelled");
      await closeSave(page);
    },
  },
  {
    id: "tag-create-submit",
    description: "Tags -> New tag -> Create selects the new tag, returns focus to Save, and keeps the URL draft and Link node.",
    run: async ({ page, layout, record, check }) => {
      await openSave(page);
      await page.keyboard.type("draft.example.test/tag-submit");
      await markLink(page);
      await createTagFromPicker(page, { submit: true, name: "Fresh tag" });
      await assertClean(page, "Tag created", { dialog: "Save bookmark" });
      await assertNoHiddenFocus(page, "Tag created");
      await assertDraft(page, "draft.example.test/tag-submit", "Tag created");
      await assertLinkIdentity(page, "Tag created");
      check(((await tagsTrigger(page).getAttribute("aria-label")) ?? "").startsWith("Tags, Fresh tag"), "new tag becomes the tag selection");
      await capture(page, layout, record, "tag-created");
      await tagsTrigger(page).focus();
      await closeSave(page);
    },
  },
  {
    id: "parent-close-folder-picker",
    description: "Close the parent Save dialog while the folder picker is the active child; no hidden child or save surface may keep focus.",
    run: async ({ page, layout, record, check }) => {
      await openSave(page);
      await page.keyboard.type("draft.example.test/parent-folder");
      await openFolderPicker(page);
      await capture(page, layout, record, "parent-folder-picker");
      await page.evaluate(() => {
        const dialog = document.querySelector('[role="dialog"][aria-label="Save bookmark"]');
        const cancel = [...dialog.querySelectorAll('button[aria-label="Cancel"]')][0];
        cancel.click();
      });
      await saveDialog(page).waitFor({ state: "hidden" });
      await waitForFocus(page, { background: true, notBody: true }, 3000);
      const overlays = await overlayState(page);
      check(overlays.activeLayers === 0, "closing the parent dismisses the child picker too");
      check(!overlays.menus.some((menu) => menu.hidden === null), "no active menu survives the parent close");
      await assertNoHiddenFocus(page, "Parent closed under folder picker");
      await capture(page, layout, record, "parent-closed");

      await openSave(page);
      await assertClean(page, "Reopened after parent close", { dialog: "Save bookmark" });
      await assertDraft(page, "", "Reopened after parent close starts blank");
      await closeSave(page);
    },
  },
  {
    id: "parent-close-create-folder",
    description: "Close the obscured parent Save dialog while the New folder child owns focus; the child closes and focus returns visibly to the library.",
    run: async ({ page, layout, record, check }) => {
      await openSave(page);
      await page.keyboard.type("draft.example.test/parent-create");
      await openFolderPicker(page);
      await activeOverlayMenu(page).getByRole("menuitem", { name: "New folder", exact: true }).click();
      const dialog = page.getByRole("dialog", { name: "New folder" });
      await dialog.waitFor({ state: "visible" });
      await waitForFocus(page, { label: "Name", dialog: "New folder", top: true });
      await capture(page, layout, record, "parent-create-folder-open");
      await page.evaluate(() => {
        const save = document.querySelector('[role="dialog"][aria-label="Save bookmark"]');
        const cancel = save.querySelector('button[aria-label="Cancel"]');
        cancel.click();
      });
      await dialog.waitFor({ state: "hidden" });
      await saveDialog(page).waitFor({ state: "hidden" });
      await waitForFocus(page, { background: true, notBody: true }, 3000);
      const overlays = await overlayState(page);
      check(overlays.activeLayers === 0, "no active overlay remains after the parent and child close");
      await assertNoHiddenFocus(page, "Parent closed under New folder");
      await capture(page, layout, record, "parent-create-folder-closed");

      await openSave(page);
      await assertClean(page, "Reopened after child close", { dialog: "Save bookmark" });
      await assertDraft(page, "", "Reopened after child close starts blank");
      await closeSave(page);
    },
  },
  {
    id: "clipboard-close-pending",
    description: "A delayed clipboard read resolving after Save closes must not inject text, steal focus, or reopen the dialog.",
    run: async ({ page, layout, record, check }) => {
      await openSave(page);
      await configureClipboard(page, { manual: true, text: "https://clip.example.test/pending" });
      await clickPaste(page);
      await waitClipboardPending(page);
      await page.keyboard.press("Escape");
      await saveDialog(page).waitFor({ state: "hidden" });
      await resolveClipboard(page);
      await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      check((await linkDraft(page)) === "", "late clipboard result did not write the closed draft");
      check(!(await saveDialog(page).isVisible().catch(() => false)), "late clipboard result did not reopen Save");
      await waitForFocus(page, { background: true, notBody: true }, 3000);
      await assertNoHiddenFocus(page, "Clipboard resolved after close");

      await openSave(page);
      await assertDraft(page, "", "Reopened after pending clipboard is blank");
      await configureClipboard(page, { manual: false, text: "https://clip.example.test/ready" });
      await clickPaste(page);
      await page.waitForFunction(() => document.querySelector('input[aria-label="Link"]')?.value === "https://clip.example.test/ready");
      await waitForFocus(page, { label: "Link", dialog: "Save bookmark", top: true });
      await assertClean(page, "Clipboard applied", { dialog: "Save bookmark" });
      await assertDraft(page, "https://clip.example.test/ready", "Clipboard applied");
      await assertNoHiddenFocus(page, "Clipboard applied");
      await capture(page, layout, record, "clipboard-ready");
      await folderTrigger(page).focus();
      await closeSave(page);
    },
  },
  {
    id: "clipboard-reopen-pending",
    description: "A stale clipboard read resolves after close/reopen; it must not overwrite the new draft or pull focus out of the new Link field.",
    run: async ({ page, layout, record, check }) => {
      await openSave(page);
      await page.keyboard.type("draft.example.test/before-paste");
      await configureClipboard(page, { manual: true, text: "https://clip.example.test/stale" });
      await clickPaste(page);
      await waitClipboardPending(page);
      await page.keyboard.press("Escape");
      await saveDialog(page).waitFor({ state: "hidden" });
      await page.evaluate(() => document.querySelector('[data-testid="add-bookmark-fab"]').click());
      await saveDialog(page).waitFor({ state: "visible" });
      await waitForFocus(page, { label: "Link", dialog: "Save bookmark", top: true });
      await page.keyboard.type("draft.example.test/newer");
      await resolveClipboard(page);
      await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      await assertDraft(page, "draft.example.test/newer", "Stale clipboard result resolved");
      await assertClean(page, "Stale clipboard result resolved", { dialog: "Save bookmark" });
      check((await focusState(page))?.label === "Link", "new Link field still owns focus after the stale result");
      await assertNoHiddenFocus(page, "Stale clipboard result");
      await capture(page, layout, record, "clipboard-stale-resolved");
      await closeSave(page);
    },
  },
  {
    id: "reopen-different-drafts",
    description: "Successive Save sessions with different typed URLs start blank again; no draft bleeds between sessions.",
    run: async ({ page, layout, record, check }) => {
      await openSave(page);
      await page.keyboard.type("first.example.test/draft-a");
      await closeSave(page);
      await openSave(page);
      await assertDraft(page, "", "Second session starts blank after draft A");
      await page.keyboard.type("second.example.test/draft-b");
      await closeSave(page);
      await openSave(page);
      await assertDraft(page, "", "Third session starts blank after draft B");
      await capture(page, layout, record, "reopened-blank");
      check(await visibleLink(page).evaluate((node) => node === document.activeElement), "reopened Link field is the active field");
      await closeSave(page);
    },
  },
  {
    id: "keyboard-containment",
    description: "Tab/Shift+Tab stay inside Save and inside the folder picker; Escape releases the picker first, then Save.",
    run: async ({ page, layout, record, check }) => {
      await openSave(page);
      await page.keyboard.type("draft.example.test/keyboard");
      for (let index = 0; index < 14; index += 1) {
        await page.keyboard.press("Tab");
        const active = await focusState(page);
        check(active?.dialog === "Save bookmark" && !active.hidden && !active.inert,
          `Tab ${index + 1} stays on a visible Save control (${active?.label ?? active?.tag})`);
      }
      for (let index = 0; index < 4; index += 1) {
        await page.keyboard.press("Shift+Tab");
        const active = await focusState(page);
        check(active?.dialog === "Save bookmark" && !active.hidden && !active.inert,
          `Shift+Tab ${index + 1} stays on a visible Save control (${active?.label ?? active?.tag})`);
      }
      await capture(page, layout, record, "keyboard-save");

      await openFolderPicker(page);
      for (let index = 0; index < 10; index += 1) {
        await page.keyboard.press("Tab");
        const active = await focusState(page);
        check(!!active?.menu && !active.hidden && !active.inert,
          `Tab ${index + 1} stays inside the folder picker (${active?.label ?? active?.tag})`);
      }
      for (let index = 0; index < 4; index += 1) {
        await page.keyboard.press("Shift+Tab");
        const active = await focusState(page);
        check(!!active?.menu && !active.hidden && !active.inert,
          `Shift+Tab ${index + 1} stays inside the folder picker (${active?.label ?? active?.tag})`);
      }
      await capture(page, layout, record, "keyboard-folder-picker");
      await page.keyboard.press("Escape");
      await activeOverlayMenu(page).waitFor({ state: "hidden" });
      await waitForFocus(page, { dialog: "Save bookmark", top: true });
      check(await saveDialog(page).isVisible(), "first Escape keeps Save open after releasing the picker");
      await page.keyboard.press("Escape");
      await saveDialog(page).waitFor({ state: "hidden" });
      await waitForFocus(page, { background: true, notBody: true }, 3000);
      await assertNoHiddenFocus(page, "Keyboard close");
      check(await visibleLink(page).count() === 0, "closing Escape removes the save form from the accessibility tree");
    },
  },
  {
    id: "escape-and-browser-back",
    description: "Escape and browser Back leave no overlay focus behind; web Back stands in for route navigation, hardware Back is native-only.",
    run: async ({ page, layout, record, check }) => {
      await page.getByRole("button", { name: /^Recipes, / }).first().click();
      await page.waitForFunction(() => location.pathname.startsWith("/folder/"));
      await page.getByTestId("add-bookmark-fab").last().waitFor({ state: "visible" });
      await openSave(page);
      await page.keyboard.type("draft.example.test/navigation");
      await capture(page, layout, record, "folder-route-save");
      await closeSave(page);
      await assertNoHiddenFocus(page, "Escape on folder route");
      await openSave(page);
      await page.goBack();
      await page.waitForFunction(() => location.pathname === "/");
      await waitLibraryReady(page);
      const overlays = await overlayState(page);
      check(overlays.activeLayers === 0, "browser Back unmounts the Save overlay");
      check(overlays.active?.hidden !== true, "browser Back leaves no focus on a hidden save surface");
      await assertNoHiddenFocus(page, "Browser Back");
      await capture(page, layout, record, "after-browser-back");
    },
  },
  {
    id: "viewport-shrink-ime-emulation",
    description: "Shrink the web viewport while Link and then the picker are active; focus and draft survive. This emulates a web IME, not a native keyboard claim.",
    run: async ({ page, layout, record, check }) => {
      await openSave(page);
      await page.keyboard.type("draft.example.test/shrunk");
      await markLink(page);
      await page.setViewportSize(layout.shrunk);
      await waitForFocus(page, { label: "Link", dialog: "Save bookmark", top: true, visible: true });
      const dialogBox = await saveDialog(page).boundingBox();
      check(!!dialogBox && dialogBox.y >= -1 && dialogBox.y + dialogBox.height <= layout.shrunk.height + 1,
        `Save dialog stays within the shrunk ${layout.shrunk.width}x${layout.shrunk.height} viewport`);
      await assertDraft(page, "draft.example.test/shrunk", "Shrunk viewport");
      await assertLinkIdentity(page, "Shrunk viewport");
      await openFolderPicker(page);
      await assertClean(page, "Shrunk folder picker", { menu: true });
      const menuBox = await activeOverlayMenu(page).boundingBox();
      check(!!menuBox && menuBox.y >= -1 && menuBox.y + menuBox.height <= layout.shrunk.height + 1,
        "folder picker stays within the shrunk viewport");
      await assertNoHiddenFocus(page, "Shrunk folder picker");
      await capture(page, layout, record, "ime-shrunk-folder");
      await page.keyboard.press("Escape");
      await activeOverlayMenu(page).waitFor({ state: "hidden" });
      await waitForFocus(page, { dialog: "Save bookmark", top: true });
      await assertDraft(page, "draft.example.test/shrunk", "Shrunk picker dismissed");
      await page.keyboard.press("Escape");
      await saveDialog(page).waitFor({ state: "hidden" });
      await waitForFocus(page, { background: true, notBody: true }, 3000);
      await page.setViewportSize(layout.viewport);
    },
  },
  {
    id: "share-intake",
    description: "Optional parent-provided share-intake route: preview first, Edit link focus, picker handoff, URL draft preserved.",
    optional: true,
    run: async ({ page, layout, record, check }) => {
      if (!shareRoute) {
        record.status = "skipped";
        record.skipReason = "The frozen web export exposes no share-intake route (expo-share-intent is disabled on web). Provide ORDO_FOCUS_SHARE_ROUTE to exercise this case.";
        return;
      }
      await page.goto(`${base}${shareRoute}`, { waitUntil: "domcontentloaded" });
      const dialog = saveDialog(page);
      await dialog.waitFor({ state: "visible" });
      const edit = dialog.getByRole("button", { name: "Edit link", exact: true });
      await edit.waitFor({ state: "visible" });
      const preview = await dialog.evaluate((node) => node.textContent ?? "");
      check(/https?:\/\//.test(preview), "share intake shows the shared URL as a preview");
      check(!(await visibleLink(page).count()), "share intake preview does not autofocus a Link field");
      await edit.click();
      await waitForFocus(page, { label: "Link", dialog: "Save bookmark", top: true });
      await assertDraft(page, "", "share intake edit mode has an editable URL field");
      const value = await linkDraft(page);
      check(!!value, "share intake carries the shared URL into the editable draft");
      await openFolderPicker(page);
      await assertClean(page, "Share intake folder picker", { menu: true });
      await assertNoHiddenFocus(page, "Share intake folder picker");
      await page.keyboard.press("Escape");
      await waitForFocus(page, { dialog: "Save bookmark", top: true });
      await assertDraft(page, value, "Share intake after picker");
      await capture(page, layout, record, "share-intake");
    },
  },
];

const selectedCases = cases.filter((item) => !caseFilter.size || caseFilter.has(item.id));
if (!selectedCases.some((item) => item.id === "share-intake")) {
  results.cases.push({
    id: "share-intake",
    layout: "all",
    status: "skipped",
    description: "Optional parent-provided share-intake route.",
    skipReason: shareRoute ? "Case filtered out." : "The frozen web export exposes no share-intake route (expo-share-intent is disabled on web). Provide ORDO_FOCUS_SHARE_ROUTE to exercise this case.",
  });
}

/* ------------------------------------------------------------------ */
/* Runner                                                               */
/* ------------------------------------------------------------------ */

let browser;
try {
  browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
  for (const layout of LAYOUTS) {
    for (const definition of selectedCases) {
      const record = {
        id: definition.id,
        layout: layout.name,
        description: definition.description,
        status: "running",
        checks: [],
        notes: {},
        captures: [],
        pageErrors: [],
        startedAt: new Date().toISOString(),
      };
      results.cases.push(record);
      const errorStart = results.errors.length;
      let context;
      const check = (ok, label, detail = undefined) => {
        record.checks.push({ label, ok: !!ok, ...(detail === undefined ? {} : { detail }) });
        assert.ok(ok, `${layout.name}/${definition.id}: ${label}`);
      };
      try {
        context = await browser.newContext({
          viewport: layout.viewport,
          colorScheme: "dark",
          hasTouch: layout.hasTouch,
          isMobile: layout.isMobile,
          locale: "en-US",
          reducedMotion: "no-preference",
        });
        const page = await context.newPage();
        page.setDefaultTimeout(20000);
        await installFixtures(page, layout);
        if (cpuThrottle > 0) {
          const session = await context.newCDPSession(page);
          await session.send("Emulation.setCPUThrottlingRate", { rate: cpuThrottle });
        }
        if (definition.id !== "share-intake") await gotoLibrary(page);
        await definition.run({ page, layout, record, check });
        record.pageErrors = results.errors.slice(errorStart);
        check(record.pageErrors.length === 0, `no page errors (${record.pageErrors.map((entry) => entry.message).join("; ") || "none"})`);
        if (record.status === "running") record.status = "passed";
        await page.evaluate(() => window.__focusProbe?.mark("case-end")).catch(() => {});
        record.focus = await page.evaluate(() => window.__focusProbe?.summary() ?? null).catch(() => null);
      } catch (error) {
        record.status = "failed";
        record.failure = {
          message: error?.message ?? String(error),
          stack: error?.stack ?? null,
          check: record.checks.findLast?.((entry) => !entry.ok) ?? null,
        };
        record.pageErrors = results.errors.slice(errorStart);
        try {
          if (context) {
            const pages = context.pages();
            const page = pages[pages.length - 1];
            if (page) {
              const path = `${output}/${layout.name}-${definition.id}-failure.png`;
              await page.screenshot({ path }).catch(() => {});
              const bodyPath = `${output}/${layout.name}-${definition.id}-failure.txt`;
              await writeFile(bodyPath, await page.locator("body").innerText().catch(() => "Page unavailable")).catch(() => {});
              record.failure.screenshot = path;
              record.failure.bodyFile = bodyPath;
              record.focus = await page.evaluate(() => window.__focusProbe?.summary() ?? null).catch(() => null);
            }
          }
        } catch { /* failure evidence is best-effort */ }
        console.error(`[failed] ${layout.name}/${definition.id}: ${record.failure.message}`);
      } finally {
        record.finishedAt = new Date().toISOString();
        if (record.focus) {
          record.hiddenPersistent = (record.focus.hiddenFocus ?? []).filter((entry) => entry.duration >= HIDDEN_FOCUS_MS);
          record.race = record.focus.race ?? null;
        }
        await context?.close().catch(() => {});
      }
    }
  }

  const failed = results.cases.filter((item) => item.status === "failed");
  const skipped = results.cases.filter((item) => item.status === "skipped");
  const passed = results.cases.filter((item) => item.status === "passed");
  const summary = {
    baseUrl: base,
    layouts: results.layouts.map((item) => item.name),
    cases: results.cases.length,
    passed: passed.length,
    failed: failed.length,
    skipped: skipped.length,
    failures: failed.map((item) => ({
      layout: item.layout,
      case: item.id,
      message: item.failure?.message,
      check: item.failure?.check,
      screenshot: item.failure?.screenshot,
      hiddenPersistent: item.hiddenPersistent,
      focusMarks: item.focus?.marks,
    })),
    skippedCases: skipped.map((item) => ({ layout: item.layout, case: item.id, reason: item.skipReason })),
    captures: results.captures.length,
    pageErrors: results.errors.length,
    output,
  };
  results.summary = summary;
  results.finishedAt = new Date().toISOString();
  await writeFile(`${output}/results.json`, JSON.stringify(results, null, 2));
  await writeFile(`${output}/baseline-failures.json`, JSON.stringify({
    generatedAt: results.finishedAt,
    baseUrl: base,
    layouts: results.layouts,
    hiddenFocusThresholdMs: HIDDEN_FOCUS_MS,
    note: "Baseline/final run failures with case-level focus traces. Expect these on frozen b182cb5; parent reruns the same script on the final port.",
    failures: results.cases
      .filter((item) => item.status === "failed")
      .map((item) => ({
        layout: item.layout,
        case: item.id,
        description: item.description,
        failure: item.failure,
        checks: item.checks,
        hiddenPersistent: item.hiddenPersistent,
        focus: item.focus,
        captures: item.captures,
      })),
  }, null, 2));
  console.log(JSON.stringify(summary, null, 2));
  if (failed.length && !reportOnly) process.exitCode = 1;
} finally {
  await browser?.close().catch(() => {});
}
