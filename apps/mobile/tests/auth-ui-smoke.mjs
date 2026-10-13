/** Run against an exported Expo web build. API responses are fixtures, not backend verification.
 * ORDO_UI_URL=http://127.0.0.1:8235 node tests/auth-ui-smoke.mjs
 * Supports PLAYWRIGHT_MODULE, PLAYWRIGHT_CHROMIUM and ORDO_UI_OUTPUT like material-ui-smoke.mjs.
 */
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? "playwright");
const base = process.env.ORDO_UI_URL ?? "http://127.0.0.1:8235";
const output = process.env.ORDO_UI_OUTPUT ?? "/tmp/opencode/ordo-auth-ui";
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM, args: ["--no-sandbox"] });
const results = { screens: [], interactions: [], errors: [] };
const layouts = {
  portrait: { width: 390, height: 844 },
  wide: { width: 1280, height: 800 },
};
const field = (page, name) => page.getByRole("textbox", { name, exact: true });
const button = (page, name) => page.getByRole("button", { name, exact: true });

async function setup(viewport, theme, expressive, reducedMotion, settings = {}, scenario = {}) {
  const context = await browser.newContext({ viewport, colorScheme: theme, reducedMotion });
  await context.addInitScript(settings => localStorage.setItem("ordo.settings", JSON.stringify(settings)), {
    themeMode: theme, expressive, materialYouColors: false, ...settings,
  });
  const page = await context.newPage();
  const submissions = [];
  page.on("pageerror", error => results.errors.push(error.message));
  await page.route("**/*", async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin === new URL(base).origin) return route.continue();
    let status = 200;
    let body = { success: true };
    if (url.pathname === "/api/server/info") {
      body = { name: "ordo", registrationEnabled: scenario.registrationEnabled ?? true, smtpConfigured: true };
    } else if (["/api/auth/login", "/api/auth/register"].includes(url.pathname)) {
      submissions.push({ path: url.pathname, data: request.postDataJSON() });
      status = 401;
      body = { error: { code: "INVALID_CREDENTIALS", message: "Fixture sign-in error. Try again." } };
    }
    await route.fulfill({ status, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify(body) });
  });
  return { context, page, submissions };
}

async function open(page, route, action) {
  await page.goto(`${base}/${route}`);
  if (action) await button(page, action).waitFor();
  else await page.getByRole("heading").waitFor();
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(250);
}

async function capture(page, name) {
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${name}: horizontal overflow`);
  assert.ok(!(await page.locator("body").innerText()).includes("Something went wrong"), `${name}: error boundary`);
  await page.screenshot({ path: `${output}/${name}.png` });
  results.screens.push(name);
}

async function cleanForm(page, screen) {
  const fields = screen === "login" ? ["Email", "Password"] : ["Display name", "Email", "Password", "Confirm password"];
  const text = await page.locator("body").innerText();
  assert.ok(!text.includes("* Required"), "Auth forms do not repeat required hints");
  assert.ok(!text.includes("0/64"), "Display name does not need a character counter");
  for (const name of fields) {
    assert.equal(await field(page, name).getAttribute("aria-required"), "true", `${name}: required semantics retained`);
    const bounds = await field(page, name).boundingBox();
    assert.ok(bounds.width <= 480, `${name}: constrained form width`);
  }
  for (const control of await page.getByRole("button").or(page.getByRole("link")).all()) {
    // Inline legal links are part of the checkbox paragraph, not standalone targets.
    if (["Terms", "Privacy Policy"].includes(await control.getAttribute("aria-label"))) continue;
    const bounds = await control.boundingBox();
    if (bounds) assert.ok(bounds.height >= 48, "Actions retain a 48dp target");
  }
}

async function keyboardAndErrors(page, submissions, mode) {
  await field(page, "Email").focus();
  await field(page, "Email").fill("alex@example.test");
  await field(page, "Email").press("Enter");
  assert.equal(await field(page, "Password").evaluate(node => node === document.activeElement), true);
  await field(page, "Password").fill("test-password-123");
  await page.keyboard.press("Tab");
  assert.equal(await button(page, "Show password").evaluate(node => node === document.activeElement), true);
  await page.keyboard.press("Enter");
  assert.equal(await field(page, "Password").evaluate(node => node.type), "text");
  await button(page, "Hide password").click();
  assert.equal(await field(page, "Password").evaluate(node => node.type), "password");
  await field(page, "Password").press("Enter");
  await page.getByRole("alert").waitFor();
  assert.equal(await page.getByRole("alert").innerText(), "Fixture sign-in error. Try again.");
  assert.deepEqual(submissions.at(-1).data, { identifier: "alex@example.test", password: "test-password-123" });
  await page.getByRole("link", { name: "Create account", exact: true }).click();
  await button(page, "Create account").waitFor();
  for (const [name, value, next] of [
    ["Display name", "Alex", "Email"],
    ["Email", "alex@example.test", "Password"],
    ["Password", "test-password-123", "Confirm password"],
  ]) {
    await field(page, name).fill(value);
    await field(page, name).press("Enter");
    assert.equal(await field(page, next).evaluate(node => node === document.activeElement), true);
  }
  await field(page, "Confirm password").fill("different");
  await button(page, "Create account").click();
  await page.getByRole("alert").waitFor();
  assert.equal(await field(page, "Confirm password").getAttribute("aria-invalid"), "true");
  const describedBy = await field(page, "Confirm password").getAttribute("aria-describedby");
  assert.equal(await page.locator(`[id="${describedBy}"]`).innerText(), "Passwords don't match.");
  await capture(page, `${mode}-password-mismatch`);
  await field(page, "Confirm password").fill("test-password-123");
  await button(page, "Create account").click();
  await page.getByText("Please confirm you are 13 or older.", { exact: true }).waitFor();
  assert.equal(submissions.length, 1, "Consent validation prevents registration request");
  const consent = page.getByRole("checkbox");
  await consent.focus();
  await page.keyboard.press("Space");
  assert.equal(await consent.getAttribute("aria-checked"), "true");
  await button(page, "Create account").click();
  await page.getByRole("alert").waitFor();
  assert.equal(submissions.at(-1).path, "/api/auth/register");
  assert.deepEqual(submissions.at(-1).data, { displayName: "Alex", email: "alex@example.test", password: "test-password-123" });
  results.interactions.push(`${mode}: keyboard progression, visibility, server errors, password mismatch, consent and form submissions`);
}

try {
  for (const theme of ["light", "dark"]) for (const expressive of [false, true]) {
    for (const reducedMotion of ["no-preference", "reduce"]) for (const [layout, viewport] of Object.entries(layouts)) {
      const { context, page, submissions } = await setup(viewport, theme, expressive, reducedMotion);
      try {
        const mode = `${theme}-${expressive ? "expressive" : "standard"}-${reducedMotion}-${layout}`;
        for (const screen of ["login", "register"]) {
          await open(page, screen, screen === "login" ? "Sign in" : "Create account");
          await cleanForm(page, screen);
          const action = await button(page, screen === "login" ? "Sign in" : "Create account").boundingBox();
          assert.ok(action.y + action.height < viewport.height, `${mode}: primary action fits without scrolling`);
          await capture(page, `${mode}-${screen}`);
        }
        await open(page, "login", "Sign in");
        await keyboardAndErrors(page, submissions, mode);
      } finally { await context.close(); }
    }
  }

  for (const [layout, viewport] of Object.entries({ ...layouts, narrow: { width: 320, height: 568 }, keyboard: { width: 390, height: 400 } })) {
    const { context, page } = await setup(viewport, "dark", true, "reduce");
    try {
      for (const [route, action] of [["login", "Sign in"], ["register", "Create account"]]) {
        await open(page, route, action);
        await button(page, action).scrollIntoViewIfNeeded();
        const bounds = await button(page, action).boundingBox();
        assert.ok(bounds.y >= 0 && bounds.y + bounds.height <= viewport.height, "Primary action remains scrollable in a short viewport");
        await capture(page, `compact-${layout}-${route}`);
      }
      for (const route of ["forgot-password", "reset-password?email=alex%40example.test", "verify-email?email=alex%40example.test", "mfa?challengeToken=fixture&emailRecovery=1"]) {
        await open(page, route);
        await capture(page, `shared-shell-${layout}-${route.split("?")[0]}`);
      }
      await open(page, "forgot-password", "Send reset code");
      assert.ok((await page.locator("body").innerText()).includes("* Required"), "Other shared Input consumers retain required indicators by default");
    } finally { await context.close(); }
  }

  const { context, page } = await setup(layouts.portrait, "dark", true, "reduce", { serverUrl: "https://library.example.test" }, { registrationEnabled: false });
  try {
    await open(page, "register");
    await page.getByText("This server isn't accepting new sign-ups.", { exact: true }).waitFor();
    assert.equal(await button(page, "Create account").count(), 0);
    await capture(page, "registration-disabled");
    await open(page, "login", "Sign in");
    await page.getByText("Connected to library.example.test", { exact: true }).waitFor();
    await button(page, "Use ordo Cloud").click();
    await page.getByRole("dialog").waitFor();
    await capture(page, "self-host-cloud-confirmation");
    results.interactions.push("Self-host identity, Cloud confirmation and registration-disabled state preserved");
  } finally { await context.close(); }
  assert.deepEqual(results.errors, [], "No browser runtime errors");
  await writeFile(`${output}/results.json`, JSON.stringify(results, null, 2));
  console.log(JSON.stringify({ screens: results.screens.length, interactionScenarios: results.interactions.length, errors: results.errors.length, output }));
} finally { await browser.close(); }
