import assert from "node:assert/strict";
import { chooseClockTime, tapClock } from "./reminder-clock-helpers.mjs";

/** Tap-first reminder regression across themes, modes, and OS hour cycles. */
export async function reminderPickerMatrix({ browser, fixture, login, button, settle, capture, results }) {
  results.reminderMeasurements = [];
  for (const theme of ["dark", "light"]) for (const expressive of [false, true]) for (const hour12 of [true, false]) {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: theme,
      locale: hour12 ? "en-US" : "en-GB", reducedMotion: expressive === hour12 ? "reduce" : "no-preference" });
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
      const mode = `${theme}-${expressive ? "expressive" : "standard"}-${hour12 ? "12h" : "24h"}`;
      const dates = page.getByRole("radiogroup", { name: "Reminder date", exact: true });
      const measurement = { mode, initialCalendars: await dates.count(), clocks: await dialog.getByTestId("reminder-clock").count(),
        dialLabels: await dialog.getByTestId("reminder-clock").locator("text").count(), textboxes: await dialog.getByRole("textbox").count() };
      results.reminderMeasurements.push(measurement);
      assert.equal(measurement.initialCalendars, 0, "Opening mounts the clock, not both editing surfaces");
      assert.equal(measurement.clocks, 1);
      assert.equal(measurement.dialLabels, hour12 ? 12 : 24);
      assert.equal(measurement.textboxes, 0, "Opening a reminder must not require typing");
      const sections = dialog.getByRole("radiogroup", { name: "Reminder date or time", exact: true });
      await capture(page, `${mode}-portrait-clock-opening`);
      await sections.getByRole("radio", { name: "Date", exact: true }).evaluate(node => { window.reminderDateTab = node; });
      await page.mouse.move(0, 0);
      await sections.getByRole("radio", { name: "Time", exact: true }).focus(); await page.keyboard.press("ArrowLeft"); await settle(page);
      assert.ok(await sections.getByRole("radio", { name: "Date", exact: true }).evaluate(node => node === window.reminderDateTab), "Switching editing steps must not replace the focused tabs");
      assert.ok(await sections.getByRole("radio", { name: "Date", exact: true }).evaluate(node => node === document.activeElement), "Keyboard step navigation keeps focus on the selected tab");
      assert.equal(await dialog.getByTestId("reminder-clock").count(), 0, "Date editing does not mount time controls");
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
      await chooseClockTime(page, hour12 ? 21 : 9, 30, hour12);
      assert.equal(await button(page, "Remind").isEnabled(), true);
      await button(page, "Select hour").click();
      const hours = page.getByRole("slider", { name: "Reminder hour", exact: true });
      // Drag continuously across the face; auto-advance only on release.
      const dial = await hours.boundingBox();
      await page.mouse.move(dial.x + dial.width * 232 / 256, dial.y + dial.height / 2);
      await page.mouse.down();
      await page.mouse.move(dial.x + dial.width * 24 / 256, dial.y + dial.height / 2, { steps: 8 });
      await page.mouse.move(dial.x - 12, dial.y + dial.height / 2);
      assert.equal(await hours.count(), 1, "Dragging an hour must not switch to minutes mid-gesture");
      await page.mouse.up();
      await page.getByRole("slider", { name: "Reminder minute", exact: true }).waitFor();
      await button(page, "Select hour").click();
      assert.equal(await hours.getAttribute("aria-valuenow"), "9");
      await hours.focus(); await page.keyboard.press("ArrowRight");
      assert.equal(await hours.getAttribute("aria-valuenow"), "10");
      await page.keyboard.press("ArrowLeft");
      // 24-hour inner ring includes midnight, then return to the saved time.
      if (!hour12) {
        await tapClock(page, 0, { inner: true });
        await button(page, "Select hour").click();
        assert.equal(await hours.getAttribute("aria-valuenow"), "0");
        await tapClock(page, 11, { inner: true });
        await button(page, "Select hour").click();
        assert.equal(await hours.getAttribute("aria-valuenow"), "23");
        await tapClock(page, 9);
      }
      await button(page, "Select minute").click();
      const minutes = page.getByRole("slider", { name: "Reminder minute", exact: true });
      const selectedInk = await minutes.locator("text").filter({ hasText: /^30$/ }).getAttribute("fill");
      await minutes.focus(); await page.keyboard.press("ArrowRight");
      assert.equal(await minutes.getAttribute("aria-valuenow"), "31", "Keyboard editing retains exact minutes");
      assert.equal(await minutes.locator("text").filter({ hasText: /^30$/ }).getAttribute("fill"), selectedInk,
        "A numeral under an off-step minute selector must keep on-primary contrast");
      await page.keyboard.press("ArrowLeft");
      const minuteDial = await minutes.boundingBox();
      await page.mouse.move(minuteDial.x + minuteDial.width / 2, minuteDial.y + minuteDial.height * 232 / 256);
      await page.mouse.down();
      await page.mouse.move(minuteDial.x + minuteDial.width * (128 + Math.sin(31 / 60 * Math.PI * 2) * 104) / 256,
        minuteDial.y + minuteDial.height * (128 - Math.cos(31 / 60 * Math.PI * 2) * 104) / 256, { steps: 4 });
      await page.mouse.up();
      assert.equal(await minutes.getAttribute("aria-valuenow"), "31", "Dragging supports precise minutes without typing");
      await minutes.focus(); await page.keyboard.press("ArrowLeft");
      await capture(page, `${mode}-portrait-reminder`);
      await page.setViewportSize({ width: 1280, height: 800 }); await settle(page);
      await capture(page, `${mode}-landscape-reminder`);
      // Small/short windows scroll without losing the buttons or actions.
      await page.setViewportSize({ width: 360, height: 640 }); await settle(page);
      await tapClock(page, 55, { minute: true });
      const confirm = await button(page, "Remind").boundingBox();
      assert.ok(confirm.y >= 0 && confirm.y + confirm.height <= 640);
      await tapClock(page, 30, { minute: true });
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
        assert.equal(saved.remindAt, new Date(year, month - 1, day, hour12 ? 21 : 9, 30).getTime() / 1000);
        assert.equal(await button(page, "Remind").isDisabled(), true);
        assert.equal(await minutes.getAttribute("aria-disabled"), "true");
        await minutes.focus(); await page.keyboard.press("ArrowUp");
        assert.equal(await minutes.getAttribute("aria-valuenow"), "30", "Busy clock cannot change while saving");
        await page.keyboard.press("Escape"); await settle(page);
        assert.equal(await dialog.count(), 1, "Saving cannot dismiss the reminder");
      } finally { release(); }
      await dialog.waitFor({ state: "hidden" });
      await page.setViewportSize({ width: 390, height: 844 }); await settle(page);
      await article.click({ button: "right" }); await page.getByRole("menuitem", { name: "Remind", exact: true }).click();
      await page.getByRole("menuitem", { name: "Custom…", exact: true }).click(); await settle(page);
      assert.equal(await dialog.getByRole("textbox").count(), 0, "Reopening starts in tap-first mode");
      assert.equal(await dialog.getByTestId("reminder-clock").count(), 1, "Reopening resets the editing step to the clock");
      await sections.getByRole("radio", { name: "Date", exact: true }).click(); await settle(page);
      await page.evaluate(() => {
        window.reminderOffSurfaceFocus = [];
        document.addEventListener("focusin", event => {
          if (event.target.closest('[data-material-overlay="false"]')) window.reminderOffSurfaceFocus.push(event.target.getAttribute("aria-label"));
        });
      });
      await dates.getByRole("radio", { checked: true }).focus();
      await page.keyboard.press("ArrowRight"); await page.keyboard.press("Escape"); await settle(page);
      assert.deepEqual(await page.evaluate(() => window.reminderOffSurfaceFocus), [], "A pending date focus must not target the exiting panel after Back");
      results.interactions.push(`${mode}: date/calendar, clock hour/minute, 24h inner ring, precise keyboard minutes, short viewport, busy save, dismissal, reopen`);
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
