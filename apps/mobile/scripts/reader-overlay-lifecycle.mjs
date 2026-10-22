#!/usr/bin/env node
/**
 * Fixture-backed reader overlay lifecycle regression harness for the Expo web
 * export. It complements (and never replaces) reader-overlay-performance.mjs,
 * which owns opening timing. This file owns lifecycle/correctness scenarios for
 * generic retained reader overlays, current and future: every overlay query is
 * semantic (ARIA roles, accessible names, computed visibility) — no production
 * `data-*` attributes are consulted, so newly added overlays are covered by the
 * same probes.
 *
 * RUN (no build/server is started here; use an existing export + server):
 *   PLAYWRIGHT_MODULE=/tmp/opencode/node_modules/playwright/index.mjs \
 *   PLAYWRIGHT_CHROMIUM=/path/to/chrome-headless-shell \
 *   ORDO_UI_URL=http://127.0.0.1:8361 \
 *   node apps/mobile/scripts/reader-overlay-lifecycle.mjs
 *
 * Env:
 *   ORDO_UI_OUTPUT=/tmp/opencode/ordo-reader-overlay-lifecycle  results dir
 *   ORDO_UI_CPU=4              Chromium CPU throttle (0 disables)
 *   ORDO_UI_LAYOUTS=both       both | portrait (390x844 touch) | wide (1280x800)
 *   ORDO_UI_CYCLES=20          close/reopen cycles for the bounded-growth case
 *   ORDO_UI_READY_WAIT=700     post-readiness settle wait before first probes
 *
 * Scenarios (all in dark mode; screenshots dark portrait 390x844 and wide
 * 1280x800 of the same states):
 *   1. dormant exposure/leak: retained dialog/menu roles are not exposed to
 *      accessible queries before opening and after closing; no focus leak
 *      (Tab sweep), no hit-test leak (elementFromPoint), activeElement never
 *      inside a dormant surface;
 *   2. bounded growth: `ORDO_UI_CYCLES` settings+overflow close/reopen cycles;
 *      DOM/surface/layer counts stay bounded relative to a snapshot taken
 *      after the first tour (future dormant layers are legitimate, so the
 *      baseline is the first tour, not zero);
 *   3. quick open/Escape/reopen during the exit fade: exactly one exposed
 *      surface, focus inside it, article intact, no errors;
 *   4. preference change then immediately opening overflow (no settle wait):
 *      overflow controls correct, article/progress DOM not blank;
 *   5. route article A -> B after preparation (settings/overflow opened in A):
 *      reader title/actions correspond to B, no stale A contents (checked via
 *      markers and the TOC section range);
 *   6. keyboard: Enter opens the reader and its overlays, Tab stays inside the
 *      open dialog (containment), Escape restores focus to the trigger;
 *   7. initial reader opening and immediate controls open with zero explicit
 *      waits (Playwright auto-waiting only). Contract (A/B verified against
 *      baseline 2b0ed27 and 8363): the background pause is deliberate
 *      (ReaderArticle.tsx ~22-42 cancels the optional renderer load while
 *      activity is false; ArticleHtmlSections ~382+ pauses expansion), so
 *      headings need not arrive while the sheet is open (recorded as INFO).
 *      Asserted instead: painted content never disappears while open; the
 *      early state stays nonblank ("Loading article" placeholder or painted
 *      chrome); all content resumes after close within a strict bound
 *      (ORDO_UI_RECOVERY_CONTENT_MS=5000, ORDO_UI_RECOVERY_FULL_MS=10000 at
 *      4x) with no starvation;
 *   8. theme/design-mode toggle through the existing account UI (Settings ->
 *      Appearance), then reader overlay palette behavior: app chrome follows
 *      the Appearance theme, reader surfaces follow the reader "Theme" control
 *      ("System" reads the device scheme), and dormant/prepared overlays must
 *      track the current palette (asserted for the reader Theme change too).
 *      When a check is not decidable from generic probes it is recorded as
 *      `notes.*Gap` and documented instead of asserted.
 *
 * Cost placement: a global PerformanceObserver("longtask") runs from app init
 * (covering route readiness) and every instrumented opening reports separate
 * pre-click [-500ms,0), during [click,settle) and post [settle,+500ms) windows.
 * These are REPORTED ONLY — there is deliberately no blanket <=50ms assertion.
 *
 * Fixtures are local HTTP mocks (same semantics as reader-overlay-performance
 * and overlay-polish-ui fixtures); no real API is contacted. The harness never
 * edits production files. Web export evidence only: no native frame pacing,
 * native Back/IME, or haptics claims.
 */
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { PNG } from "pngjs";

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? "playwright");
const base = (process.env.ORDO_UI_URL ?? "http://127.0.0.1:8361").replace(/\/+$/, "");
const output = process.env.ORDO_UI_OUTPUT ?? "/tmp/opencode/ordo-reader-overlay-lifecycle";
const cpuThrottle = Number(process.env.ORDO_UI_CPU ?? 4);
const cycles = Math.max(1, Number(process.env.ORDO_UI_CYCLES ?? 20));
const readyWait = Number(process.env.ORDO_UI_READY_WAIT ?? 700);
const sampleWindowMs = 1500;
const stamp = "2026-10-20T12:00:00Z";
const fixtureRows = 1000;

const LAYOUTS = [
  { id: "portrait-390", viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true },
  { id: "wide-1280", viewport: { width: 1280, height: 800 }, hasTouch: false, isMobile: false },
];
const layoutChoice = process.env.ORDO_UI_LAYOUTS ?? "both";
const layouts = layoutChoice === "portrait" ? [LAYOUTS[0]]
  : layoutChoice === "wide" ? [LAYOUTS[1]] : LAYOUTS;

/* ------------------------------------------------------------------ */
/* Fixtures (semantics reused from reader-overlay-performance.mjs)      */
/* ------------------------------------------------------------------ */

const tag = { id: "design", name: "Design", color: "blue", bookmarkCount: fixtureRows, createdAt: stamp, updatedAt: stamp };
const articleSeed = (id, title, sections) => ({
  id,
  folderId: null,
  title,
  url: `https://example.test/${id}`,
  domain: "example.test",
  description: "A saved article for reader overlay lifecycle checks.",
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
  tags: [],
  suggestedTags: [],
  createdAt: stamp,
  updatedAt: stamp,
  sections,
});
const articleA = articleSeed("article-a", "Lifecycle audit article A", 100);
const articleB = articleSeed("article-b", "Lifecycle audit article B", 40);
const markerOf = (id) => (id === articleB.id ? "Article B marker sentence." : "Article A marker sentence.");
const contentFor = (id) => {
  const entry = id === articleB.id ? articleB : articleA;
  return Array.from({ length: entry.sections }, (_, index) => {
    const section = index + 1;
    return `<h2>Section ${section}</h2><p>${markerOf(id)} ${"An article should remain responsive while its overlays open and close. ".repeat(10)}</p>`;
  }).join("");
};
const user = {
  id: "reader-overlay-lifecycle-fixture",
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

const results = {
  kind: "reader-overlay-lifecycle web regression harness",
  nativeClaim: false,
  platform: "Expo web export in headless Chromium",
  baseUrl: base,
  startedAt: new Date().toISOString(),
  environment: {
    cpuThrottle,
    cycles,
    readyWaitMs: readyWait,
    sampleWindowMs,
    layouts: layouts.map((layout) => layout.id),
    fixture: { rows: fixtureRows, articles: [
      { id: articleA.id, title: articleA.title, sections: articleA.sections, marker: markerOf(articleA.id) },
      { id: articleB.id, title: articleB.title, sections: articleB.sections, marker: markerOf(articleB.id) },
    ] },
    longTaskPolicy: "reported only (pre/during/post windows); no blanket 50ms assertion",
  },
  coverage: [
    "dormant overlay roles invisible to accessible queries before opening and after closing",
    "no focus leak (Tab sweep), no hit-test leak, activeElement never inside a dormant surface",
    "bounded DOM/surface/layer growth over settings+overflow close/reopen cycles (vs after-first-tour snapshot)",
    "quick open/Escape/reopen during the exit fade",
    "preference change then immediate overflow open: controls correct, article/progress not blank",
    "article A -> B route after preparation: correct title/actions, no stale contents (markers + TOC range)",
    "keyboard Enter open, dialog Tab containment, Escape focus restoration",
    "initial reader opening + immediate controls open with zero explicit waits",
    "theme/design-mode toggle via account UI; overlay surface palette across themes (dormant read best-effort)",
    "long-task cost placement per opening: pre [-500,0) / during [click,settle) / post [settle,+500)",
    "zero console/page errors",
  ],
  unsupported: [
    "native frame pacing, native gestures, native focus/Back/IME behavior (web export harness)",
    "timing budgets: reader-overlay-performance.mjs owns opening timing claims",
    "long-task thresholds: placement windows are reported, not asserted",
    "implementation-internal attributes of any kind (roles/names/computed style only)",
  ],
  layouts: [],
  longTaskPlacement: [],
  captures: [],
  errors: [],
  // Correctness failures that are recorded with evidence and let the remaining
  // scenarios finish, instead of aborting the run at the first one. The run
  // still ends red: the runner asserts this list empty.
  deferredFailures: [],
};
await mkdir(output, { recursive: true });

/* ------------------------------------------------------------------ */
/* Page init scripts                                                   */
/* ------------------------------------------------------------------ */

function longTaskProbeInit() {
  window.__longTasks = [];
  window.__longTasksSupported = false;
  try {
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        window.__longTasks.push({ start: entry.startTime, duration: entry.duration });
      }
    });
    observer.observe({ type: "longtask" });
    window.__longTasksSupported = true;
  } catch { window.__longTasksSupported = false; }
  window.__readerReadyAt = null;
  window.__markReaderReady = () => { window.__readerReadyAt = performance.now(); };
}

async function installFixtures(page, layout) {
  await page.addInitScript(({ user }) => {
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
  }, { user });
  await page.addInitScript(longTaskProbeInit);

  const bookmarks = [articleA, articleB, ...Array.from({ length: fixtureRows - 2 }, (_, index) => ({
    ...articleSeed(`saved-${index}`, `Saved reading ${index + 1}`, 0),
    createdAt: new Date(Date.parse(stamp) - (index + 1) * 60000).toISOString(),
  }))];
  const state = new Map(bookmarks.map((entry) => [entry.id, { ...entry }]));
  let currentUser = { ...user, preferences: { ...user.preferences } };
  let sequence = 0;

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
      return route.fulfill({ status: 204, headers: {
        "access-control-allow-origin": "*",
        "access-control-allow-headers": "*",
        "access-control-allow-methods": "*",
      } });
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
    if (path === "/api/folders" && method === "GET") return json(route, []);
    if (path === "/api/folders" && method === "POST") {
      sequence += 1;
      return json(route, {
        id: `folder-created-${sequence}`,
        name: String(body.name ?? "").trim().slice(0, 100) || "Untitled",
        icon: String(body.icon ?? "folder-outline"),
        pinned: false,
        protected: false,
        lockType: null,
        pinLength: null,
        bookmarkCount: 0,
        unreadCount: 0,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
    }
    if (path === "/api/tags") return json(route, [tag]);
    if (path === "/api/bookmarks/extraction-progress") return json(route, { pending: 0, total: fixtureRows });
    if (path === "/api/bookmarks/reminders") return json(route, []);
    if (path === "/api/bookmarks/prefetch") return json(route, { success: true });
    if (path === "/api/bookmarks/mark-all-read") return json(route, { updated: state.size });
    if (path === "/api/bookmarks/batch") return json(route, { updated: (body.ids ?? []).length });
    if (path === "/api/bookmarks/search") {
      const query = (url.searchParams.get("q") ?? "").trim().toLocaleLowerCase();
      const items = [...state.values()].filter((entry) => !query || entry.title.toLocaleLowerCase().includes(query));
      return json(route, { items, nextCursor: null, hasMore: false });
    }
    if (path === "/api/bookmarks" && method === "GET") {
      return json(route, { items: [...state.values()], nextCursor: null, hasMore: false });
    }
    if (path === "/api/bookmarks" && method === "POST") {
      sequence += 1;
      const raw = String(body.url ?? "").trim();
      const normalized = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
      let hostname = "example.test";
      try { hostname = new URL(normalized).hostname; } catch { /* fixture fallback */ }
      const created = {
        ...articleSeed(`created-${sequence}`, hostname, 0),
        url: normalized,
        domain: hostname,
        fetchStatus: "pending",
        contentKind: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      state.set(created.id, created);
      return json(route, created);
    }
    if (/^\/api\/bookmarks\/[^/]+$/.test(path)) {
      const id = decodeURIComponent(path.split("/")[3]);
      const entry = state.get(id);
      if (!entry) return json(route, { success: true });
      if (method === "PATCH") {
        Object.assign(entry, body, { id, updatedAt: new Date().toISOString() });
      }
      return json(route, {
        ...entry,
        contentHtml: contentFor(id),
        highlights: [],
      });
    }
    return json(route, { success: true });
  });
  page.on("pageerror", (error) => {
    results.errors.push({ kind: "pageerror", layout: layout.id, message: error.message });
  });
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    results.errors.push({ kind: "console", layout: layout.id, message: message.text(), location: message.location() });
  });
}

/* ------------------------------------------------------------------ */
/* Generic overlay probes (roles/names/computed style only)             */
/* ------------------------------------------------------------------ */

const button = (page, name) => page.getByRole("button", { name, exact: true });
const rowA = (page) => page.getByRole("button", { name: /^Lifecycle audit article A,/ }).first();
const rowB = (page) => page.getByRole("button", { name: /^Lifecycle audit article B,/ }).first();

// Playwright role queries only match elements exposed in the accessibility
// tree (same behavior reader-overlay-performance.mjs asserts), so a zero count
// means dormant surfaces are not exposed.
const exposedCount = (page, role) => page.getByRole(role).count();

async function surfaceState(page) {
  return page.evaluate(() => {
    const visible = (node) => {
      const style = getComputedStyle(node);
      const rect = node.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
    };
    return [...document.querySelectorAll('[role="dialog"], [role="menu"]')].map((node) => {
      const style = getComputedStyle(node);
      return {
        role: node.getAttribute("role"),
        label: node.getAttribute("aria-label") ?? null,
        ariaHidden: node.getAttribute("aria-hidden"),
        inert: !!node.closest("[inert]"),
        visible: visible(node),
        opacity: Number(style.opacity),
        text: (node.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 60),
      };
    });
  });
}

async function leakProbe(page, label) {
  const state = await page.evaluate(() => {
    const surfaces = [...document.querySelectorAll('[role="dialog"], [role="menu"]')];
    const visible = (node) => {
      const style = getComputedStyle(node);
      const rect = node.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
    };
    const dormant = (node) => !visible(node);
    const describe = (node) => {
      if (!node) return null;
      return {
        tag: node.tagName,
        role: node.getAttribute?.("role"),
        label: node.getAttribute?.("aria-label") ?? null,
        text: (node.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 40),
      };
    };
    const active = document.activeElement;
    const hits = [[innerWidth / 2, innerHeight / 2], [8, 8], [innerWidth - 8, innerHeight - 8]]
      .map(([x, y]) => document.elementFromPoint(x, y))
      .map((node) => {
        const surface = node?.closest?.('[role="dialog"], [role="menu"]');
        return surface && dormant(surface) ? describe(surface) : null;
      })
      .filter(Boolean);
    return {
      exposedRaw: surfaces.filter((node) => visible(node) && node.getAttribute("aria-hidden") !== "true").length,
      dormant: surfaces.filter(dormant).map(describe),
      focusInDormant: active && active !== document.body
        ? (() => {
            const surface = active.closest?.('[role="dialog"], [role="menu"]');
            return surface && dormant(surface) ? { active: describe(active), surface: describe(surface) } : null;
          })()
        : null,
      hitTestInDormant: hits,
    };
  });
  assert.equal(state.focusInDormant, null, `${label}: focus must never sit inside a dormant overlay (${JSON.stringify(state)})`);
  assert.deepEqual(state.hitTestInDormant, [], `${label}: dormant overlays must not hit-test (${JSON.stringify(state)})`);
  assert.equal(state.exposedRaw, 0, `${label}: no overlay may be exposed while closed (${JSON.stringify(state)})`);
  return state;
}

async function tabSweep(page, label, presses = 8) {
  const leaks = [];
  for (let index = 0; index < presses; index += 1) {
    await page.keyboard.press("Tab");
    const state = await page.evaluate(() => {
      const active = document.activeElement;
      if (!active || active === document.body) return null;
      const surface = active.closest?.('[role="dialog"], [role="menu"]');
      if (!surface) return null;
      const style = getComputedStyle(surface);
      const rect = surface.getBoundingClientRect();
      const visible = rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
      return visible ? null : {
        activeLabel: active.getAttribute?.("aria-label") ?? active.tagName,
        surfaceRole: surface.getAttribute("role"),
        surfaceText: (surface.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 40),
      };
    });
    if (state) leaks.push(state);
  }
  assert.deepEqual(leaks, [], `${label}: Tab must never focus a dormant overlay (${JSON.stringify(leaks)})`);
}

async function waitForSurfaceExposed(page, { role, text, name }, label) {
  try {
    await page.waitForFunction(({ role, text, name }) => {
      const visible = (node) => {
        const style = getComputedStyle(node);
        const rect = node.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden"
          && Number(style.opacity) > 0.05;
      };
      return [...document.querySelectorAll(`[role="${role}"]`)].some((node) => {
        if (node.getAttribute("aria-hidden") === "true") return false;
        if (!visible(node)) return false;
        if (name && (node.getAttribute("aria-label") ?? "") !== name) return false;
        if (text && !(node.textContent ?? "").includes(text)) return false;
        return true;
      });
    }, { role, text, name }, { timeout: 15000 });
  } catch (error) {
    const state = await surfaceState(page).catch(() => null);
    throw new Error(`${label}: expected an exposed ${role}; observed ${JSON.stringify(state)}; ${error.message}`);
  }
}

async function waitForSurfaceExit(page, label, timeout = 12000) {
  try {
    await page.waitForFunction(() => {
      const visible = (node) => {
        const style = getComputedStyle(node);
        const rect = node.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
      };
      return [...document.querySelectorAll('[role="dialog"], [role="menu"]')].every((node) => !visible(node));
    }, null, { timeout });
  } catch (error) {
    const state = await surfaceState(page).catch(() => null);
    throw new Error(`${label}: overlay did not fully exit (${JSON.stringify(state)}); ${error.message}`);
  }
}

async function waitForSurfaceSettled(page, role, label, timeout = 8000) {
  try {
    await page.waitForFunction((role) => {
      const opacityOf = (node) => {
        let opacity = 1;
        for (let parent = node; parent; parent = parent.parentElement) {
          const style = getComputedStyle(parent);
          if (style.display === "none" || style.visibility === "hidden") return 0;
          opacity *= Number(style.opacity);
        }
        return opacity;
      };
      return [...document.querySelectorAll(`[role="${role}"]`)].some((node) => {
        if (node.getAttribute("aria-hidden") === "true") return false;
        const rect = node.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0 && opacityOf(node) >= 0.99;
      });
    }, role, { timeout });
  } catch (error) {
    const state = await surfaceState(page).catch(() => null);
    throw new Error(`${label}: expected the ${role} entrance to settle; observed ${JSON.stringify(state)}; ${error.message}`);
  }
}

async function waitForFocusInSurface(page, role, label) {
  try {
    await page.waitForFunction((role) => {
      const active = document.activeElement;
      if (!active || active === document.body) return false;
      const surface = active.closest?.('[role="dialog"], [role="menu"]');
      return !!surface && surface.getAttribute("role") === role && surface.getAttribute("aria-hidden") !== "true";
    }, role, { timeout: 8000 });
  } catch (error) {
    const active = await page.evaluate(() => {
      const node = document.activeElement;
      return node ? {
        tag: node.tagName,
        label: node.getAttribute?.("aria-label") ?? null,
        role: node.getAttribute?.("role") ?? null,
      } : null;
    }).catch(() => null);
    throw new Error(`${label}: expected focus inside the open ${role}; observed ${JSON.stringify(active)}; ${error.message}`);
  }
}

async function assertArticleIntact(page, label, { marker, title, sections }) {
  const state = await page.evaluate(({ marker, title }) => {
    const painted = (node) => {
      // What the user can actually see: geometry on screen plus the full
      // opacity/visibility chain. Modal isolation marks the background
      // aria-hidden while an overlay is open; that is correct behavior and
      // must not be confused with unpainted/unmounted content.
      if (!node || !node.isConnected) return false;
      const rect = node.getBoundingClientRect();
      if (!rect.width || !rect.height) return false;
      if (rect.bottom < 0 || rect.top > innerHeight || rect.right < 0 || rect.left > innerWidth) return false;
      let opacity = 1;
      for (let parent = node; parent; parent = parent.parentElement) {
        const style = getComputedStyle(parent);
        if (style.display === "none" || style.visibility === "hidden") return false;
        opacity *= Number(style.opacity);
        if (opacity <= 0.05) return false;
      }
      return true;
    };
    const titleLeaves = (text) => {
      const matches = [];
      for (const node of document.querySelectorAll("div,span,h1,h2,h3,p")) {
        if (node.textContent.trim() !== text) continue;
        if (node.querySelector("div,span,h1,h2,h3,p")) continue;
        matches.push(node);
      }
      return matches;
    };
    // Markers are sentences inside a paragraph: match by containment on the
    // smallest element that carries them.
    const markerNodes = (text) => [...document.querySelectorAll("div,span,h1,h2,h3,p")]
      .filter((node) => (node.textContent ?? "").includes(text)
        && ![...node.children].some((child) => (child.textContent ?? "").includes(text)));
    const headings = [...document.querySelectorAll("h1,h2,h3,div,span")].filter((node) =>
      /^Section \d+$/.test(node.textContent.trim())
      && ![...node.children].some((child) => /^Section \d+$/.test(child.textContent.trim())));
    return {
      titleRendered: titleLeaves(title).some(painted),
      markerRendered: markerNodes(marker).some(painted),
      headings: headings.length,
      renderedHeadings: headings.filter(painted).length,
      bodyText: document.body.innerText.length,
      progressBars: document.querySelectorAll('[role="progressbar"]').length,
      visibleProgressBars: [...document.querySelectorAll('[role="progressbar"]')].filter(painted).length,
    };
  }, { marker, title });
  assert.equal(state.titleRendered, true, `${label}: article title is rendered (${JSON.stringify(state)})`);
  assert.equal(state.markerRendered, true, `${label}: article body marker is rendered (${JSON.stringify(state)})`);
  assert.ok(state.headings >= Math.min(20, sections), `${label}: article headings are mounted (${state.headings})`);
  assert.ok(state.bodyText > 500, `${label}: article text is present (${state.bodyText} chars)`);
  return state;
}

/* ------------------------------------------------------------------ */
/* Opening sampler + long-task cost placement (report-only)             */
/* ------------------------------------------------------------------ */

async function longTaskWindow(page, fromMs, toMs) {
  return page.evaluate(({ fromMs, toMs }) => {
    const tasks = (window.__longTasks ?? [])
      .filter((task) => task.start >= fromMs && task.start < toMs)
      .map((task) => ({ startMs: Math.round(task.start - fromMs), durationMs: Math.round(task.duration) }));
    return {
      supported: !!window.__longTasksSupported,
      count: tasks.length,
      totalMs: Math.round(tasks.reduce((total, task) => total + task.durationMs, 0)),
      maxMs: tasks.reduce((max, task) => Math.max(max, task.durationMs), 0),
      tasks: tasks.slice(0, 12),
    };
  }, { fromMs, toMs });
}

async function readinessPlacement(page, label) {
  const mark = await page.evaluate(() => window.__readerReadyAt);
  if (mark == null) return null;
  const entry = {
    label,
    windows: {
      readiness: await longTaskWindow(page, 0, mark),
      post: await longTaskWindow(page, mark, mark + 500),
    },
  };
  results.longTaskPlacement.push(entry);
  return entry;
}

async function measureOpening(page, layout, label, trigger, wanted, options = {}) {
  await trigger.evaluate((node, { wanted, sampleWindowMs }) => {
    window.__openSample = null;
    const frames = [];
    let start = 0;
    let last = 0;
    let started = false;
    let settleCount = 0;
    let lastRect = null;
    let lastTransforms = null;
    const findTarget = () => {
      for (const candidate of document.querySelectorAll(wanted.selector)) {
        if (candidate.closest('[aria-hidden="true"], [inert]')) continue;
        const ownStyle = getComputedStyle(candidate);
        if (ownStyle.display === "none" || ownStyle.visibility === "hidden") continue;
        const aria = candidate.getAttribute("aria-label") ?? "";
        if (wanted.label != null && aria !== wanted.label) continue;
        if (wanted.labelPrefix && !aria.startsWith(wanted.labelPrefix)) continue;
        if (wanted.text && !(candidate.textContent ?? "").includes(wanted.text)) continue;
        if (wanted.surface) {
          const surface = candidate.closest('[role="dialog"], [role="menu"]');
          if (!surface || surface.getAttribute("role") !== wanted.surface) continue;
        }
        const rect = candidate.getBoundingClientRect();
        if (!rect.width || !rect.height) continue;
        return candidate;
      }
      return null;
    };
    const sample = (destination) => {
      // The role may sit on an unanimated wrapper: sample the matched label's
      // full ancestor chain so wrapper opacity cannot game the reading.
      let labelNode = destination;
      const walker = document.createTreeWalker(destination, NodeFilter.SHOW_TEXT);
      let textNode;
      while ((textNode = walker.nextNode())) {
        if (wanted.text && textNode.textContent.includes(wanted.text)) {
          labelNode = textNode.parentElement ?? destination;
          break;
        }
      }
      const rect = labelNode.getBoundingClientRect();
      const transforms = [];
      let opacity = 1;
      for (let parent = labelNode; parent; parent = parent.parentElement) {
        const style = getComputedStyle(parent);
        if (style.display === "none" || style.visibility === "hidden") opacity = 0;
        opacity *= Number(style.opacity);
        if (style.transform !== "none") transforms.push(style.transform);
        if (opacity <= 0.0001) break;
      }
      if (!rect.width || !rect.height) opacity = 0;
      const panel = destination.closest('[role="dialog"], [role="menu"]') ?? destination;
      return {
        opacity,
        geometry: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
        transforms,
        controlCount: panel.querySelectorAll('button, input, [role="button"], [role="radio"], [role="menuitem"], [role="switch"], [role="checkbox"]').length,
      };
    };
    const frame = () => {
      const now = performance.now();
      const gapMs = now - last;
      last = now;
      const destination = findTarget();
      const reading = destination ? sample(destination) : { opacity: 0, geometry: null, transforms: [], controlCount: 0 };
      const stable = lastRect && reading.geometry
        && Object.keys(reading.geometry).every((key) => Math.abs(reading.geometry[key] - lastRect[key]) < 0.25)
        && JSON.stringify(reading.transforms) === JSON.stringify(lastTransforms);
      settleCount = reading.opacity >= 0.995 && stable ? settleCount + 1 : 0;
      lastRect = reading.geometry;
      lastTransforms = reading.transforms;
      frames.push({ timeMs: now - start, gapMs, ...reading });
      if (settleCount >= 3) {
        window.__openSample = { clickAt: start, frames, settled: true };
      } else if (now - start >= sampleWindowMs) {
        window.__openSample = { clickAt: start, frames, settled: false };
      } else {
        requestAnimationFrame(frame);
      }
    };
    const begin = () => {
      // Keyboard activation may never produce a DOM click (pressables handle
      // Enter/Space themselves), so start the clock on either path exactly once.
      if (started) return;
      started = true;
      start = performance.now();
      last = start;
      requestAnimationFrame(frame);
    };
    node.addEventListener("click", begin, { capture: true });
    node.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") begin();
    }, { capture: true });
  }, { wanted, sampleWindowMs });

  if (options.viaKeyboard) {
    await trigger.evaluate((node) => node.focus());
    await page.keyboard.press("Enter");
  } else if (layout.hasTouch) await trigger.tap();
  else await trigger.click();
  await page.waitForFunction(() => window.__openSample !== null, null, { timeout: sampleWindowMs + 8000 });
  const sample = await page.evaluate(() => window.__openSample);

  const firstAt = (threshold) => sample.frames.find((frame) => frame.opacity >= threshold)?.timeMs ?? null;
  const firstVisibleMs = firstAt(0.05);
  const halfOpaqueMs = firstAt(0.5);
  assert.notEqual(firstVisibleMs, null, `${label}: overlay must visibly open`);
  const settledIndex = sample.frames.findIndex((frame, index, frames) =>
    frame.opacity >= 0.995 && index >= 2
    && frames[index - 1].opacity >= 0.995 && frames[index - 2].opacity >= 0.995);
  assert.ok(sample.settled && settledIndex >= 2, `${label}: overlay must finish its entrance`);
  const settledMs = sample.frames[settledIndex].timeMs;

  const visibleFrames = sample.frames.filter((frame) => frame.opacity > 0);
  const firstVisibleFrame = sample.frames.find((frame) => frame.opacity >= 0.05);
  const lastVisibleFrame = visibleFrames.at(-1);
  assert.ok(firstVisibleFrame.controlCount > 0, `${label}: first visible frame must contain controls`);
  assert.equal(firstVisibleFrame.controlCount, lastVisibleFrame.controlCount,
    `${label}: first visible content must include the controls, not an empty shell`);
  for (let i = 1; i < visibleFrames.length; i += 1) {
    assert.ok(visibleFrames[i].opacity >= visibleFrames[i - 1].opacity - 0.02,
      `${label}: entrance opacity must not flash backwards`);
  }
  const entranceFrames = sample.frames.filter((frame) => frame.timeMs <= settledMs);

  const mark = sample.clickAt;
  const windows = {
    pre: await longTaskWindow(page, mark - 500, mark),
    during: await longTaskWindow(page, mark, mark + settledMs),
    post: await longTaskWindow(page, mark + settledMs, mark + settledMs + 500),
  };
  const record = {
    label,
    firstVisibleMs: Math.round(firstVisibleMs),
    halfOpaqueMs: halfOpaqueMs == null ? null : Math.round(halfOpaqueMs),
    opaqueMs: firstAt(0.995) == null ? null : Math.round(firstAt(0.995)),
    settledMs: Math.round(settledMs),
    maxEntranceFrameMs: Math.round(Math.max(...entranceFrames.map((frame) => frame.gapMs))),
    controlsOnFirstFrame: firstVisibleFrame.controlCount,
    longTasks: windows,
  };
  results.longTaskPlacement.push({ label, ...windows });
  return record;
}

async function articleMountState(page) {
  return page.evaluate(() => {
    const headings = [...document.querySelectorAll("h1,h2,h3,div,span")].filter((node) =>
      /^Section \d+$/.test(node.textContent.trim())
      && ![...node.children].some((child) => /^Section \d+$/.test(child.textContent.trim())));
    return {
      headings: headings.length,
      articleChars: document.body.innerText.length,
    };
  });
}

async function armClickMark(page, trigger) {
  await trigger.evaluate((node) => {
    window.__clickMark = null;
    node.addEventListener("click", () => { window.__clickMark = performance.now(); }, { once: true, capture: true });
  });
}

async function readClickMark(page) {
  return page.evaluate(() => window.__clickMark);
}

/* ------------------------------------------------------------------ */
/* Screenshots                                                         */
/* ------------------------------------------------------------------ */

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
    uniqueColors,
    meanLuminance: Number(meanLuminance.toFixed(1)),
    ok: differing >= 0.01 && uniqueColors >= 16 && !(meanLuminance < 2 && uniqueColors < 8),
  };
}

async function capture(page, layout, name, { settleMs = 450 } = {}) {
  await page.evaluate(() => document.fonts?.ready).catch(() => {});
  if (settleMs > 0) await page.waitForTimeout(settleMs);
  const path = `${output}/${layout.id}-${name}.png`;
  const buffer = await page.screenshot({ path });
  const health = analyzePng(buffer);
  results.captures.push({ layout: layout.id, name, path, health });
  assert.ok(health.ok, `${layout.id} ${name}: screenshot must not be blank/black (${JSON.stringify(health)})`);
  return health;
}

/* ------------------------------------------------------------------ */
/* Reader navigation helpers                                           */
/* ------------------------------------------------------------------ */

async function waitReaderReady(page, { marker, title, sections }) {
  // Raw semantic locator on purpose: while an overlay is open the reader
  // chrome is correctly aria-hidden/inert (modal isolation), but it must stay
  // mounted and visible. Accessible exposure is asserted separately.
  await page.locator('[aria-label="Reader settings"]').first().waitFor({ state: "visible", timeout: 30000 });
  await page.getByText(`Section ${sections}`, { exact: true }).waitFor({ state: "attached", timeout: 30000 });
  await page.getByText(marker, { exact: false }).first().waitFor({ state: "attached", timeout: 30000 });
  await page.evaluate(() => window.__markReaderReady?.());
  if (readyWait > 0) await page.waitForTimeout(readyWait);
  await assertArticleIntact(page, `${title} ready`, { marker, title, sections });
}

async function backToLibrary(page) {
  await button(page, "Back").click();
  await rowA(page).waitFor({ state: "visible", timeout: 20000 });
}

async function openOverflow(page, layout, label) {
  const sample = await measureOpening(page, layout, label, button(page, "More article actions"), {
    selector: '[role="menu"]', surface: "menu", text: "Open original",
  });
  await waitForSurfaceExposed(page, { role: "menu", text: "Open original" }, label);
  await waitForFocusInSurface(page, "menu", label);
  return sample;
}

async function openSettings(page, layout, label) {
  const sample = await measureOpening(page, layout, label, button(page, "Reader settings"), {
    selector: '[role="dialog"]', surface: "dialog", text: "Text size",
  });
  await waitForSurfaceExposed(page, { role: "dialog", text: "Text size" }, label);
  await waitForFocusInSurface(page, "dialog", label);
  return sample;
}

async function overflowActionLabels(page) {
  return page.evaluate(() => [...document.querySelectorAll('[role="menuitem"]')]
    .filter((node) => node.getAttribute("aria-hidden") !== "true")
    .map((node) => node.getAttribute("aria-label") ?? (node.textContent ?? "").trim())
    .filter(Boolean));
}

async function assertOverflowActions(page, label) {
  const items = await overflowActionLabels(page);
  for (const expected of ["Table of contents", "Highlights", "Open original"]) {
    assert.ok(items.some((item) => item.includes(expected)), `${label}: overflow exposes "${expected}" (${JSON.stringify(items)})`);
  }
  return items;
}

async function paletteProbe(page, label) {
  // Generic palette read: the exposed dialog/menu surface and the scrim corner.
  return page.evaluate((label) => {
    const visible = (node) => {
      const style = getComputedStyle(node);
      const rect = node.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
    };
    const panelColor = (root) => {
      if (!root) return null;
      const candidates = [root, ...root.querySelectorAll("*")];
      for (const node of candidates) {
        const rect = node.getBoundingClientRect();
        if (rect.width * rect.height < 2000) continue;
        const color = getComputedStyle(node).backgroundColor;
        if (color && color !== "rgba(0, 0, 0, 0)" && color !== "transparent") {
          return { color, tag: node.tagName, role: node.getAttribute("role") ?? null };
        }
      }
      return null;
    };
    const surface = [...document.querySelectorAll('[role="dialog"], [role="menu"]')].find(visible) ?? null;
    const scrimNode = document.elementFromPoint(6, 6);
    return {
      label,
      surfaceRole: surface?.getAttribute("role") ?? null,
      surfacePanel: panelColor(surface),
      scrimCorner: scrimNode ? {
        tag: scrimNode.tagName,
        label: scrimNode.getAttribute?.("aria-label") ?? null,
        color: getComputedStyle(scrimNode).backgroundColor,
      } : null,
    };
  }, label);
}

async function dormantPaletteProbe(page, label) {
  return page.evaluate((label) => {
    const visible = (node) => {
      const style = getComputedStyle(node);
      const rect = node.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
    };
    const panelColor = (root) => {
      if (!root) return null;
      const candidates = [root, ...root.querySelectorAll("*")];
      for (const node of candidates) {
        const rect = node.getBoundingClientRect();
        if (rect.width * rect.height < 2000) continue;
        const color = getComputedStyle(node).backgroundColor;
        if (color && color !== "rgba(0, 0, 0, 0)" && color !== "transparent") return color;
      }
      return null;
    };
    return {
      label,
      dormant: [...document.querySelectorAll('[role="dialog"], [role="menu"]')]
        .filter((node) => !visible(node))
        .map((node) => ({ role: node.getAttribute("role"), color: panelColor(node) })),
    };
  }, label);
}

/* ------------------------------------------------------------------ */
/* Scenarios                                                           */
/* ------------------------------------------------------------------ */

async function scenarioDormantExposure(page, layout, mode) {
  await leakProbe(page, `${layout.id} dormant probe after the initial tour`);
  await tabSweep(page, `${layout.id} tab sweep after the initial tour`);

  await openOverflow(page, layout, `${layout.id} overflow open (dormant case)`);
  await assertOverflowActions(page, `${layout.id} overflow actions`);
  await capture(page, layout, "overflow-open");
  await page.keyboard.press("Escape");
  await waitForSurfaceExit(page, `${layout.id} overflow close (dormant case)`);
  await leakProbe(page, `${layout.id} dormant probe after overflow close`);
  await tabSweep(page, `${layout.id} tab sweep after overflow close`);
  const dormant = await surfaceState(page);
  note(mode, "dormantSurfacesAfterClose", dormant);
  check(mode, (await exposedCount(page, "dialog")) === 0 && (await exposedCount(page, "menu")) === 0,
    "closed overlay roles are not exposed to accessible queries");
}

async function scenarioQuickReopen(page, layout, mode) {
  for (const kind of ["settings", "overflow"]) {
    const open = kind === "settings"
      ? () => openSettings(page, layout, `${layout.id} quick reopen ${kind}`)
      : () => openOverflow(page, layout, `${layout.id} quick reopen ${kind}`);
    const trigger = button(page, kind === "settings" ? "Reader settings" : "More article actions");
    await open();
    await page.keyboard.press("Escape");
    // Reopen immediately, while the previous surface is still exiting.
    await trigger.click();
    await waitForSurfaceExposed(page, { role: kind === "settings" ? "dialog" : "menu" },
      `${layout.id} quick reopen ${kind} exposed`);
    await waitForSurfaceSettled(page, kind === "settings" ? "dialog" : "menu",
      `${layout.id} quick reopen ${kind} settle`);
    await waitForFocusInSurface(page, kind === "settings" ? "dialog" : "menu",
      `${layout.id} quick reopen ${kind} focus`);
    const exposed = {
      dialogs: await exposedCount(page, "dialog"),
      menus: await exposedCount(page, "menu"),
    };
    check(mode, exposed.dialogs + exposed.menus === 1,
      `quick ${kind} reopen exposes exactly one surface (${JSON.stringify(exposed)})`);
    await assertArticleIntact(page, `${layout.id} quick reopen ${kind}`, {
      marker: markerOf(articleA.id), title: articleA.title, sections: articleA.sections,
    });
    await page.keyboard.press("Escape");
    await waitForSurfaceExit(page, `${layout.id} quick ${kind} close`);
    await leakProbe(page, `${layout.id} quick ${kind} close probe`);
  }
  check(mode, true, "quick open/Escape/reopen completes without losing the article or leaking focus");
}

async function scenarioPreferenceThenOverflow(page, layout, mode) {
  await openSettings(page, layout, `${layout.id} settings before preference change`);
  const large = page.getByRole("radio", { name: "Large", exact: true });
  if (await large.count()) {
    await large.click();
    check(mode, true, "preference change (text size Large) applied");
  } else {
    note(mode, "preferenceChangeGap", "no role=radio 'Large' control found; preference step skipped");
  }
  await page.keyboard.press("Escape");
  // Immediately open overflow: no settle wait between the preference write and
  // the next overlay opening.
  const sample = await openOverflow(page, layout, `${layout.id} overflow right after preference change`);
  note(mode, "preferenceThenOverflowSample", sample);
  const items = await assertOverflowActions(page, `${layout.id} overflow after preference change`);
  note(mode, "overflowActionsAfterPreferenceChange", items);
  const article = await assertArticleIntact(page, `${layout.id} article after preference change`, {
    marker: markerOf(articleA.id), title: articleA.title, sections: articleA.sections,
  });
  note(mode, "articleAfterPreferenceChange", article);
  check(mode, article.bodyText > 500 && article.headings >= 20,
    "article/progress DOM is not blank while overflow opens after a preference change");
  await capture(page, layout, "overflow-after-preference");
  await page.keyboard.press("Escape");
  await waitForSurfaceExit(page, `${layout.id} overflow after preference close`);
}

async function scenarioRouteArticleB(page, layout, mode) {
  // Preparation in article A: create retained/dormant overlay layers first.
  await openSettings(page, layout, `${layout.id} prepare settings in A`);
  await page.keyboard.press("Escape");
  await waitForSurfaceExit(page, `${layout.id} prepare settings close`);
  await openOverflow(page, layout, `${layout.id} prepare overflow in A`);
  await page.keyboard.press("Escape");
  await waitForSurfaceExit(page, `${layout.id} prepare overflow close`);

  await backToLibrary(page);
  await rowB(page).click();
  await waitReaderReady(page, {
    marker: markerOf(articleB.id), title: articleB.title, sections: articleB.sections,
  });

  const staleCheck = await page.evaluate(({ aMarker, bMarker, aTitle, bTitle }) => {
    const painted = (node) => {
      if (!node || !node.isConnected) return false;
      const rect = node.getBoundingClientRect();
      if (!rect.width || !rect.height) return false;
      if (rect.bottom < 0 || rect.top > innerHeight || rect.right < 0 || rect.left > innerWidth) return false;
      let opacity = 1;
      for (let parent = node; parent; parent = parent.parentElement) {
        const style = getComputedStyle(parent);
        if (style.display === "none" || style.visibility === "hidden") return false;
        opacity *= Number(style.opacity);
        if (opacity <= 0.05) return false;
      }
      return true;
    };
    const leaves = (text) => {
      const matches = [];
      for (const node of document.querySelectorAll("div,span,h1,h2,h3,p")) {
        if (node.textContent.trim() !== text) continue;
        if (node.querySelector("div,span,h1,h2,h3,p")) continue;
        matches.push(node);
      }
      return matches;
    };
    const markerNodes = (text) => [...document.querySelectorAll("div,span,h1,h2,h3,p")]
      .filter((node) => (node.textContent ?? "").includes(text)
        && ![...node.children].some((child) => (child.textContent ?? "").includes(text)));
    return {
      titleB: leaves(bTitle).some(painted),
      titleAVisible: leaves(aTitle).some(painted),
      markerB: markerNodes(bMarker).some(painted),
      markerAVisible: markerNodes(aMarker).some(painted),
    };
  }, { aMarker: markerOf(articleA.id), bMarker: markerOf(articleB.id), aTitle: articleA.title, bTitle: articleB.title });
  check(mode, staleCheck.titleB && staleCheck.markerB,
    `reader shows article B after routing (${JSON.stringify(staleCheck)})`);
  check(mode, !staleCheck.titleAVisible && !staleCheck.markerAVisible,
    `no stale article A contents after routing (${JSON.stringify(staleCheck)})`);
  note(mode, "routeStaleCheck", staleCheck);

  await openOverflow(page, layout, `${layout.id} overflow in B`);
  const items = await assertOverflowActions(page, `${layout.id} overflow actions in B`);
  note(mode, "overflowActionsInB", items);
  await capture(page, layout, "article-b-overflow");

  // TOC reflects B's section range: B has 40 sections, A had 100. The TOC list
  // virtualizes (only a window is mounted), so walk it top -> tail and judge
  // "exactly article B's sections" on every entry the list ever renders.
  await page.getByRole("menuitem", { name: "Table of contents", exact: true }).click();
  await waitForSurfaceExposed(page, { role: "dialog" }, `${layout.id} TOC in B`);
  await page.waitForFunction(() => [...document.querySelectorAll('[role="button"]')].some((node) => {
    const surface = node.closest('[role="dialog"]');
    return surface && surface.getAttribute("aria-hidden") !== "true"
      && /^Go to Section/.test(node.getAttribute("aria-label") ?? "");
  }), null, { timeout: 15000 });
  const toc = await page.evaluate(async () => {
    const dialog = [...document.querySelectorAll('[role="dialog"]')]
      .find((node) => node.getAttribute("aria-hidden") !== "true");
    const scrollers = dialog
      ? [dialog, ...dialog.querySelectorAll("*")].filter((node) => /auto|scroll/.test(getComputedStyle(node).overflowY))
      : [];
    const seen = new Set();
    const collect = () => {
      for (const node of dialog ? dialog.querySelectorAll('[role="button"]') : []) {
        const match = /^Go to Section (\d+)$/.exec(node.getAttribute("aria-label") ?? "");
        if (match) seen.add(Number(match[1]));
      }
    };
    for (const scroller of scrollers) scroller.scrollTop = 0;
    await new Promise((resolve) => setTimeout(resolve, 120));
    for (let round = 0; round < 80; round += 1) {
      collect();
      let moved = false;
      for (const scroller of scrollers) {
        const next = Math.min(scroller.scrollHeight, scroller.scrollTop + Math.max(40, scroller.clientHeight * 0.7));
        if (next > scroller.scrollTop + 1) {
          scroller.scrollTop = next;
          scroller.dispatchEvent(new Event("scroll", { bubbles: true }));
          moved = true;
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 60));
      if (!moved) break;
    }
    for (const scroller of scrollers) {
      scroller.scrollTop = scroller.scrollHeight;
      scroller.dispatchEvent(new Event("scroll", { bubbles: true }));
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
    collect();
    const numbers = [...seen].sort((a, b) => a - b);
    return {
      total: numbers.length,
      min: numbers[0] ?? null,
      max: numbers[numbers.length - 1] ?? null,
      missingInB: Array.from({ length: 40 }, (_, index) => index + 1).filter((number) => !seen.has(number)),
      beyondB: numbers.filter((number) => number > 40),
    };
  });
  check(mode, toc.min === 1 && toc.max === 40 && toc.beyondB.length === 0,
    `TOC lists exactly article B's sections (40), not article A's (${JSON.stringify(toc)})`);
  note(mode, "tocInB", toc);
  await page.keyboard.press("Escape");
  await waitForSurfaceExit(page, `${layout.id} TOC in B close`);
  await page.keyboard.press("Escape");
  await waitForSurfaceExit(page, `${layout.id} overflow in B close`);
  await leakProbe(page, `${layout.id} after route A->B`);
}

async function scenarioKeyboard(page, layout, mode) {
  await backToLibrary(page);
  // Keyboard-open the reader itself first.
  await rowA(page).evaluate((node) => node.focus());
  await page.keyboard.press("Enter");
  await waitReaderReady(page, {
    marker: markerOf(articleA.id), title: articleA.title, sections: articleA.sections,
  });

  const settingsTrigger = button(page, "Reader settings");
  const sample = await measureOpening(page, layout, `${layout.id} keyboard settings open`, settingsTrigger, {
    selector: '[role="dialog"]', surface: "dialog", text: "Text size",
  }, { viaKeyboard: true });
  note(mode, "keyboardSettingsSample", sample);
  await waitForSurfaceExposed(page, { role: "dialog", text: "Text size" }, `${layout.id} keyboard settings exposed`);
  await waitForFocusInSurface(page, "dialog", `${layout.id} keyboard settings focus`);
  await capture(page, layout, "keyboard-settings-open");

  let contained = true;
  for (let index = 0; index < 6; index += 1) {
    await page.keyboard.press("Tab");
    const inside = await page.evaluate(() => {
      const active = document.activeElement;
      const surface = active?.closest?.('[role="dialog"]');
      return !!surface && surface.getAttribute("aria-hidden") !== "true";
    });
    if (!inside) { contained = false; break; }
  }
  check(mode, contained, "Tab stays inside the open settings dialog (containment)");
  await page.keyboard.press("Escape");
  await waitForSurfaceExit(page, `${layout.id} keyboard settings close`);
  const restored = await page.evaluate(() => document.activeElement?.getAttribute("aria-label") ?? null);
  check(mode, restored === "Reader settings",
    `Escape restores focus to the settings trigger (observed ${JSON.stringify(restored)})`);

  const overflowTrigger = button(page, "More article actions");
  await overflowTrigger.evaluate((node) => node.focus());
  await page.keyboard.press("Enter");
  await waitForSurfaceExposed(page, { role: "menu", text: "Open original" }, `${layout.id} keyboard overflow exposed`);
  await waitForFocusInSurface(page, "menu", `${layout.id} keyboard overflow focus`);
  await assertOverflowActions(page, `${layout.id} keyboard overflow actions`);
  await page.keyboard.press("Escape");
  await waitForSurfaceExit(page, `${layout.id} keyboard overflow close`);
  const restoredOverflow = await page.evaluate(() => document.activeElement?.getAttribute("aria-label") ?? null);
  check(mode, restoredOverflow === "More article actions",
    `Escape restores focus to the overflow trigger (observed ${JSON.stringify(restoredOverflow)})`);
  await leakProbe(page, `${layout.id} after keyboard flow`);
}

async function scenarioOpenImmediate(page, layout, mode) {
  // Contract (A/B verified against baseline 2b0ed27 and 8363): the background
  // pause is deliberate design — ReaderArticle.tsx ~22-42 cancels the optional
  // renderer load while activity is false, and ArticleHtmlSections (~382+)
  // mounts one initial batch then pauses expansion while activity is paused.
  // Headings are therefore NOT required to arrive while the sheet is open
  // (recorded as INFO). Required instead:
  //   C1 painted content never disappears while the sheet is open;
  //   C2 the early state stays nonblank ("Loading article" placeholder or
  //      painted chrome retained behind the sheet);
  //   C3/C4 full, strictly bounded recovery after close — no starvation.
  await page.goto(base, { waitUntil: "domcontentloaded" });
  await rowA(page).waitFor({ state: "visible", timeout: 30000 });
  // Initial reader opening, then the controls with zero explicit waits.
  await armClickMark(page, rowA(page));
  if (layout.hasTouch) await rowA(page).tap();
  else await rowA(page).click();
  await page.locator('[aria-label="Reader settings"]').first().waitFor({ state: "visible", timeout: 30000 });
  const chromeAt = await page.evaluate(() => performance.now());
  // Before the first overlay ever opens: dormant/current surfaces must not be
  // exposed, focusable or hit-testable.
  await leakProbe(page, `${layout.id} before first overlay open`);
  await tabSweep(page, `${layout.id} tab sweep before first overlay open`);
  const sample = await openSettings(page, layout, `${layout.id} immediate settings open`);
  note(mode, "immediateSettingsSample", sample);
  const clickMark = await readClickMark(page);
  if (clickMark != null) {
    results.longTaskPlacement.push({
      label: `${layout.id} initial reader opening (click -> reader chrome visible)`,
      windows: {
        pre: await longTaskWindow(page, clickMark - 500, clickMark),
        during: await longTaskWindow(page, clickMark, chromeAt),
        post: await longTaskWindow(page, chromeAt, chromeAt + 500),
      },
    });
    note(mode, "readerOpenToChromeMs", Math.round(chromeAt - clickMark));
  }
  await readinessPlacement(page, `${layout.id} route readiness (page init -> reader ready)`);
  check(mode, sample.controlsOnFirstFrame > 0,
    "immediate controls open shows controls on the first visible frame");
  await capture(page, layout, "settings-open");

  // C2: while the sheet is open from the first moment, the reader behind it
  // stays nonblank: painted chrome and/or the "Loading article" placeholder.
  const early = await page.evaluate(() => {
    const painted = (node) => {
      if (!node || !node.isConnected) return false;
      const rect = node.getBoundingClientRect();
      if (!rect.width || !rect.height) return false;
      if (rect.bottom < 0 || rect.top > innerHeight || rect.right < 0 || rect.left > innerWidth) return false;
      let opacity = 1;
      for (let parent = node; parent; parent = parent.parentElement) {
        const style = getComputedStyle(parent);
        if (style.display === "none" || style.visibility === "hidden") return false;
        opacity *= Number(style.opacity);
        if (opacity <= 0.05) return false;
      }
      return true;
    };
    return {
      headings: [...document.querySelectorAll("h1,h2,h3")].filter((node) => /^Section \d+$/.test(node.textContent.trim())).length,
      articleChars: document.body.innerText.length,
      loadingPlaceholder: /Loading article/i.test(document.body.innerText),
      paintedTexts: [...document.querySelectorAll("div,span,h1,h2,h3,p")]
        .filter((node) => ![...node.children].some((child) => child.textContent.trim() === node.textContent.trim()))
        .filter(painted).map((node) => node.textContent.trim()).filter(Boolean).slice(0, 30),
    };
  });
  await page.waitForTimeout(1500);
  const earlyLater = await articleMountState(page);
  note(mode, "articleStateWhileControlsOpenImmediately", { atOpen: early, t1500ms: earlyLater });
  note(mode, "INFO_headingsWhileModalActive", earlyLater.headings);
  await capture(page, layout, "controls-open-article-state", { settleMs: 0 });
  check(mode, early.loadingPlaceholder || early.paintedTexts.length > 0 || early.articleChars > 300,
    "early open keeps the reader nonblank behind the sheet (Loading article placeholder or painted chrome)");

  // C3/C4: closing the sheet must resume ALL content within a strict bound.
  const recoveryContentBudgetMs = Number(process.env.ORDO_UI_RECOVERY_CONTENT_MS ?? 5000);
  const recoveryFullBudgetMs = Number(process.env.ORDO_UI_RECOVERY_FULL_MS ?? 10000);
  const escapeAt = Date.now();
  await page.keyboard.press("Escape");
  await waitForSurfaceExit(page, `${layout.id} immediate settings close`);
  let contentMs = null, fullMs = null, last = null;
  for (let i = 0; i < Math.ceil(recoveryFullBudgetMs / 250) + 8; i += 1) {
    await page.waitForTimeout(250);
    last = await articleMountState(page);
    if (contentMs == null && last.headings >= 20) contentMs = Date.now() - escapeAt;
    if (last.headings >= 100 && last.articleChars > 20000) { fullMs = Date.now() - escapeAt; break; }
  }
  note(mode, "articleRecoveryAfterControlsClose", {
    contentMs, fullMs, budgets: { contentMs: recoveryContentBudgetMs, fullMs: recoveryFullBudgetMs },
    finalHeadings: last?.headings ?? 0, finalChars: last?.articleChars ?? 0,
  });
  check(mode, contentMs != null && contentMs <= recoveryContentBudgetMs && fullMs != null && fullMs <= recoveryFullBudgetMs,
    `article fully resumes after the sheet closes within budget (content ${contentMs}ms <= ${recoveryContentBudgetMs}ms, full ${fullMs}ms <= ${recoveryFullBudgetMs}ms)`);
  check(mode, (last?.headings ?? 0) >= 100 && (last?.articleChars ?? 0) > 20000,
    "no starvation after close: all headings/content are back");

  // C1 late pass: with the article fully painted, opening the controls must
  // never make painted content disappear.
  await waitReaderReady(page, {
    marker: markerOf(articleA.id), title: articleA.title, sections: articleA.sections,
  });
  const beforeLate = await articleMountState(page);
  await openSettings(page, layout, `${layout.id} settings late-open retention`);
  await page.waitForTimeout(1500);
  const duringLate = await articleMountState(page);
  note(mode, "lateOpenRetention", { before: beforeLate, during: duringLate });
  check(mode, beforeLate.headings >= 100 && duringLate.headings >= beforeLate.headings
    && duringLate.articleChars >= beforeLate.articleChars - 200,
    "already-painted article never disappears while the controls are open");
  await page.keyboard.press("Escape");
  await waitForSurfaceExit(page, `${layout.id} late-open settings close`);
  await capture(page, layout, "reader-settled");
}

async function scenarioCycleBounded(page, layout, mode) {
  const snapshot = async (label) => {
    const state = await page.evaluate(() => {
      const surfaces = [...document.querySelectorAll('[role="dialog"], [role="menu"]')];
      const visible = (node) => {
        const style = getComputedStyle(node);
        const rect = node.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
      };
      const fixedCovering = [...document.querySelectorAll("body *")].filter((node) => {
        const style = getComputedStyle(node);
        if (style.position !== "fixed") return false;
        const rect = node.getBoundingClientRect();
        return rect.width >= innerWidth * 0.9 && rect.height >= innerHeight * 0.9;
      }).length;
      return {
        elements: document.querySelectorAll("*").length,
        surfaces: surfaces.length,
        visibleSurfaces: surfaces.filter(visible).length,
        fixedCovering,
        menuitems: document.querySelectorAll('[role="menuitem"]').length,
      };
    });
    note(mode, label, state);
    return state;
  };

  await openSettings(page, layout, `${layout.id} cycle tour settings`);
  await page.keyboard.press("Escape");
  await waitForSurfaceExit(page, `${layout.id} cycle tour settings close`);
  await openOverflow(page, layout, `${layout.id} cycle tour overflow`);
  await page.keyboard.press("Escape");
  await waitForSurfaceExit(page, `${layout.id} cycle tour overflow close`);
  const first = await snapshot("cycleSnapshotAfterFirstTour");

  const phaseStart = await page.evaluate(() => performance.now());
  for (let cycle = 0; cycle < cycles; cycle += 1) {
    await button(page, "Reader settings").click();
    await waitForSurfaceExposed(page, { role: "dialog", text: "Text size" }, `${layout.id} cycle ${cycle} settings`);
    await page.keyboard.press("Escape");
    await waitForSurfaceExit(page, `${layout.id} cycle ${cycle} settings close`);
    await button(page, "More article actions").click();
    await waitForSurfaceExposed(page, { role: "menu", text: "Open original" }, `${layout.id} cycle ${cycle} overflow`);
    await page.keyboard.press("Escape");
    await waitForSurfaceExit(page, `${layout.id} cycle ${cycle} overflow close`);
  }
  const phaseEnd = await page.evaluate(() => performance.now());
  results.longTaskPlacement.push({
    label: `${layout.id} ${cycles}-cycle tour (total window)`,
    windows: { during: await longTaskWindow(page, phaseStart, phaseEnd) },
  });

  const after = await snapshot("cycleSnapshotAfterAllCycles");
  note(mode, "cycleGrowth", {
    elements: { first: first.elements, after: after.elements, delta: after.elements - first.elements },
    surfaces: { first: first.surfaces, after: after.surfaces, delta: after.surfaces - first.surfaces },
    fixedCovering: { first: first.fixedCovering, after: after.fixedCovering, delta: after.fixedCovering - first.fixedCovering },
    menuitems: { first: first.menuitems, after: after.menuitems, delta: after.menuitems - first.menuitems },
  });
  check(mode, after.elements <= first.elements * 1.02 + 120,
    `DOM size stays bounded over ${cycles} cycles (${first.elements} -> ${after.elements})`);
  check(mode, after.surfaces <= first.surfaces + 2,
    `overlay surface count stays bounded (future dormant layers legitimate) (${first.surfaces} -> ${after.surfaces})`);
  check(mode, after.fixedCovering <= first.fixedCovering + 2,
    `full-viewport layer count stays bounded (${first.fixedCovering} -> ${after.fixedCovering})`);
  check(mode, after.visibleSurfaces === 0, "no surface stays visible after the final cycle");
  await leakProbe(page, `${layout.id} after ${cycles} cycles`);
  await assertArticleIntact(page, `${layout.id} article after ${cycles} cycles`, {
    marker: markerOf(articleA.id), title: articleA.title, sections: articleA.sections,
  });
}

async function largestBackground(page) {
  return page.evaluate(() => {
    const candidates = [...document.querySelectorAll("body *")].map((node) => {
      const rect = node.getBoundingClientRect();
      return { area: rect.width * rect.height, color: getComputedStyle(node).backgroundColor };
    }).filter((entry) => entry.color && entry.color !== "rgba(0, 0, 0, 0)" && entry.color !== "transparent");
    candidates.sort((a, b) => b.area - a.area);
    return candidates[0]?.color ?? null;
  });
}

async function scenarioThemePalette(page, layout, mode) {
  // Two palette domains exist and must both be honored:
  //  - app chrome (library, account/settings) follows the Appearance theme;
  //  - reader surfaces follow the READER "Theme" control ("System" reads the
  //    device scheme), so an Appearance change alone legitimately does not
  //    repaint reader overlays.
  // Baseline reader overlay palettes in the current scheme.
  await openSettings(page, layout, `${layout.id} palette settings dark`);
  const darkDialog = await paletteProbe(page, "dark-dialog");
  note(mode, "paletteDarkDialog", darkDialog);
  await page.keyboard.press("Escape");
  await waitForSurfaceExit(page, `${layout.id} palette settings dark close`);
  await openOverflow(page, layout, `${layout.id} palette overflow dark`);
  const darkMenu = await paletteProbe(page, "dark-menu");
  note(mode, "paletteDarkMenu", darkMenu);
  await page.keyboard.press("Escape");
  await waitForSurfaceExit(page, `${layout.id} palette overflow dark close`);
  const darkDormant = await dormantPaletteProbe(page, "dark");
  note(mode, "paletteDarkDormant", darkDormant);

  // Account UI lives on the library header: return there first. The library is
  // app chrome, so its background is the app palette probe.
  await backToLibrary(page);
  const appBackgroundBefore = await largestBackground(page);
  await button(page, "Account and settings").click();
  const appearanceRow = page.getByRole("button", { name: /Appearance/ });
  await appearanceRow.waitFor({ state: "visible", timeout: 20000 });
  await appearanceRow.click();
  const themeTrigger = page.getByRole("button", { name: /^Theme, / });
  await themeTrigger.waitFor({ state: "visible", timeout: 20000 });
  const themeBefore = await themeTrigger.getAttribute("aria-label");

  let themeToggled = true;
  let themeMenuViaPointer = true;
  try {
    if (layout.hasTouch) await themeTrigger.tap();
    else await themeTrigger.click();
    const menuOpen = () => page.waitForFunction(() => {
      const menu = [...document.querySelectorAll('[role="menu"]')]
        .find((node) => node.getAttribute("aria-hidden") !== "true" && node.getBoundingClientRect().width > 0);
      return !!menu && (menu.textContent ?? "").includes("Light");
    }, null, { timeout: 1500 }).then(() => true).catch(() => false);
    themeMenuViaPointer = await menuOpen();
    if (!themeMenuViaPointer) {
      // Real behavior defect: record it, then activate through the keyboard so
      // the palette verification still runs (the run ends red either way).
      checkDeferred(mode, false, "theme select menu opens on pointer activation", {
        activation: layout.hasTouch ? "touch tap" : "mouse click",
        observed: "the Light/Dark/System menu never stays open after pointer activation on the 'Theme, <mode>' select",
        workingActivations: ["keyboard Enter", "touch tap (observed in isolation)"],
        repro: "Settings -> Appearance -> mouse-click the 'Theme, Dark' select; the option menu " +
          "does not open (its nodes flash into the DOM and out). Keyboard Enter opens it correctly.",
      });
      await themeTrigger.focus();
      await page.keyboard.press("Enter");
      await page.waitForFunction(() => {
        const menu = [...document.querySelectorAll('[role="menu"]')]
          .find((node) => node.getAttribute("aria-hidden") !== "true" && node.getBoundingClientRect().width > 0);
        return !!menu && (menu.textContent ?? "").includes("Light");
      }, null, { timeout: 5000 });
    } else {
      check(mode, true, "theme select menu opens on pointer activation");
    }
    const light = page.getByRole("menuitemradio", { name: "Light", exact: true })
      .or(page.getByRole("menuitem", { name: "Light", exact: true }));
    await light.first().click();
    await page.getByRole("button", { name: /^Theme, Light/ }).waitFor({ state: "visible", timeout: 10000 });
  } catch (error) {
    themeToggled = false;
    note(mode, "themeToggleGap", `could not toggle theme through the account UI: ${error.message}`);
  }
  note(mode, "themeSelect", { before: themeBefore, toggled: themeToggled, menuViaPointer: themeMenuViaPointer });

  // Design-mode toggle (shapes/motion, not palette).
  let designToggled = false;
  try {
    const designToggle = page.getByRole("switch", { name: "Expressive" })
      .or(page.getByRole("switch", { name: "Material 3 Expressive" }))
      .or(page.getByRole("button", { name: "Material 3 Expressive" }));
    const checkedBefore = await designToggle.first().getAttribute("aria-checked");
    await designToggle.first().click();
    await page.waitForTimeout(250);
    const checkedAfter = await designToggle.first().getAttribute("aria-checked");
    designToggled = checkedBefore !== checkedAfter;
    note(mode, "designToggle", { checkedBefore, checkedAfter });
  } catch (error) {
    note(mode, "designToggleGap", `could not toggle design mode through the account UI: ${error.message}`);
  }

  // Back to the library: the app chrome palette must have followed the toggle.
  try {
    await button(page, "Back").click();
  } catch { await page.goBack().catch(() => {}); }
  try {
    await button(page, "Back").click();
  } catch { await page.goBack().catch(() => {}); }
  await rowA(page).waitFor({ state: "visible", timeout: 20000 });
  const appBackgroundAfter = await largestBackground(page);
  note(mode, "appBackgroundPalette", { before: appBackgroundBefore, after: appBackgroundAfter });
  if (themeToggled && appBackgroundBefore && appBackgroundAfter) {
    checkDeferred(mode, appBackgroundBefore !== appBackgroundAfter,
      "app chrome palette follows the Appearance theme toggle",
      { before: appBackgroundBefore, after: appBackgroundAfter,
        screenshot: `${output}/${layout.id}-theme-toggled-reader-settled.png` });
  } else {
    note(mode, "appPaletteGap", `not decidable (toggled=${themeToggled}, before=${appBackgroundBefore}, after=${appBackgroundAfter})`);
  }

  // Return to the reader and check reader-overlay palette behavior.
  await rowA(page).click();
  await waitReaderReady(page, {
    marker: markerOf(articleA.id), title: articleA.title, sections: articleA.sections,
  });

  await openSettings(page, layout, `${layout.id} palette settings after theme toggle`);
  const currentDialog = await paletteProbe(page, "after-app-theme-toggle");
  note(mode, "paletteReaderDialogAfterAppToggle", currentDialog);
  await capture(page, layout, "theme-toggled-settings-open");
  await page.keyboard.press("Escape");
  await waitForSurfaceExit(page, `${layout.id} palette settings after toggle close`);
  const dormantAfter = await dormantPaletteProbe(page, "after-app-theme-toggle");
  note(mode, "paletteDormantAfterAppToggle", dormantAfter);

  // Dormant/prepared reader overlays must track the *current* reader palette:
  // no stale colors left over from an earlier palette.
  const currentDialogColor = currentDialog.surfacePanel?.color ?? null;
  const dormantDialogColor = (dormantAfter.dormant.find((entry) => entry.role === "dialog" && entry.color) ?? {}).color ?? null;
  if (currentDialogColor && dormantDialogColor) {
    checkDeferred(mode, dormantDialogColor === currentDialogColor,
      "dormant reader overlay matches the current reader palette (no stale prepared colors)",
      { opened: currentDialogColor, dormant: dormantDialogColor,
        note: "reader surfaces follow the reader Theme control (System = device scheme); " +
          "an Appearance change alone legitimately leaves them on the reader palette" });
  } else {
    note(mode, "dormantPaletteGap", `not decidable (opened=${currentDialogColor}, dormant=${dormantDialogColor})`);
  }

  // Changing the reader's own Theme must repaint the overlay, including its
  // dormant/prepared state.
  await openSettings(page, layout, `${layout.id} palette settings before reader theme change`);
  const beforeReaderTheme = await paletteProbe(page, "reader-theme-before");
  const readerThemeLight = page.getByRole("radio", { name: "Light", exact: true });
  if (await readerThemeLight.count()) {
    await readerThemeLight.first().click();
    await page.waitForTimeout(600);
    const afterReaderTheme = await paletteProbe(page, "reader-theme-after");
    note(mode, "readerThemeChange", { before: beforeReaderTheme, after: afterReaderTheme });
    const beforeColor = beforeReaderTheme.surfacePanel?.color ?? null;
    const afterColor = afterReaderTheme.surfacePanel?.color ?? null;
    checkDeferred(mode, !!beforeColor && !!afterColor && beforeColor !== afterColor,
      "reader overlay palette follows the reader Theme control",
      { before: beforeColor, after: afterColor });
    await capture(page, layout, "reader-theme-light-settings-open");
    await page.keyboard.press("Escape");
    await waitForSurfaceExit(page, `${layout.id} reader theme change close`);
    const dormantReaderTheme = await dormantPaletteProbe(page, "reader-theme-after");
    const dormantColor = (dormantReaderTheme.dormant.find((entry) => entry.role === "dialog" && entry.color) ?? {}).color ?? null;
    note(mode, "paletteDormantAfterReaderTheme", dormantReaderTheme);
    if (afterColor && dormantColor) {
      checkDeferred(mode, dormantColor === afterColor,
        "dormant reader overlay uses the new palette after a reader theme change",
        { opened: afterColor, dormant: dormantColor });
    } else {
      note(mode, "dormantPaletteGap", `not decidable after reader theme change (opened=${afterColor}, dormant=${dormantColor})`);
    }
  } else {
    note(mode, "readerThemeGap", "no role=radio 'Light' control in the reader settings sheet; reader theme change not exercised");
    await page.keyboard.press("Escape");
    await waitForSurfaceExit(page, `${layout.id} palette settings before reader theme change close`);
  }
  await capture(page, layout, "theme-toggled-reader-settled");
  note(mode, "designModeToggled", designToggled);
  await leakProbe(page, `${layout.id} after theme/design toggle`);
}

/* ------------------------------------------------------------------ */
/* Runner                                                              */
/* ------------------------------------------------------------------ */

function check(mode, ok, label) {
  mode.checks[label] = !!ok;
  assert.ok(ok, `${mode.id}: ${label}`);
}
function note(mode, label, value) {
  mode.notes[label] = value;
}
// Records an actual correctness failure with evidence without aborting the
// run, so one broken behavior does not hide the rest of the coverage. The run
// still exits non-zero: the runner asserts results.deferredFailures empty.
function checkDeferred(mode, ok, label, evidence) {
  mode.checks[label] = !!ok;
  if (ok) return;
  const failure = { layout: mode.id, label, evidence };
  (mode.deferredFailures ??= []).push(failure);
  results.deferredFailures.push(failure);
}

const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.PLAYWRIGHT_CHROMIUM,
  args: ["--no-sandbox"],
});

try {
  for (const layout of layouts) {
    const context = await browser.newContext({
      viewport: layout.viewport,
      colorScheme: "dark",
      reducedMotion: "no-preference",
      hasTouch: layout.hasTouch,
      isMobile: layout.isMobile,
      deviceScaleFactor: 1,
    });
    const page = await context.newPage();
    page.setDefaultTimeout(30000);
    await installFixtures(page, layout);
    const cdp = await context.newCDPSession(page);
    if (cpuThrottle > 0) await cdp.send("Emulation.setCPUThrottlingRate", { rate: cpuThrottle });
    const mode = {
      id: layout.id,
      layout: layout.id,
      viewport: layout.viewport,
      input: layout.hasTouch ? "touch" : "mouse",
      cpuThrottle,
      checks: {},
      notes: {},
    };
    results.layouts.push(mode);
    const phase = async (label, run) => {
      try {
        await run();
      } catch (error) {
        results.errors.push({ kind: "phase", layout: layout.id, phase: label, message: error?.message ?? String(error) });
        await page.screenshot({ path: `${output}/${layout.id}-${label}-failure.png` }).catch(() => {});
        await writeFile(`${output}/${layout.id}-${label}-failure.json`, JSON.stringify({
          surfaces: await surfaceState(page).catch(() => null),
          longTasks: (await page.evaluate(() => window.__longTasks ?? [])).slice(-20),
        }, null, 2)).catch(() => {});
        throw error;
      }
    };
    try {
      await phase("open-immediate", () => scenarioOpenImmediate(page, layout, mode));
      await phase("dormant-exposure", () => scenarioDormantExposure(page, layout, mode));
      await phase("quick-reopen", () => scenarioQuickReopen(page, layout, mode));
      await phase("preference-then-overflow", () => scenarioPreferenceThenOverflow(page, layout, mode));
      await phase("route-article-b", () => scenarioRouteArticleB(page, layout, mode));
      await phase("keyboard", () => scenarioKeyboard(page, layout, mode));
      await phase("cycle-bounded", () => scenarioCycleBounded(page, layout, mode));
      await phase("theme-palette", () => scenarioThemePalette(page, layout, mode));
      check(mode, (await exposedCount(page, "dialog")) === 0 && (await exposedCount(page, "menu")) === 0,
        "no overlay role is exposed at the end of the layout pass");
    } finally {
      await context.close();
    }
    console.log(JSON.stringify({
      layout: mode.id,
      checks: Object.keys(mode.checks).length,
      failed: Object.entries(mode.checks).filter(([, ok]) => !ok).map(([label]) => label),
    }));
  }
  assert.deepEqual(results.errors, [], "Lifecycle run must have no console/page/phase errors");
  assert.deepEqual(results.deferredFailures.map((failure) => `${failure.layout}: ${failure.label}`), [],
    "Deferred correctness failures (evidence recorded in results.deferredFailures)");
} finally {
  results.finishedAt = new Date().toISOString();
  await writeFile(`${output}/results.json`, JSON.stringify(results, null, 2)).catch(() => {});
  await browser.close();
}
