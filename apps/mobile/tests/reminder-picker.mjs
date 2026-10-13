import assert from "node:assert/strict";

/** Tap-first reminder regression, including typed precision and OS hour cycles. */
export async function reminderPickerMatrix({ browser, fixture, login, button, settle, capture, results }) {
  const baseline = process.env.ORDO_UI_REMINDER_BASELINE === "1";
  results.reminderMeasurements = [];
  for (const theme of ["dark", "light"]) for (const expressive of [false, true]) {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: theme,
      locale: expressive ? "en-GB" : "en-US", reducedMotion: expressive ? "reduce" : "no-preference" });
    await context.addInitScript(({ theme, expressive }) => localStorage.setItem("ordo.settings", JSON.stringify({ themeMode: theme, expressive, materialYouColors: false })), { theme, expressive });
    const page = await context.newPage();
    try {
      await fixture(page); await login(page); await settle(page);
      const article = page.getByRole("button", { name: /^Building a more expressive design system,/ });
      await article.click({ button: "right" });
      await page.getByRole("menuitem", { name: "Remind", exact: true }).click();
      await page.getByRole("menuitem", { name: "Custom…", exact: true }).click();
      const dialog = page.getByRole("dialog", { name: "Custom reminder", exact: true });
      await dialog.waitFor(); await settle(page);
      const mode = `${theme}-${expressive ? "expressive" : "standard"}`;
      const dates = page.getByRole("radiogroup", { name: "Reminder date", exact: true });
      const hours = page.getByRole("radiogroup", { name: "Reminder hour", exact: true });
      const minutes = page.getByRole("radiogroup", { name: "Reminder minute", exact: true });
      const measurement = { mode, portraitCalendar: await dates.count(), hourButtons: await hours.getByRole("radio").count(), minuteButtons: await minutes.getByRole("radio").count() };
      results.reminderMeasurements.push(measurement);
      if (baseline) {
        await capture(page, `${mode}-portrait-reminder`);
        await page.setViewportSize({ width: 1280, height: 800 });
        await capture(page, `${mode}-landscape-reminder`);
        continue;
      }
      assert.equal(measurement.portraitCalendar, 1);
      assert.equal(measurement.hourButtons, expressive ? 24 : 12);
      assert.equal(measurement.minuteButtons, 12);
      assert.equal(await dialog.getByRole("textbox").count(), 0, "Opening a reminder must not require typing");
      for (const target of await dates.getByRole("radio").all()) {
        const rect = await target.boundingBox();
        assert.ok(rect.width >= 48 && rect.height >= 48);
        const panel = await dialog.boundingBox();
        assert.ok(rect.x >= panel.x && rect.x + rect.width <= panel.x + panel.width, "Seven dates fit on a 390dp phone");
      }
      await button(page, "Next month").click();
      await dates.getByRole("radio").filter({ hasNot: page.locator('[aria-disabled="true"]') }).last().click();
      const selected = dates.getByRole("radio", { checked: true });
      const chosen = await selected.getAttribute("aria-label");
      await selected.focus(); await page.keyboard.press("ArrowLeft");
      assert.notEqual(await dates.getByRole("radio", { checked: true }).getAttribute("aria-label"), chosen);
      await hours.getByRole("radio").nth(8).click();
      await minutes.getByRole("radio", { name: "30 minutes", exact: true }).click();
      assert.equal(await button(page, "Remind").isEnabled(), true);
      await hours.getByRole("radio", { checked: true }).focus(); await page.keyboard.press("ArrowRight");
      assert.equal(await hours.getByRole("radio").nth(9).getAttribute("aria-checked"), "true");
      await button(page, "Enter time").click();
      const hour = page.getByRole("textbox", { name: "Reminder hour", exact: true });
      const minute = page.getByRole("textbox", { name: "Reminder minute", exact: true });
      await hour.fill(expressive ? "23" : "12"); await minute.fill("07");
      await minute.fill("60"); assert.equal(await button(page, "Remind").isDisabled(), true);
      await minute.fill("07"); assert.equal(await button(page, "Remind").isEnabled(), true);
      await button(page, "Show time buttons").click();
      await button(page, "Enter time").click();
      assert.equal(await minute.inputValue(), "07", "Switching modes preserves exact minutes");
      await button(page, "Show time buttons").click();
      await button(page, "Enter date").click();
      const date = page.getByRole("textbox", { name: "Reminder date", exact: true });
      await date.fill("2100-02-31"); assert.equal(await button(page, "Remind").isDisabled(), true);
      await date.fill("2099-10-12"); await button(page, "Show calendar").click();
      assert.equal(await dates.getByRole("radio", { checked: true }).count(), 1);
      assert.equal(await button(page, "Remind").isEnabled(), true);
      await minutes.getByRole("radio", { name: "30 minutes", exact: true }).click();
      // Capture identical draft and scroll position in both required layouts.
      await button(page, "Enter date").scrollIntoViewIfNeeded();
      await capture(page, `${mode}-portrait-reminder`);
      await page.setViewportSize({ width: 1280, height: 800 }); await settle(page);
      await capture(page, `${mode}-landscape-reminder`);
      // Small/short windows scroll without losing the calendar or actions.
      await page.setViewportSize({ width: 360, height: 640 }); await settle(page);
      await minutes.getByRole("radio").last().click();
      const lastMinute = await minutes.getByRole("radio").last().boundingBox();
      assert.ok(lastMinute.y >= 0 && lastMinute.y + lastMinute.height <= 640);
      const confirm = await button(page, "Remind").boundingBox();
      assert.ok(confirm.y >= 0 && confirm.y + confirm.height <= 640);
      await page.keyboard.press("Escape"); await settle(page);
      assert.equal(await page.getByRole("dialog", { name: "Custom reminder", exact: true }).count(), 0);
      await page.keyboard.press("Escape"); await settle(page);
      await article.click({ button: "right" }); await page.getByRole("menuitem", { name: "Remind", exact: true }).click();
      await page.getByRole("menuitem", { name: "Custom…", exact: true }).click(); await settle(page);
      assert.equal(await dialog.getByRole("textbox").count(), 0, "Reopening starts in tap-first mode");
      await button(page, "Enter date").click(); await date.fill("2099-10-12"); await button(page, "Show calendar").click();
      await hours.getByRole("radio", { name: "9 o'clock", exact: true }).click();
      await minutes.getByRole("radio", { name: "30 minutes", exact: true }).click();
      if (!expressive) await page.getByRole("radiogroup", { name: "Day period", exact: true }).getByRole("radio", { name: "PM", exact: true }).click();
      let release;
      const gate = new Promise(resolve => { release = resolve; });
      let saved;
      await page.route("**/api/bookmarks/article", async route => {
        if (route.request().method() === "PATCH") {
          saved = route.request().postDataJSON();
          await gate;
        }
        await route.fallback();
      });
      try {
        await button(page, "Remind").click(); await settle(page);
        assert.equal(saved.remindAt, new Date(2099, 9, 12, expressive ? 9 : 21, 30).getTime() / 1000);
        assert.equal(await button(page, "Remind").isDisabled(), true);
        assert.equal(await dates.getByRole("radio", { checked: true }).getAttribute("aria-disabled"), "true");
        assert.equal(await hours.getByRole("radio", { checked: true }).getAttribute("aria-disabled"), "true");
        await page.keyboard.press("Escape"); assert.equal(await dialog.count(), 1, "Saving cannot dismiss the reminder");
      } finally { release(); }
      await dialog.waitFor({ state: "hidden" });
      results.interactions.push(`${mode}: tap date/hour/minute, keyboard selection, precision entry, invalid input, resize, dismissal, reopen`);
    } finally { await context.close(); }
  }
}
