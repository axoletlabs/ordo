/** Built-app OTP regression matrix. API responses are fixtures.
 * ORDO_UI_URL=http://127.0.0.1:8246 PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs node tests/otp-input.mjs
 */
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? "playwright");
const base = process.env.ORDO_UI_URL ?? "http://127.0.0.1:8246";
const output = process.env.ORDO_UI_OUTPUT ?? "/tmp/opencode/ordo-otp-shots";
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM, args: ["--no-sandbox"] });
const results = [];
const errors = [];
try {
  for (const theme of process.env.ORDO_UI_THEME ? [process.env.ORDO_UI_THEME] : ["dark", "light"]) for (const expressive of process.env.ORDO_UI_EXPRESSIVE ? [process.env.ORDO_UI_EXPRESSIVE === "true"] : [false, true]) for (const reducedMotion of process.env.ORDO_UI_MOTION ? [process.env.ORDO_UI_MOTION] : ["reduce", "no-preference"]) {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: theme, reducedMotion, permissions: ["clipboard-read", "clipboard-write"] });
    await context.addInitScript(({ theme, expressive }) => localStorage.setItem("ordo.settings", JSON.stringify({ themeMode: theme, expressive,
      materialYouColors: false, serverUrl: "https://otp.example.test" })), { theme, expressive });
    const page = await context.newPage();
    page.on("pageerror", error => errors.push(error.message));
    const submissions = [];
    let release;
    let gate = null;
    await page.route("https://otp.example.test/**", async route => {
      const path = new URL(route.request().url()).pathname;
      let body = { success: true }, status = 200;
      if (path === "/api/server/info") body = { name: "ordo", version: "0.1.0", registrationEnabled: true, smtpConfigured: true, mfaRequired: false };
      if (path === "/api/auth/login/mfa" || path === "/api/auth/login/mfa/email/verify") {
        submissions.push(route.request().postDataJSON());
        if (gate) await gate;
        status = 400; body = { error: { code: "MFA_INVALID", message: "That code is incorrect. Try again." } };
      }
      await route.fulfill({ status, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify(body) });
    });
    const cells = () => page.getByRole("textbox", { name: /(?:digit|character) \d of \d/ });
    const code = () => cells().evaluateAll(nodes => nodes.map(node => node.value).join(""));
    const active = () => page.evaluate(() => document.activeElement?.getAttribute("aria-label"));
    const expectCode = async expected => {
      await page.waitForFunction(expected => [...document.querySelectorAll('input[aria-label*=" of "]')].map(node => node.value).join("") === expected, expected);
      assert.equal(await code(), expected);
    };
    const open = async () => {
      await page.goto(`${base}/mfa?challengeToken=fixture&emailRecovery=1`);
      await cells().first().waitFor(); await page.waitForTimeout(400);
    };
    try {
      await open();
      assert.equal(await cells().count(), 6);
      for (const viewport of [{ width: 390, height: 844 }, { width: 1280, height: 800 }]) {
        await page.setViewportSize(viewport);
        await cells().first().click(); await page.keyboard.type("1234", { delay: 30 });
        await expectCode("1234"); assert.match(await active(), /digit 5 of 6/);
        await cells().nth(2).click(); await page.keyboard.type("9");
        await expectCode("1294"); assert.match(await active(), /digit 4 of 6/);
        // A second tap on the already-focused field still replaces, never inserts.
        await cells().nth(3).click(); await page.keyboard.type("8"); await expectCode("1298");
        await cells().nth(2).click(); await cells().nth(2).click(); await page.keyboard.type("7"); await expectCode("1278");
        await cells().nth(1).click(); await page.keyboard.type("x"); await expectCode("1278");
        assert.match(await active(), /digit 2 of 6/);
        await page.keyboard.press("ArrowRight"); assert.match(await active(), /digit 3 of 6/);
        await page.keyboard.press("Home"); assert.match(await active(), /digit 1 of 6/);
        await page.keyboard.press("End"); assert.match(await active(), /digit 5 of 6/);
        await page.keyboard.press("Backspace"); await expectCode("127"); assert.match(await active(), /digit 4 of 6/);
        await page.keyboard.press("Backspace"); await expectCode("12");
        // Clicking ahead lands at the first empty cell, with no invisible holes.
        await cells().last().click(); assert.match(await active(), /digit 3 of 6/);
        await page.keyboard.press("Tab");
        assert.equal(await active(), "Use a backup code", "Tab escapes an incomplete code instead of looping through future cells");
        await page.keyboard.press("Shift+Tab"); assert.match(await active(), /digit 3 of 6/);
        await cells().nth(2).fill("98"); await expectCode("1298");
        await cells().nth(2).click();
        await page.waitForTimeout(400);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
        for (const rect of await cells().evaluateAll(nodes => nodes.map(node => ({ width: node.getBoundingClientRect().width, height: node.getBoundingClientRect().height })))) {
          assert.ok(rect.width >= 48 && rect.height >= 48, `cell target ${JSON.stringify(rect)}`);
        }
        await page.screenshot({ path: `${output}/${theme}-${expressive ? "expressive" : "standard"}-${reducedMotion}-${viewport.width === 390 ? "portrait" : "wide"}.png` });
        await open();
      }
      // Full formatted paste from the middle replaces the entire code and submits once.
      await cells().first().fill("1234");
      gate = new Promise(resolve => { release = resolve; });
      await cells().nth(2).click();
      await page.evaluate(() => navigator.clipboard.writeText("09 87-65"));
      await page.keyboard.press("Control+V");
      await page.waitForFunction(() => [...document.querySelectorAll('input[aria-label*=" of "]')].every(node => node.disabled));
      assert.equal(submissions.length, 1); assert.equal(submissions[0].code, "098765");
      release(); gate = null;
      await page.getByRole("alert").filter({ hasText: "That code is incorrect" }).waitFor();
      await page.waitForTimeout(500); assert.equal(submissions.length, 1, "failed codes must not resubmit themselves");
      assert.match(await active(), /digit 6 of 6/);
      await cells().nth(2).click(); await page.keyboard.type("4");
      await page.waitForTimeout(500);
      assert.equal(submissions.length, 2); assert.equal(submissions[1].code, "094765");
      assert.equal(await cells().first().getAttribute("aria-invalid"), "true");
      // Switching methods clears stale error state; restored full codes do not submit.
      await page.getByRole("button", { name: "Use a backup code", exact: true }).click();
      assert.equal(await cells().count(), 8);
      await cells().first().fill("AbCd");
      await cells().nth(1).click(); await page.keyboard.type("Z"); await expectCode("azcd");
      for (const viewport of [{ width: 390, height: 844 }, { width: 1280, height: 800 }]) {
        await page.setViewportSize(viewport); await page.waitForTimeout(400);
        for (const rect of await cells().evaluateAll(nodes => nodes.map(node => ({ width: node.getBoundingClientRect().width, height: node.getBoundingClientRect().height })))) {
          assert.ok(rect.width >= 48 && rect.height >= 48, `backup target ${JSON.stringify(rect)}`);
        }
        if (viewport.width === 390) {
          const first = await cells().first().boundingBox(), second = await cells().nth(4).boundingBox();
          const label = await page.getByText("Backup code", { exact: true }).boundingBox();
          assert.ok(first.y >= label.y + label.height + 4, "backup cells must not overlap their label");
          assert.ok(second.y - first.y - first.height >= 4 && second.y - first.y - first.height <= 12, "backup groups have one 8dp row gap");
        }
        await page.screenshot({ path: `${output}/${theme}-${expressive ? "expressive" : "standard"}-${reducedMotion}-backup-${viewport.width === 390 ? "portrait" : "wide"}.png` });
      }
      await cells().first().fill("AbCd-EF09"); await page.waitForTimeout(500);
      assert.equal(submissions.at(-1).code, "abcdef09");
      const count = submissions.length;
      await page.getByRole("button", { name: "Use an authenticator code", exact: true }).click();
      await page.waitForTimeout(500); assert.equal(submissions.length, count);
      await cells().nth(1).click(); await page.keyboard.type("1"); await page.waitForTimeout(500);
      assert.equal(submissions.length, count + 1, "editing a restored full code submits the corrected code");
      await page.getByRole("button", { name: "Email me a sign-in code", exact: true }).click();
      await cells().first().fill("012345"); await page.waitForTimeout(500);
      assert.equal(submissions.at(-1).token, "012345");
      results.push({ theme, expressive, reducedMotion, passed: true });
      console.log(`Passed ${theme}, expressive=${expressive}, motion=${reducedMotion}`);
    } catch (error) {
      await page.screenshot({ path: `${output}/failure.png` });
      console.error({ url: page.url(), code: await code(), active: await active(), submissions });
      throw error;
    } finally { release?.(); await context.close(); }
  }
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ passed: true, configurations: results.length, layoutChecks: results.length * 2, errors }, null, 2));
} finally {
  await writeFile(`${output}/results.json`, JSON.stringify({ results, errors }, null, 2));
  await browser.close();
}
