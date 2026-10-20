/**
 * Fixture-backed smoke, keyboard, and live-state checks for every settings
 * screen and every public authentication form. No real server is contacted:
 * the session, server info, lists, and every POST are fulfilled locally.
 *
 * Run against an Expo web export served with SPA fallback:
 *   PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs \
 *   PLAYWRIGHT_CHROMIUM=/path/to/chrome \
 *   ORDO_UI_URL=http://127.0.0.1:8255 \
 *   node apps/mobile/scripts/unified-screens-ui.mjs
 *
 * Default: dark + Expressive at 390x844 and 1280x800.
 * ORDO_UI_MATRIX=1: both color schemes x both design modes x both layouts.
 * ORDO_UI_OUTPUT overrides /tmp/opencode/ordo-unified-screens.
 *
 * This is a functional matrix: it reports checks, routes, screenshots, and
 * failures only; it makes no timing or frame-rate claims.
 */
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? "playwright");
const base = (process.env.ORDO_UI_URL ?? "http://127.0.0.1:8255").replace(/\/+$/, "");
const output = process.env.ORDO_UI_OUTPUT ?? "/tmp/opencode/ordo-unified-screens";
const matrix = process.env.ORDO_UI_MATRIX === "1";
const stamp = "2026-10-20T12:00:00Z";

const user = {
  id: "unified-fixture-user",
  displayName: "Fixture Reader",
  email: "reader@example.test",
  emailVerified: true,
  hasAvatar: false,
  avatarUpdatedAt: null,
  mfaEnabled: false,
  libraryEncrypted: false,
  canRenameInstance: true,
  createdAt: stamp,
  preferences: { fontFamily: "sans", fontSize: "medium", lineSpacing: "default", theme: "system", amoled: false },
};
const serverInfo = {
  name: "Fixture Ordo",
  version: "0.3.0",
  registrationEnabled: true,
  emailVerificationRequired: false,
  smtpConfigured: true,
  profilePictureMaxBytes: 2 * 1024 * 1024,
  avatarAllowAnimated: false,
  mfaRequired: false,
  folderLockTypes: true,
  reminders: true,
};
const tokens = { accessToken: "fixture-access", refreshToken: "fixture-refresh", expiresIn: 86400 };
const tagSummary = { id: "tag-design", name: "Design", color: "blue" };
const tag = { ...tagSummary, bookmarkCount: 4, createdAt: stamp, updatedAt: stamp };
const folders = [
  { id: "folder-reading", name: "Reading list", icon: "library-outline", pinned: true, protected: false,
    lockType: null, pinLength: null, bookmarkCount: 12, unreadCount: 3, createdAt: stamp, updatedAt: stamp },
  { id: "folder-work", name: "Work", icon: "briefcase-outline", pinned: false, protected: false,
    lockType: null, pinLength: null, bookmarkCount: 5, unreadCount: 1, createdAt: stamp, updatedAt: stamp },
];
const sessions = [
  { id: "session-current", deviceInfo: "Chromium on Linux", deviceName: "Browser session", deviceType: "desktop",
    ip: "203.0.113.10", lastSeenAt: stamp, createdAt: stamp, current: true },
  { id: "session-phone", deviceInfo: "Android 15", deviceName: "Pixel 9", deviceType: "phone",
    ip: "198.51.100.24", lastSeenAt: stamp, createdAt: stamp, current: false },
  { id: "session-tablet", deviceInfo: "iPadOS 18", deviceName: "iPad Air", deviceType: "tablet",
    ip: "198.51.100.31", lastSeenAt: stamp, createdAt: stamp, current: false },
];
const bookmarks = [
  { id: "bookmark-unified", folderId: null, url: "https://example.test/unified", title: "Unified fixture bookmark",
    description: "A complete bookmark fixture for the library behind settings.", domain: "example.test",
    fetchStatus: "ok", extractionReason: null, contentKind: "article", contentKindOverride: null,
    extractionVersion: 1, author: "Fixture Author", publishedAt: stamp, readingTimeMinutes: 3,
    readProgress: 0, completedAt: null, isRead: false, remindAt: null, tags: [tagSummary], suggestedTags: [],
    createdAt: stamp, updatedAt: stamp },
];
const authStorage = { user, tokens, accessExpiresAt: Date.now() + 86400000, sessionUpdatedAt: Date.now() };

const results = {
  baseUrl: base,
  matrix,
  routeCount: 0,
  configs: [],
  routes: [],
  steps: [],
  screenshots: [],
  network: {},
  errors: [],
  failures: [],
};
await mkdir(output, { recursive: true });

let browser;
let currentRoute = "startup";

function requestKey(method, pathname) {
  return `${method} ${pathname}`;
}

function noteNetwork(method, pathname) {
  const key = requestKey(method, pathname);
  results.network[key] = (results.network[key] ?? 0) + 1;
}

function answerFor(method, pathname) {
  if (pathname === "/api/health") return { status: "ok" };
  if (pathname === "/api/server/info") return serverInfo;
  if (pathname === "/api/server/name") return serverInfo;
  if (pathname === "/api/auth/me") return user;
  if (pathname === "/api/auth/refresh") return { user, tokens };
  if (pathname === "/api/auth/preferences") return user;
  if (pathname === "/api/auth/sessions" && method === "GET") return sessions;
  if (/^\/api\/auth\/sessions\/[^/]+$/.test(pathname)) return { success: true };
  if (pathname === "/api/auth/mfa") return { totpEnabled: false, backupCodesRemaining: 0 };
  if (pathname === "/api/auth/mfa/totp/begin") {
    return { secret: "JBSWY3DPEHPK3PXP", otpauthUrl: "otpauth://totp/ordo:reader?secret=JBSWY3DPEHPK3PXP&issuer=ordo" };
  }
  if (pathname === "/api/auth/mfa/totp/confirm") {
    return { user: { ...user, mfaEnabled: true }, backupCodes: ["FIXTURE1", "FIXTURE2"] };
  }
  if (pathname === "/api/auth/mfa/backup-codes/regenerate") return { backupCodes: ["FIXTURE3", "FIXTURE4"] };
  if (pathname === "/api/auth/email/change" || pathname === "/api/auth/email/change/resend") return { success: true };
  if (pathname === "/api/auth/email/verify-change") return user;
  if (pathname === "/api/auth/login/mfa/email") return { success: true };
  if (pathname === "/api/auth/logout") return { success: true };
  if (pathname === "/api/folders") return folders;
  if (/^\/api\/folders\/[^/]+$/.test(pathname)) return folders[0];
  if (pathname === "/api/tags") return [tag];
  if (pathname === "/api/bookmarks/extraction-progress") return { pending: 1, total: bookmarks.length, completed: 0 };
  if (pathname === "/api/bookmarks/reminders") return [];
  if (pathname.startsWith("/api/bookmarks")) return { items: bookmarks, nextCursor: null, hasMore: false };
  if (pathname.startsWith("/api/import/")) return { status: "failed", failure: "Fixture import has no job." };
  return { success: true };
}

async function installFixtures(page, { authenticated, theme, expressive, mode }) {
  await page.addInitScript(({ authenticated, theme, expressive, authStorage }) => {
    localStorage.setItem("ordo.settings", JSON.stringify({
      themeMode: theme,
      expressive,
      materialYouColors: false,
      serverUrl: "https://fixture.example.test",
      hapticsEnabled: false,
    }));
    if (authenticated) localStorage.setItem("secure.ordo.auth", JSON.stringify(authStorage));
    else localStorage.removeItem("secure.ordo.auth");
  }, { authenticated, theme, expressive, authStorage });
  page.on("pageerror", (error) => {
    const entry = { mode, route: currentRoute, message: error.message };
    results.errors.push(entry);
  });
  await page.route("**/*", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const pathname = url.pathname;
    if (url.origin === new URL(base).origin) return route.continue();
    noteNetwork(request.method(), pathname);
    if (request.method() === "OPTIONS") {
      return route.fulfill({
        status: 204,
        headers: {
          "access-control-allow-origin": "*",
          "access-control-allow-headers": "*",
          "access-control-allow-methods": "*",
        },
      });
    }
    if (url.hostname === "www.google.com" || request.resourceType() === "image") {
      return route.fulfill({
        contentType: "image/svg+xml",
        headers: { "access-control-allow-origin": "*" },
        body: '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"/>',
      });
    }
    if (url.hostname === "api.github.com") {
      return route.fulfill({
        contentType: "application/json",
        headers: { "access-control-allow-origin": "*" },
        body: "[]",
      });
    }
    const body = answerFor(request.method(), pathname);
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: {
        "access-control-allow-origin": "*",
        "access-control-allow-headers": "*",
        "access-control-allow-methods": "*",
      },
      body: JSON.stringify(body),
    });
  });
}

async function pageHeading(page, title, { auth = false } = {}) {
  if (auth) {
    const heading = page.getByRole("heading", { name: title, exact: true });
    await heading.waitFor({ state: "visible" });
    return heading;
  }
  const bar = page.getByTestId("material-app-bar").filter({ hasText: title }).last();
  await bar.waitFor({ state: "visible" });
  await bar.getByText(title, { exact: true }).first().waitFor({ state: "visible" });
  return bar;
}

async function button(page, name, exact = true) {
  const locator = page.getByRole("button", { name, exact }).last();
  await locator.waitFor({ state: "visible" });
  return locator;
}

async function assertInteractiveNames(page, label) {
  const problems = await page.locator([
    '[role="button"]', '[role="link"]', '[role="switch"]', '[role="radio"]',
    '[role="menuitem"]', '[role="menuitemradio"]', '[role="menuitemcheckbox"]',
  ].join(",")).evaluateAll((nodes) => nodes.flatMap((node) => {
    if (node.closest('[aria-hidden="true"], [inert]')) return [];
    const rect = node.getBoundingClientRect();
    const style = getComputedStyle(node);
    if (!rect.width || !rect.height || style.display === "none" || style.visibility === "hidden") return [];
    const name = (node.getAttribute("aria-label") ?? node.textContent ?? "").trim();
    return name ? [] : [{ role: node.getAttribute("role"), html: node.outerHTML.slice(0, 180) }];
  }));
  assert.deepEqual(problems, [], `${label}: every visible control has an accessible name`);
}

async function assertDraftTyping(page, locator, value, label) {
  await locator.waitFor({ state: "visible" });
  await locator.click();
  await page.keyboard.press("Control+A");
  await page.keyboard.press("Backspace");
  let typed = "";
  for (const character of value) {
    await page.keyboard.type(character);
    typed += character;
    assert.equal(await locator.inputValue(), typed, `${label}: controlled draft contains ${JSON.stringify(typed)}`);
    assert.ok(await locator.evaluate((node) => node === document.activeElement), `${label}: keyboard focus is retained after ${JSON.stringify(character)}`);
  }
}

async function typeOtp(page, prefix, digits) {
  const first = page.getByLabel(new RegExp(`^${prefix}, (?:digit|character) 1 of \\d+`)).first();
  await first.waitFor({ state: "visible" });
  await first.click();
  await page.keyboard.type(digits);
}

async function waitNoOpenMenu(page) {
  await page.waitForFunction(() => !document.querySelector('[role="menu"]:not([aria-hidden="true"])'), undefined, { timeout: 15000 });
}

async function waitPreference(page, key, value) {
  await page.waitForFunction(({ key, value }) => {
    try {
      return JSON.parse(localStorage.getItem("ordo.settings") || "{}")[key] === value;
    } catch {
      return false;
    }
  }, { key, value }, { timeout: 15000 });
}

async function settle(page, ms = 300) {
  await page.waitForTimeout(ms);
  await page.evaluate(() => document.fonts?.ready).catch(() => {});
}

async function activateWithKeyboard(page, locator, label) {
  await locator.focus();
  assert.ok(await locator.evaluate((node) => node === document.activeElement || node.contains(document.activeElement)),
    `${label}: receives keyboard focus`);
  await page.keyboard.press("Enter");
}

async function captureFailure(page, mode, route, step, error) {
  const slug = route.replace(/^\//, "").replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "") || "start";
  const shot = `${output}/${mode}-${slug}-failure.png`;
  const bodyFile = `${output}/${mode}-${slug}-failure.txt`;
  await page.screenshot({ path: shot }).catch(() => {});
  await writeFile(bodyFile, await page.locator("body").innerText().catch(() => "Page unavailable")).catch(() => {});
  results.failures.push({ mode, route, step, message: String(error?.stack ?? error), screenshot: shot, bodyFile });
  console.error(`[failure] ${mode} ${route} (${step}): ${error?.message ?? error}`);
}

async function runRoute(page, mode, route, check) {
  currentRoute = route.path;
  const errorStart = results.errors.length;
  let step = "load";
  let backPath = null;
  let screenshot = null;
  try {
    await page.goto(base + route.path, { waitUntil: "domcontentloaded" });
    await pageHeading(page, route.title, { auth: route.auth });
    await settle(page);
    step = "accessible controls";
    await assertInteractiveNames(page, `${route.path} heading`);
    step = "content";
    if (route.capture) {
      screenshot = `${output}/settings-${route.capture}-${mode.match(/-(\d+x\d+)$/)?.[1] ?? "layout"}.png`;
      await page.screenshot({ path: screenshot });
      results.screenshots.push(screenshot);
    }
    await check(page);
    if (route.back !== false) {
      step = "back";
      const before = new URL(page.url()).pathname;
      const back = await button(page, "Back");
      await activateWithKeyboard(page, back, `${route.path} Back`);
      await page.waitForFunction((previous) => location.pathname !== previous, before, { timeout: 20000 });
      backPath = new URL(page.url()).pathname;
      assert.ok(backPath === "/" || backPath === "/settings" || backPath.startsWith("/settings/"),
        `${route.path}: Back lands on an app screen (got ${backPath})`);
    } else {
      backPath = new URL(page.url()).pathname;
    }
    await settle(page, 250);
    const errors = results.errors.slice(errorStart);
    assert.deepEqual(errors, [], `${route.path}: no page errors`);
    results.routes.push({ mode, route: route.path, status: "passed", backPath, screenshot });
  } catch (error) {
    const errors = results.errors.slice(errorStart);
    await captureFailure(page, mode, route.path, step, error);
    if (errors.length) results.failures.at(-1).pageErrors = errors;
    results.routes.push({ mode, route: route.path, status: "failed", step, backPath, screenshot });
  }
}

async function runStep(page, mode, label, fn) {
  currentRoute = label;
  const errorStart = results.errors.length;
  try {
    await fn();
    const errors = results.errors.slice(errorStart);
    assert.deepEqual(errors, [], `${label}: no page errors`);
    results.steps.push({ mode, step: label, status: "passed" });
  } catch (error) {
    await captureFailure(page, mode, label, "step", error);
    const errors = results.errors.slice(errorStart);
    if (errors.length) results.failures.at(-1).pageErrors = errors;
    results.steps.push({ mode, step: label, status: "failed" });
  }
}

async function checkAppearanceAndControls(page, config) {
  await runStep(page, config.mode, "settings/preferences:appearance", async () => {
    await page.goto(base + "/settings/appearance", { waitUntil: "domcontentloaded" });
    await pageHeading(page, "Appearance");
    await settle(page);

    const expressive = page.getByRole("switch", { name: "Expressive", exact: true });
    const initialExpressive = (await expressive.getAttribute("aria-checked")) === "true";
    await expressive.click();
    await page.waitForFunction((expected) => {
      const node = [...document.querySelectorAll('[role="switch"]')].find((item) => item.getAttribute("aria-label") === "Expressive");
      return node?.getAttribute("aria-checked") === String(expected);
    }, !initialExpressive, { timeout: 15000 });
    await waitPreference(page, "expressive", !initialExpressive);
    await expressive.click();
    await page.waitForFunction((expected) => {
      const node = [...document.querySelectorAll('[role="switch"]')].find((item) => item.getAttribute("aria-label") === "Expressive");
      return node?.getAttribute("aria-checked") === String(expected);
    }, initialExpressive, { timeout: 15000 });
    await waitPreference(page, "expressive", initialExpressive);

    const initialTheme = config.theme;
    const initialThemeLabel = initialTheme === "dark" ? "Dark" : "Light";
    const otherTheme = initialTheme === "dark" ? "Light" : "Dark";
    const otherThemeValue = otherTheme.toLowerCase();
    let themeTrigger = page.getByRole("button", { name: new RegExp(`^Theme, ${initialThemeLabel}$`) }).last();
    await themeTrigger.waitFor({ state: "visible" });
    await themeTrigger.focus();
    await page.keyboard.press("Enter");
    await page.getByRole("menu").waitFor({ state: "visible" });
    await page.keyboard.press("Escape");
    await waitNoOpenMenu(page);
    await themeTrigger.click();
    await page.getByRole("menuitemradio", { name: otherTheme, exact: true }).click();
    await waitPreference(page, "themeMode", otherThemeValue);
    themeTrigger = page.getByRole("button", { name: new RegExp(`^Theme, ${otherTheme}$`) }).last();
    await themeTrigger.waitFor({ state: "visible" });
    await themeTrigger.click();
    await page.getByRole("menuitemradio", { name: initialThemeLabel, exact: true }).click();
    await waitPreference(page, "themeMode", initialTheme);
    await page.getByRole("button", { name: new RegExp(`^Theme, ${initialThemeLabel}$`) }).last().waitFor({ state: "visible" });
  });

  await runStep(page, config.mode, "settings/preferences:controls", async () => {
    await page.goto(base + "/settings/controls", { waitUntil: "domcontentloaded" });
    await pageHeading(page, "Controls");
    await settle(page);

    let tap = page.getByRole("button", { name: /^Tap action,/ }).last();
    const initialTap = await tap.getAttribute("aria-label");
    await tap.focus();
    await page.keyboard.press("Enter");
    await page.getByRole("menu").waitFor({ state: "visible" });
    await page.keyboard.press("Escape");
    await waitNoOpenMenu(page);
    assert.equal(await tap.getAttribute("aria-label"), initialTap, "Controls: dismissing the Tap menu leaves its preference unchanged");

    await tap.click();
    await page.getByRole("menuitemradio", { name: "New folder", exact: true }).click();
    await waitPreference(page, "createButtonTapAction", "folder");
    await page.getByRole("button", { name: "Tap action, New folder", exact: true }).last().waitFor({ state: "visible" });
    tap = page.getByRole("button", { name: "Tap action, New folder", exact: true }).last();
    await tap.click();
    await page.getByRole("menuitemradio", { name: "Save bookmark", exact: true }).click();
    await waitPreference(page, "createButtonTapAction", "bookmark");
    await page.getByRole("button", { name: "Tap action, Save bookmark", exact: true }).last().waitFor({ state: "visible" });

    const force = page.getByRole("switch", { name: "Force dark mode", exact: true });
    const initialForce = (await force.getAttribute("aria-checked")) === "true";
    await force.click();
    await waitPreference(page, "forceWebsiteDark", !initialForce);
    await force.click();
    await waitPreference(page, "forceWebsiteDark", initialForce);
  });
}

const settingsRoutes = [
  {
    path: "/settings", title: "Settings", capture: "overview",
    check: async (page) => {
      await button(page, "Manage your account");
      for (const name of ["Appearance", "Controls", "Active sessions", "Hosting", "Data", "About", "Sign out"]) {
        await button(page, name);
      }
      await page.getByText("Preferences", { exact: true }).waitFor({ state: "visible" });
      await page.getByText("Account and storage", { exact: true }).waitFor({ state: "visible" });
      await button(page, "Sign out").then((signOut) => signOut.click());
      await page.getByText("Sign out?", { exact: true }).waitFor({ state: "visible" });
      await page.getByText("You'll need to sign in again.", { exact: true }).waitFor({ state: "visible" });
      await page.keyboard.press("Escape");
      await page.getByText("Sign out?", { exact: true }).waitFor({ state: "hidden" });
      assert.equal(new URL(page.url()).pathname, "/settings", "Cancelling sign-out keeps the settings screen");
    },
  },
  {
    path: "/settings/account", title: "Account",
    check: async (page) => {
      await button(page, "Profile picture");
      for (const name of ["Display name", "Email", "Password", "Authenticator", "Delete account"]) {
        await button(page, name);
      }
      await page.getByText(user.displayName, { exact: true }).first().waitFor({ state: "visible" });
      await page.getByText(user.email, { exact: true }).first().waitFor({ state: "visible" });
    },
  },
  {
    path: "/settings/appearance", title: "Appearance", capture: "appearance",
    check: async (page, config) => {
      const expressive = page.getByRole("switch", { name: "Expressive", exact: true });
      await expressive.waitFor({ state: "visible" });
      assert.equal(await expressive.getAttribute("aria-checked"), String(config.expressive), "Appearance: Expressive reflects the fixture");
      await page.getByRole("button", { name: /^Theme, (Dark|Light)$/ }).last().waitFor({ state: "visible" });
      await page.getByRole("switch", { name: "Material You colors", exact: true }).waitFor({ state: "visible" });
      for (const name of ["Standard", "Medium", "High"]) {
        await page.getByRole("radio", { name, exact: true }).waitFor({ state: "visible" });
      }
      await page.getByRole("switch", { name: "AMOLED black", exact: true }).waitFor({ state: "visible" });
      await page.getByRole("button", { name: /^Page transitions,/ }).last().waitFor({ state: "visible" });
      await page.getByRole("switch", { name: "Haptic feedback", exact: true }).waitFor({ state: "visible" });
    },
  },
  {
    path: "/settings/controls", title: "Controls", capture: "controls",
    check: async (page) => {
      await page.getByRole("button", { name: /^Tap action,/ }).last().waitFor({ state: "visible" });
      await page.getByRole("button", { name: /^Press and hold action,/ }).last().waitFor({ state: "visible" });
      await page.getByRole("button", { name: /^Open websites in,/ }).last().waitFor({ state: "visible" });
      await page.getByRole("switch", { name: "Force dark mode", exact: true }).waitFor({ state: "visible" });
    },
  },
  {
    path: "/settings/security", title: "Security", capture: "security",
    check: async (page) => {
      await page.getByText("Authenticator", { exact: true }).first().waitFor({ state: "visible" });
      await button(page, "Set up authenticator").then((setup) => setup.click());
      await page.getByText("Can't scan? Tap to copy this key into your app:", { exact: true }).waitFor({ state: "visible" });
      await button(page, "Copy authenticator key");
      await page.getByLabel(/^Authenticator code, digit 1 of 6/).waitFor({ state: "visible" });
      await button(page, "Enlarge authenticator QR code");
    },
  },
  {
    path: "/settings/data", title: "Data",
    check: async (page) => {
      await page.getByRole("button", { name: /^Import from file,/ }).last().waitFor({ state: "visible" });
      for (const name of ["JSON", "HTML", "CSV"]) {
        await page.getByRole("radio", { name, exact: true }).waitFor({ state: "visible" });
      }
      await page.getByRole("button", { name: /^Export / }).last().waitFor({ state: "visible" });
      await button(page, "Include").then((include) => include.click());
      await page.getByRole("checkbox", { name: /^Reading list, 12 bookmarks/ }).waitFor({ state: "visible" });
      await page.getByRole("checkbox", { name: /^Work, 5 bookmarks/ }).waitFor({ state: "visible" });
      await button(page, "Include").then((include) => include.click());
    },
  },
  {
    path: "/settings/server", title: "Hosting",
    check: async (page) => {
      await page.getByText("Fixture Ordo", { exact: true }).waitFor({ state: "visible" });
      await page.getByText("fixture.example.test", { exact: true }).waitFor({ state: "visible" });
      await page.getByText("Connected · 0.3.0", { exact: true }).waitFor({ state: "visible" });
      await page.getByRole("button", { name: /^Edit server,/ }).last().waitFor({ state: "visible" });
      await page.getByRole("button", { name: /^Use ordo Cloud,/ }).last().click();
      await page.getByText("Use ordo Cloud?", { exact: true }).waitFor({ state: "visible" });
      await page.keyboard.press("Escape");
      await page.getByText("Use ordo Cloud?", { exact: true }).waitFor({ state: "hidden" });
      assert.equal(new URL(page.url()).pathname, "/settings/server", "Cancelling a hosting switch stays on Hosting");
    },
  },
  {
    path: "/settings/sessions", title: "Active sessions",
    check: async (page) => {
      await page.getByText("Signed-in devices", { exact: true }).waitFor({ state: "visible" });
      await page.getByText("Browser session", { exact: true }).waitFor({ state: "visible" });
      await page.getByText("Pixel 9", { exact: true }).waitFor({ state: "visible" });
      await page.getByText("iPad Air", { exact: true }).waitFor({ state: "visible" });
      const revoke = page.getByRole("button", { name: "Revoke", exact: true });
      assert.equal(await revoke.count(), 2, "Sessions: only other devices expose Revoke");
      await revoke.first().click();
      await page.getByText("Revoke this session?", { exact: true }).waitFor({ state: "visible" });
      await page.keyboard.press("Escape");
      await page.getByText("Revoke this session?", { exact: true }).waitFor({ state: "hidden" });
      assert.equal(await page.getByRole("button", { name: "Revoke", exact: true }).count(), 2, "Cancelling revoke keeps every session");
    },
  },
  {
    path: "/settings/about", title: "About",
    check: async (page) => {
      for (const text of ["Version", "Variant", "Commit", "Origin", "Changelog", "Source", "Website", "License", "AGPL-3.0"]) {
        await page.getByText(text, { exact: true }).first().waitFor({ state: "visible" });
      }
      await page.getByRole("link", { name: "© Axolet", exact: true }).waitFor({ state: "visible" });
    },
  },
  {
    path: "/settings/email", title: "Email",
    check: async (page) => {
      const currentEmail = page.getByLabel(/^Current email/).first();
      await currentEmail.waitFor({ state: "visible" });
      assert.equal(await currentEmail.inputValue(), user.email, "Email: current address is prefilled");
      assert.ok(await currentEmail.isEditable().then((editable) => !editable), "Email: current address is read-only");
      const newEmail = page.getByLabel(/^New email/).first();
      await newEmail.waitFor({ state: "visible" });
      await assertDraftTyping(page, page.getByLabel(/^Current password/).first(), "emailPass123", "Email current password");
      await newEmail.click();
      await page.keyboard.type("changed@example.test");
      assert.equal(await newEmail.inputValue(), "changed@example.test", "Email: new address draft is controlled");
      await button(page, "Send code");
      assert.equal(new URL(page.url()).pathname, "/settings/email", "Email: checks never submit the fixture change");
    },
  },
  {
    path: "/settings/password", title: "Password",
    check: async (page) => {
      await assertDraftTyping(page, page.getByLabel(/^Current password/).first(), "currentPass123", "Password current");
      await assertDraftTyping(page, page.getByLabel(/^New password/).first(), "newPass456", "Password new");
      await assertDraftTyping(page, page.getByLabel(/^Confirm new password/).first(), "newPass456", "Password confirmation");
      await button(page, "Show password");
      await button(page, "Change password");
      assert.equal(new URL(page.url()).pathname, "/settings/password", "Password: checks never submit the fixture change");
    },
  },
  {
    path: "/settings/delete-account", title: "Delete account",
    check: async (page) => {
      await page.getByText("This cannot be undone.", { exact: false }).waitFor({ state: "visible" });
      await assertDraftTyping(page, page.getByLabel(/^Password/).first(), "deletePass123", "Delete account password");
      const confirmation = page.getByLabel(/^Confirmation/).first();
      await assertDraftTyping(page, confirmation, "DELETE MY ACCOUNT", "Delete account confirmation");
      const deleteButton = await button(page, "Delete account");
      assert.notEqual(await deleteButton.getAttribute("aria-disabled"), "true", "Delete account: valid draft enables the guarded action");
      assert.equal(new URL(page.url()).pathname, "/settings/delete-account", "Delete account: checks never submit the deletion");
    },
  },
  {
    path: "/settings/display-name", title: "Display name",
    check: async (page) => {
      const field = page.getByLabel(/^Display name/).first();
      await field.waitFor({ state: "visible" });
      assert.equal(await field.inputValue(), user.displayName, "Display name: fixture name is prefilled");
      await field.click();
      await page.keyboard.press("End");
      await page.keyboard.type(" Updated");
      assert.equal(await field.inputValue(), `${user.displayName} Updated`, "Display name: editing keeps a live draft");
      assert.equal(await field.evaluate((node) => node === document.activeElement), true, "Display name: editing keeps focus");
    },
  },
  {
    path: "/settings/verify-email?email=new%40example.test&nonce=unified", title: "Verify new email",
    check: async (page) => {
      await page.getByLabel(/^Verification code, digit 1 of 6/).waitFor({ state: "visible" });
      await page.getByText("Verify new email", { exact: true }).first().waitFor({ state: "visible" });
      await button(page, "Verify");
      await button(page, "Resend code");
      assert.equal(new URL(page.url()).pathname, "/settings/verify-email", "Verify new email: checks never submit a fixture code");
    },
  },
];

const authRoutes = [
  {
    path: "/login", title: "Sign in", auth: true,
    check: async (page) => {
      await page.getByLabel(/^Email$/).waitFor({ state: "visible" });
      await assertDraftTyping(page, page.getByLabel(/^Password$/).first(), "loginPass123", "Login password");
      await button(page, "Sign in");
      await page.getByRole("link", { name: "Create account", exact: true }).waitFor({ state: "visible" });
      await page.getByRole("link", { name: "Forgot password?", exact: true }).waitFor({ state: "visible" });
      await button(page, "Change server");
      await button(page, "Use ordo Cloud");
      await page.getByText("Server: fixture.example.test", { exact: true }).waitFor({ state: "visible" });
      assert.equal(new URL(page.url()).pathname, "/login", "Login: checks never submit the fixture credentials");
    },
  },
  {
    path: "/register", title: "Create account", auth: true,
    check: async (page) => {
      await page.getByLabel(/^Display name$/).waitFor({ state: "visible" });
      await page.getByLabel(/^Email$/).waitFor({ state: "visible" });
      await assertDraftTyping(page, page.getByLabel(/^Password$/).first(), "registerPass123", "Register password");
      await assertDraftTyping(page, page.getByLabel(/^Confirm password$/).first(), "registerPass123", "Register confirmation");
      await button(page, "Create account");
      await page.getByRole("link", { name: "Sign in", exact: true }).waitFor({ state: "visible" });
      assert.equal(await page.getByText("This server isn't accepting new sign-ups.", { exact: true }).count(), 0,
        "Register: fixture server info enables registration");
      assert.equal(new URL(page.url()).pathname, "/register", "Register: checks never create the fixture account");
    },
  },
  {
    path: "/forgot-password", title: "Reset your password", auth: true,
    check: async (page) => {
      await page.getByLabel(/^Email$/).waitFor({ state: "visible" });
      await page.getByLabel(/^Email$/).fill("reader@example.test");
      await button(page, "Send reset code");
      await page.getByRole("link", { name: "Sign in", exact: true }).waitFor({ state: "visible" });
      assert.equal(new URL(page.url()).pathname, "/forgot-password", "Forgot password: checks never request the fixture code");
    },
  },
  {
    path: "/reset-password?email=reader%40example.test", title: "Enter your reset code", auth: true,
    check: async (page) => {
      await page.getByLabel(/^Reset code, digit 1 of 6/).waitFor({ state: "visible" });
      await button(page, "Continue");
      await button(page, "Resend code");
      await typeOtp(page, "Reset code", "123456");
      await pageHeading(page, "Choose a new password", { auth: true });
      const email = page.getByLabel(/^Email$/).first();
      assert.equal(await email.inputValue(), "reader@example.test", "Reset password: fixture email is carried through");
      await assertDraftTyping(page, page.getByLabel(/^New password$/).first(), "resetPass123", "Reset new password");
      await assertDraftTyping(page, page.getByLabel(/^Confirm new password$/).first(), "resetPass123", "Reset confirmation");
      await button(page, "Reset password");
      await button(page, "Use a different code").then((change) => change.click());
      await pageHeading(page, "Enter your reset code", { auth: true });
      assert.equal(new URL(page.url()).pathname, "/reset-password", "Reset password: checks never submit a new password");
    },
  },
  {
    path: "/mfa?challengeToken=fixture-challenge&email=reader%40example.test&emailRecovery=1", title: "Check your authenticator", auth: true,
    check: async (page) => {
      await page.getByLabel(/^Authenticator code, digit 1 of 6/).waitFor({ state: "visible" });
      await button(page, "Verify");
      await button(page, "Use a backup code").then((useBackup) => useBackup.click());
      await pageHeading(page, "Use a backup code", { auth: true });
      await page.getByLabel(/^Backup code, character 1 of 8/).waitFor({ state: "visible" });
      await button(page, "Use an authenticator code").then((useAuthenticator) => useAuthenticator.click());
      await pageHeading(page, "Check your authenticator", { auth: true });
      await button(page, "Email me a sign-in code").then((emailCode) => emailCode.click());
      await pageHeading(page, "Check your email", { auth: true });
      await page.getByLabel(/^Email sign-in code, digit 1 of 6/).waitFor({ state: "visible" });
      await page.getByText("This signs you in once. Your authenticator stays on.", { exact: true }).waitFor({ state: "visible" });
      assert.equal(new URL(page.url()).pathname, "/mfa", "MFA: fixture email recovery does not create a real session");
    },
  },
  {
    path: "/verify-email?email=reader%40example.test&sent=1", title: "Verify your email", auth: true,
    check: async (page) => {
      const email = page.getByLabel(/^Email$/).first();
      await email.waitFor({ state: "visible" });
      assert.equal(await email.inputValue(), "reader@example.test", "Verify email: fixture address is prefilled");
      await page.getByLabel(/^Verification code, digit 1 of 6/).waitFor({ state: "visible" });
      await button(page, "Verify");
      await button(page, "Resend code");
      const back = await page.getByRole("button", { name: "Back to sign in", exact: true }).last();
      await activateWithKeyboard(page, back, "Verify email Back to sign in");
      await page.waitForFunction(() => location.pathname === "/login", undefined, { timeout: 20000 });
      await pageHeading(page, "Sign in", { auth: true });
    },
  },
];

for (const route of authRoutes) route.back = false;

results.routeCount = settingsRoutes.length + authRoutes.length;
const configs = [];
for (const theme of matrix ? ["dark", "light"] : ["dark"]) {
  for (const expressive of matrix ? [true, false] : [true]) {
    for (const viewport of [{ width: 390, height: 844 }, { width: 1280, height: 800 }]) {
      configs.push({
        theme,
        expressive,
        viewport,
        mode: `${theme}-${expressive ? "expressive" : "standard"}-${viewport.width}x${viewport.height}`,
        capture: !matrix || (theme === "dark" && expressive),
      });
    }
  }
}

try {
  browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox"],
    ...(process.env.PLAYWRIGHT_CHROMIUM ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM } : {}),
  });

  for (const config of configs) {
    let context;
    try {
      context = await browser.newContext({ viewport: config.viewport, colorScheme: config.theme });
      const page = await context.newPage();
      page.setDefaultTimeout(20000);
      await installFixtures(page, { authenticated: true, ...config });
      results.configs.push({ mode: config.mode, theme: config.theme, expressive: config.expressive, viewport: config.viewport });
      for (const route of settingsRoutes) {
        await runRoute(page, config.mode, { ...route, capture: config.capture ? route.capture : null }, (target) =>
          route.check(target, config));
      }
      await checkAppearanceAndControls(page, config);
    } catch (error) {
      results.failures.push({ mode: config.mode, route: "settings-context", step: "context", message: String(error?.stack ?? error) });
      console.error(`[failure] ${config.mode} settings context: ${error?.message ?? error}`);
    } finally {
      await context?.close().catch(() => {});
    }

    currentRoute = "auth-context";
    context = null;
    try {
      context = await browser.newContext({ viewport: config.viewport, colorScheme: config.theme });
      const page = await context.newPage();
      page.setDefaultTimeout(20000);
      await installFixtures(page, { authenticated: false, ...config });
      for (const route of authRoutes) {
        await runRoute(page, config.mode, route, (target) => route.check(target));
      }
    } catch (error) {
      results.failures.push({ mode: config.mode, route: "auth-context", step: "context", message: String(error?.stack ?? error) });
      console.error(`[failure] ${config.mode} auth context: ${error?.message ?? error}`);
    } finally {
      await context?.close().catch(() => {});
    }
  }

  const postChecks = Object.keys(results.network).filter((key) => key.startsWith("POST "));
  assert.ok(postChecks.length > 0, "Fixture POSTs were intercepted (security setup and MFA email recovery)");
  assert.deepEqual(results.failures, [], "All unified settings and auth checks passed");
  console.log(JSON.stringify({
    baseUrl: base,
    matrix,
    routeCount: results.routeCount,
    configs: results.configs.length,
    settingsRoutes: settingsRoutes.length,
    authRoutes: authRoutes.length,
    routeChecks: results.routes.length,
    passed: results.routes.filter((route) => route.status === "passed").length,
    steps: results.steps.length,
    screenshots: results.screenshots,
    postEndpoints: postChecks,
    networkEndpoints: Object.keys(results.network).length,
    failures: results.failures,
  }, null, 2));
} finally {
  await writeFile(`${output}/results.json`, JSON.stringify(results, null, 2)).catch(() => {});
  await browser?.close().catch(() => {});
}
