/** Account/server capability branches omitted by the default authenticated fixture. */
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
process.env.ORDO_AUDIT_LIBRARY = "1";
const { browser, context, screen, button, check, results, base, output } = await import("./ui-audit.mjs");
let page;
try {
  for (const theme of ["light", "dark"]) for (const expressive of [false, true]) for (const width of [320, 1280]) {
    const label = `${theme}-${expressive}-${width}`;
    const registration = await context({ theme, expressive, width, authenticated: false, serverState: { registrationEnabled: false } });
    page = registration.page;
    await page.goto(`${base}/register`);
    await page.getByText("This server isn't accepting new sign-ups.", { exact: true }).waitFor();
    check(await button(page, "Create account").count() === 0, `${label}: disabled registration has no submit action`);
    await screen(page, `${label}-registration-disabled`);
    await registration.context.close();

    const required = await context({ theme, expressive, width, serverState: { mfaRequired: true } }); page = required.page;
    await page.goto(base);
    await page.getByText("Protect your account", { exact: true }).waitFor();
    await page.waitForTimeout(350);
    check(await button(page, "Library actions").count() === 0, `${label}: required MFA cannot reveal library`);
    for (let tab = 0; tab < 8; tab++) await page.keyboard.press("Tab");
    check(await page.evaluate(() => !!document.activeElement?.closest('[data-material-overlay="true"]')), `${label}: required MFA owns keyboard focus`);
    await screen(page, `${label}-mfa-required`);
    await button(page, "Set up authenticator").click();
    await button(page, "Enlarge authenticator QR code").click();
    await screen(page, `${label}-mfa-required-qr`);
    await page.keyboard.press("Escape");
    await page.getByRole("dialog").waitFor({ state: "hidden" });
    check(await button(page, "Library actions").count() === 0, `${label}: closing QR does not release enrollment gate`);
    await required.context.close();

    const mfa = await context({ theme, expressive, width, authenticated: false, serverState: { smtpConfigured: false } }); page = mfa.page;
    await page.goto(`${base}/mfa?challengeToken=fixture&emailRecovery=1`);
    await button(page, "Use a backup code").click();
    await screen(page, `${label}-backup-code`);
    const cells = page.locator('input[aria-label^="Backup code"]');
    await cells.first().fill("AB12");
    await page.keyboard.press("ArrowLeft"); await page.keyboard.type("C");
    check(await cells.evaluateAll((inputs) => inputs.map((input) => input.value).join("")) === "ab1c", `${label}: backup-code keyboard replacement`);
    await button(page, "Use an authenticator code").click();
    await button(page, "Email me a sign-in code").click();
    await page.locator('input[aria-label^="Email sign-in code"]').first().waitFor();
    await screen(page, `${label}-mfa-console-recovery`);
    await mfa.context.close();

    const protectedFolder = await context({ theme, expressive, width, folderState: { protected: true, lockType: "device" } }); page = protectedFolder.page;
    await page.goto(base);
    await page.getByRole("button", { name: /^Design & inspiration,/ }).click();
    await page.getByText(/This device doesn't have the folder key|This device no longer has the folder key|Use device lock|Device unlock/).first().waitFor();
    await screen(page, `${label}-device-lock-web-unavailable`);
    await protectedFolder.context.close();
  }
  check(results.errors.length === 0, "no uncaught account/server-policy errors", results.errors);
} catch (error) {
  results.issues.push({ name: "execution", details: error.stack });
  if (page && !page.isClosed()) { await page.screenshot({ path: `${output}/failure.png` }); await writeFile(`${output}/failure.html`, await page.content()); }
} finally {
  await writeFile(`${output}/results.json`, JSON.stringify(results, null, 2));
  await browser.close();
}
console.log(JSON.stringify({ captures: results.screens.length, checks: results.checks.length, issues: results.issues, errors: results.errors }, null, 2));
assert.equal(results.issues.length, 0);
