import assert from "node:assert/strict";

/** Tap-first reminder regression across themes, modes, and OS hour cycles. */
export async function reminderPickerMatrix({ browser, fixture, login, button, settle, capture, results }) {
  results.reminderMeasurements = [];
  for (const theme of ["dark", "light"]) for (const expressive of [false, true]) {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: theme,
      locale: expressive ? "en-GB" : "en-US", reducedMotion: expressive ? "reduce" : "no-preference" });
    await context.addInitScript(({ theme, expressive }) => localStorage.setItem("ordo.settings", JSON.stringify({ themeMode: theme, expressive, materialYouColors: false })), { theme, expressive });
    const page = await context.newPage();
    try {
      await page.clock.setFixedTime(new Date("2026-10-15T12:00:00"));
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
      const measurement = { mode, portraitCalendar: await dates.count(), hourButtons: await hours.getByRole("radio").count(),
        minuteButtons: await minutes.getByRole("radio").count(), textboxes: await dialog.getByRole("textbox").count() };
      results.reminderMeasurements.push(measurement);
      assert.equal(measurement.portraitCalendar, 1);
      assert.equal(measurement.hourButtons, expressive ? 24 : 12);
      assert.equal(measurement.minuteButtons, 12);
      assert.equal(measurement.textboxes, 0, "Opening a reminder must not require typing");
      assert.equal(await dates.getByTestId("material-state-layer").count(), 0, "Untouched dates must not mount invisible feedback views");
      const panel = await dialog.boundingBox();
      for (const target of await dates.getByRole("radio").all()) {
        const rect = await target.boundingBox();
        assert.ok(rect.width >= 48 && rect.height >= 48);
        assert.ok(rect.x >= panel.x && rect.x + rect.width <= panel.x + panel.width, "Seven dates fit on a 390dp phone");
      }
      assert.ok(await dates.getByRole("radio", { disabled: true }).count() > 0, "Past dates are not tappable");
      const today = dates.locator('[data-calendar-date="2026-10-15"]');
      const otherDate = dates.locator('[data-calendar-date="2026-10-24"]');
      // Exercise the transition that used to reveal a square native background:
      // an ordinary (flattened) date becomes selected, unlike today's bordered view.
      await today.click();
      assert.equal(await today.getByTestId("material-state-layer").count(), 1, "A date mounts feedback on first interaction");
      await assertDateCircle(today, true, false);
      assert.equal(await dates.locator("svg").count(), 1, "Ordinary dates must not mount invisible SVG trees");
      for (let attempt = 0; attempt < 2; attempt++) {
        await otherDate.click();
        await assertDateCircle(otherDate, true, false);
        await assertDateCircle(today, false, true);
        assert.equal(await dates.locator("svg").count(), 2, "Only today and the selected date need painted circles");
        if (attempt === 0) await today.click();
      }
      measurement.selectedDateCircle = await otherDate.locator("circle").count();
      measurement.todayOutlineCircle = await today.locator("circle").count();
      await page.mouse.move(0, 0); await settle(page);
      await capture(page, `${mode}-portrait-reminder-date`);
      await page.setViewportSize({ width: 1280, height: 800 }); await settle(page);
      await assertDateCircle(otherDate, true, false);
      await capture(page, `${mode}-landscape-reminder-date`);
      await page.setViewportSize({ width: 390, height: 844 }); await settle(page);
      await button(page, "Next month").click();
      await dates.getByRole("radio").last().click();
      const selected = dates.getByRole("radio", { checked: true });
      await assertDateCircle(selected, true, false);
      await selected.focus(); await page.keyboard.press("ArrowLeft");
      await assertDateCircle(dates.getByRole("radio", { checked: true }), true, false);
      const finalDate = await dates.getByRole("radio", { checked: true }).getAttribute("data-calendar-date");
      await hours.getByRole("radio", { name: "9 o'clock", exact: true }).click();
      await minutes.getByRole("radio", { name: "30 minutes", exact: true }).click();
      if (!expressive) await page.getByRole("radiogroup", { name: "Day period", exact: true }).getByRole("radio", { name: "PM", exact: true }).click();
      assert.equal(await button(page, "Remind").isEnabled(), true);
      await hours.getByRole("radio", { checked: true }).focus(); await page.keyboard.press("ArrowRight");
      assert.equal(await hours.getByRole("radio", { name: "10 o'clock", exact: true }).getAttribute("aria-checked"), "true");
      await hours.getByRole("radio", { name: "9 o'clock", exact: true }).click();
      await capture(page, `${mode}-portrait-reminder`);
      await page.setViewportSize({ width: 1280, height: 800 }); await settle(page);
      await capture(page, `${mode}-landscape-reminder`);
      // Small/short windows scroll without losing the buttons or actions.
      await page.setViewportSize({ width: 360, height: 640 }); await settle(page);
      await minutes.getByRole("radio").last().click();
      const lastMinute = await minutes.getByRole("radio").last().boundingBox();
      assert.ok(lastMinute.y >= 0 && lastMinute.y + lastMinute.height <= 640);
      const confirm = await button(page, "Remind").boundingBox();
      assert.ok(confirm.y >= 0 && confirm.y + confirm.height <= 640);
      await minutes.getByRole("radio", { name: "30 minutes", exact: true }).click();
      // A slow save keeps the dialog busy: controls lock, back cannot dismiss.
      const [year, month, day] = finalDate.split("-").map(Number);
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
        assert.equal(saved.remindAt, new Date(year, month - 1, day, expressive ? 9 : 21, 30).getTime() / 1000);
        assert.equal(await button(page, "Remind").isDisabled(), true);
        assert.equal(await dates.getByRole("radio", { checked: true }).getAttribute("aria-disabled"), "true");
        assert.equal(await hours.getByRole("radio", { checked: true }).getAttribute("aria-disabled"), "true");
        await page.keyboard.press("Escape"); await settle(page);
        assert.equal(await dialog.count(), 1, "Saving cannot dismiss the reminder");
      } finally { release(); }
      await dialog.waitFor({ state: "hidden" });
      await page.setViewportSize({ width: 390, height: 844 }); await settle(page);
      await article.click({ button: "right" }); await page.getByRole("menuitem", { name: "Remind", exact: true }).click();
      await page.getByRole("menuitem", { name: "Custom…", exact: true }).click(); await settle(page);
      assert.equal(await dialog.getByRole("textbox").count(), 0, "Reopening starts in tap-first mode");
      results.interactions.push(`${mode}: tap date/hour/minute, keyboard selection, short viewport, busy save, dismissal, reopen`);
    } finally { await context.close(); }
  }
}

async function assertDateCircle(date, selected, outlined) {
  assert.equal(await date.getAttribute("aria-checked"), String(selected));
  const geometry = await date.evaluate(node => {
    const svg = node.querySelector("svg"), circle = svg?.querySelector("circle");
    if (!circle) return null;
    const bounds = svg.getBoundingClientRect();
    return { width: bounds.width, height: bounds.height, cx: circle.getAttribute("cx"), cy: circle.getAttribute("cy"),
      r: circle.getAttribute("r"), fill: circle.getAttribute("fill"), stroke: circle.getAttribute("stroke"),
      background: getComputedStyle(svg.parentElement).backgroundColor };
  });
  assert.ok(geometry, "Dates paint an explicit circle, not a border-radius-dependent native background");
  assert.equal(geometry.width, 40);
  assert.equal(geometry.height, 40);
  assert.equal(geometry.cx, "20");
  assert.equal(geometry.cy, "20");
  assert.equal(geometry.r, outlined ? "19.5" : "20");
  assert.equal(geometry.fill !== "none", selected);
  assert.equal(geometry.stroke !== "none", outlined);
  assert.equal(geometry.background, "rgba(0, 0, 0, 0)", "The circle must not sit above a square selection fill");
}
