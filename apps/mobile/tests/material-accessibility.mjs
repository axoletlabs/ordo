/** Regression tests for every actionable Material audit finding, on the built app. */
import assert from "node:assert/strict";
import { chooseClockTime } from "./reminder-clock-helpers.mjs";

export async function accessibilityMatrix({ browser, base, fixture, user, button, settle, capture, results }) {
  const field = (page, name) => page.getByRole("textbox", { name, exact: true });
  const target = async (locator) => {
    const rect = await locator.boundingBox(); assert.ok(rect && rect.width >= 48 && rect.height >= 48, `48dp target: ${await locator.getAttribute("aria-label")}`);
    return rect;
  };
  for (const theme of ["light", "dark"]) for (const expressive of [false, true]) {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: theme, reducedMotion: "reduce", locale: expressive ? "en-GB" : "en-US" });
    const mode = `${theme}-${expressive ? "expressive" : "standard"}-accessibility`;
    await context.addInitScript(({ theme, expressive }) => localStorage.setItem("ordo.settings", JSON.stringify({ themeMode: theme, expressive,
      serverUrl: "https://audit-server.example.test", materialYouColors: false, createButtonTapAction: "menu" })), { theme, expressive });
    const page = await context.newPage();
    await fixture(page);
    try {
      await page.goto(`${base}/register`);
      const email = field(page, "Email"); await email.waitFor();
      assert.equal(await email.getAttribute("aria-required"), "true");
      const description = await email.getAttribute("aria-describedby");
      assert.match(await page.locator(`[id="${description}"]`).innerText(), /Required/);
      await page.mouse.move(1, 1); await settle(page);
      const box = await email.evaluate(node => { const r = node.parentElement.getBoundingClientRect(); return { x: r.x, y: r.y, height: r.height }; });
      assert.equal(box.height, 56);
      await email.hover(); await page.getByTestId("material-field-hover").waitFor();
      await page.mouse.click(box.x + 2, box.y + box.height / 2);
      assert.equal(await email.evaluate(node => document.activeElement === node), true);
      await field(page, "Display name").fill("Alex"); await email.fill(user.email);
      await field(page, "Password").fill("Test-password-123"); await field(page, "Confirm password").fill("different");
      const heightBefore = await field(page, "Confirm password").evaluate(node => node.parentElement.parentElement.getBoundingClientRect().height);
      await button(page, "Create account").click(); await page.getByRole("alert").filter({ hasText: "Passwords don't match." }).waitFor();
      assert.equal(await field(page, "Confirm password").getAttribute("aria-invalid"), "true");
      await page.getByTestId("material-field-error-icon").waitFor();
      assert.equal(await field(page, "Confirm password").evaluate(node => node.parentElement.parentElement.getBoundingClientRect().height), heightBefore);
      for (const viewport of [{ name: "portrait", width: 390, height: 844 }, { name: "landscape", width: 1280, height: 800 }]) {
        await page.setViewportSize(viewport); await capture(page, `${mode}-${viewport.name}-field-error`);
      }
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto(`${base}/verify-email?email=alex%40example.test`);
      assert.deepEqual(await field(page, "Email").evaluate(node => ({ disabled: node.disabled, readOnly: node.readOnly })), { disabled: false, readOnly: true });
      await page.goto(`${base}/login`);
      await field(page, "Email").fill(user.email); await field(page, "Password").fill("Test-password-123");
      let release;
      const gate = new Promise(resolve => release = resolve);
      await page.route("**/api/auth/login", async route => { await gate; await route.fallback(); });
      const enabledColor = await field(page, "Email").evaluate(node => getComputedStyle(node).color);
      await button(page, "Sign in").click();
      await field(page, "Email").waitFor({ state: "visible" });
      await page.waitForFunction(() => document.querySelector('input[aria-label="Email"]')?.disabled === true);
      assert.notEqual(await field(page, "Email").evaluate(node => getComputedStyle(node).color), enabledColor);
      const arc = button(page, "Sign in").locator("svg circle, svg path").first();
      const stillArc = await arc.evaluate(node => getComputedStyle(node).strokeDasharray);
      await page.waitForTimeout(200);
      assert.equal(await arc.evaluate(node => getComputedStyle(node).strokeDasharray), stillArc);
      await page.emulateMedia({ reducedMotion: "no-preference" });
      await page.waitForTimeout(250);
      assert.notEqual(await arc.evaluate(node => getComputedStyle(node).strokeDasharray), stillArc, "Loading arc grows/shrinks when motion is enabled");
      await page.emulateMedia({ reducedMotion: "reduce" });
      release(); await button(page, "Account and settings").waitFor(); await settle(page);
      await target(button(page, "Library actions"));
      await target(button(page, "Show bookmarks tagged Design"));
      // Tooltips remain while focused; hover can transfer across the small gap.
      await button(page, "Library actions").focus(); await page.getByRole("tooltip").waitFor();
      await page.waitForTimeout(2200);
      assert.equal(await page.getByRole("tooltip").count(), 1);
      const tooltipId = await button(page, "Library actions").getAttribute("aria-describedby");
      assert.equal(await page.getByRole("tooltip").getAttribute("id"), tooltipId);
      await page.keyboard.press("Escape"); await page.getByRole("tooltip").waitFor({ state: "hidden" });
      await page.getByTestId("add-bookmark-fab").click(); await page.getByRole("menuitem", { name: "New folder", exact: true }).click();
      await field(page, "Name").fill("Ideas");
      const cancel = await target(button(page, "Cancel"));
      await page.mouse.click(cancel.x + cancel.width / 2, cancel.y + 2); await settle(page);
      assert.equal(await page.getByRole("dialog", { name: "New folder", exact: true }).count(), 0, "Wrapper-only button padding must activate");
      await page.getByTestId("add-bookmark-fab").click(); await page.getByRole("menuitem", { name: "New folder", exact: true }).click();
      await field(page, "Name").fill("Retained ideas");
      await page.getByRole("button", { name: /^Icon,/ }).click();
      const icons = page.getByRole("radiogroup", { name: "Folder icon", exact: true });
      const first = icons.getByRole("radio").first(); await first.focus();
      const before = await first.getAttribute("aria-label"); await page.keyboard.press("ArrowRight");
      assert.notEqual(await page.evaluate(() => document.activeElement?.getAttribute("aria-label")), before);
      assert.equal(await icons.getByRole("radio", { checked: true }).count(), 1);
      await page.keyboard.press("Escape"); await settle(page);
      assert.equal(await field(page, "Name").inputValue(), "Retained ideas");
      await page.keyboard.press("Escape"); await settle(page);
      await button(page, "Library actions").click(); await page.getByRole("menuitem", { name: "Manage tags", exact: true }).click();
      await button(page, "New tag").click();
      const colors = page.getByRole("radiogroup", { name: "Tag color", exact: true });
      await colors.getByRole("radio").first().focus(); await page.keyboard.press("ArrowRight");
      assert.equal(await colors.getByRole("radio").nth(1).getAttribute("aria-checked"), "true");
      await page.keyboard.press("Escape"); await settle(page);
      await button(page, "Back").click(); await settle(page);
      const article = page.getByRole("button", { name: /^Building a more expressive design system,/ });
      await article.click({ button: "right" }); await page.getByRole("menuitem", { name: "Remind", exact: true }).click();
      await page.getByRole("menuitem", { name: "Custom…", exact: true }).click();
      assert.equal(await page.getByRole("radiogroup", { name: "Day period", exact: true }).count(), expressive ? 0 : 1);
      await page.getByRole("radiogroup", { name: "Reminder date or time", exact: true }).getByRole("radio", { name: "Date", exact: true }).click();
      const days = page.getByRole("radiogroup", { name: "Reminder date", exact: true }); await days.waitFor();
      assert.ok(await days.getByRole("radio", { disabled: true }).count() > 0, "past dates must be inert");
      await days.getByRole("radio", { checked: true }).focus(); await page.keyboard.press("ArrowRight");
      await chooseClockTime(page, expressive ? 10 : 12, 35, !expressive);
      assert.equal(await button(page, "Remind").isEnabled(), true);
      await capture(page, `${mode}-portrait-reminder`);
      await page.setViewportSize({ width: 1280, height: 800 }); await settle(page);
      await capture(page, `${mode}-landscape-reminder`);
      await page.keyboard.press("Escape"); await settle(page);
      await page.keyboard.press("Escape"); await settle(page);
      await page.setViewportSize({ width: 390, height: 844 });
      await page.getByRole("button", { name: /^Design & inspiration,/ }).click({ button: "right" });
      await page.getByRole("menuitem", { name: "Lock folder", exact: true }).click();
      await page.getByRole("menuitem", { name: "Pattern", exact: true }).click();
      await button(page, "Use buttons to enter pattern").click();
      await page.getByRole("button", { name: /^Dot 1,/ }).click();
      await page.getByRole("button", { name: /^Dot 3,/ }).click();
      await page.getByRole("button", { name: /^Dot 9,/ }).click();
      await button(page, "Submit pattern").click(); await page.getByRole("dialog", { name: "Confirm pattern", exact: true }).waitFor();
      await button(page, "Use buttons to enter pattern").click(); await button(page, "Clear pattern").waitFor();
      await capture(page, `${mode}-pattern-buttons`);
      await page.keyboard.press("Escape"); await settle(page);
      await page.keyboard.press("Escape"); await settle(page);
      await button(page, "Account and settings").click(); await button(page, "Hosting").click();
      await page.getByRole("button", { name: /^Edit server,/ }).click();
      assert.equal(await field(page, "Name").evaluate(node => node.readOnly), true);
      await page.keyboard.press("Escape"); await settle(page);
      await context.setOffline(true);
      const offline = page.getByRole("alertdialog", { name: "You're offline. Connect to a network to use ordo.", exact: true }); await offline.waitFor(); await settle(page);
      assert.equal(await offline.evaluate(node => node.contains(document.activeElement)), true);
      await page.keyboard.press("Tab"); await page.keyboard.press("Enter");
      assert.equal(new URL(page.url()).pathname, "/settings/server");
      assert.equal(await page.getByRole("button", { name: "Back", exact: true }).count(), 0, "Background excluded from accessibility tree");
      await context.setOffline(false); await offline.waitFor({ state: "hidden" });
      assert.equal(await page.getByRole("button", { name: "Back", exact: true }).count(), 1);
      await page.emulateMedia({ reducedMotion: "no-preference" });
      await page.keyboard.press("Tab"); await settle(page);
      results.interactions.push(`${mode}: required/error/readonly/disabled fields, real targets, tooltips, selector keys, numeric time/date entry, accessible pattern, offline focus and reduced-motion switching`);
    } finally { await context.close(); }
  }
  // Processing progress reports actual values, including zero, rather than a fake sliver.
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: "reduce" });
  await context.addInitScript(() => localStorage.setItem("ordo.settings", JSON.stringify({ themeMode: "dark", expressive: false, serverUrl: "https://audit-server.example.test" })));
  const page = await context.newPage(); await fixture(page);
  let completed = 0;
  await page.route("**/api/bookmarks/extraction-progress", route => route.fulfill({ contentType: "application/json", headers: { "access-control-allow-origin": "*" },
    body: JSON.stringify({ pending: 4 - completed, total: 4, completed }) }));
  try {
    await page.goto(`${base}/login`); await field(page, "Email").fill(user.email); await field(page, "Password").fill("Test-password-123"); await button(page, "Sign in").click();
    const progress = page.getByTestId("material-linear-progress"); await progress.waitFor();
    assert.equal(await progress.getAttribute("aria-valuenow"), "0");
    assert.equal((await progress.boundingBox()).height, 4);
    assert.equal(await progress.evaluate(node => node.children.length), 2, "Zero has track and stop mark, but no active fill");
    completed = 2; await page.reload(); await progress.waitFor();
    await page.waitForFunction(() => document.querySelector('[data-testid="material-linear-progress"]')?.getAttribute("aria-valuenow") === "50");
    assert.equal(await progress.getAttribute("aria-valuenow"), "50");
    results.interactions.push("Processing progress: 0→50%, 4dp track, truthful zero fill and numeric semantics");
  } finally { await context.close(); }
}
