import assert from "node:assert/strict";

/** Release-web proxy for shared JS work, not native frame-rate measurement.
 * ORDO_UI_REMINDER_PERF_ONLY=1 [ORDO_REMINDER_PROFILE=1] node tests/material-ui-smoke.mjs
 * Run without a concurrent build; compare the same Chromium binary/host.
 * ORDO_REMINDER_MAX_OPEN_MS optionally enforces a controlled-runner budget.
 */
export async function reminderOpeningPerformance({ browser, fixture, login, settle, results, output }) {
  const { writeFile } = await import("node:fs/promises");
  results.reminderOpening = [];
  for (const expressive of [false, true]) for (let run = 0; run < 3; run++) {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: "dark",
      locale: expressive ? "en-GB" : "en-US" });
    await context.addInitScript(({ expressive }) => {
      localStorage.setItem("ordo.settings", JSON.stringify({ themeMode: "dark", expressive, materialYouColors: false }));
      // Fix Date only. Playwright's clock also instruments every timer/RAF,
      // distorting profiles of a dialog with many animated controls.
      const NativeDate = Date;
      const fixed = new NativeDate("2026-10-15T12:00:00").getTime();
      window.Date = new Proxy(NativeDate, {
        apply: () => new NativeDate(fixed).toString(),
        construct: (target, args) => Reflect.construct(target, args.length ? args : [fixed]),
        get: (target, key) => key === "now" ? () => fixed : Reflect.get(target, key),
      });
      const original = Date.prototype.toLocaleDateString;
      window.reminderDateFormats = 0;
      Date.prototype.toLocaleDateString = function (...args) { window.reminderDateFormats++; return original.apply(this, args); };
    }, { expressive });
    try {
        const page = await context.newPage();
        await fixture(page); await login(page); await settle(page);
        const cdp = await context.newCDPSession(page);
        await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
        await cdp.send("Performance.enable");
        for (const opening of ["cold", "reopen"]) {
          if (opening === "cold") {
            await page.getByRole("button", { name: /^Building a more expressive design system,/ }).click({ button: "right" });
            await page.getByRole("menuitem", { name: "Remind", exact: true }).click();
          }
          const custom = page.getByRole("menuitem", { name: "Custom…", exact: true });
          await custom.waitFor(); await settle(page);
          const metricStart = Object.fromEntries((await cdp.send("Performance.getMetrics")).metrics.map(({ name, value }) => [name, value]));
          const profile = process.env.ORDO_REMINDER_PROFILE && run === 0 && opening === "cold";
          if (profile) { await cdp.send("Profiler.enable"); await cdp.send("Profiler.start"); }
          await page.evaluate(() => {
            const sample = { tasks: [], gaps: [], last: performance.now(), start: null, firstContentMs: null, frame: 0 };
            const observer = new PerformanceObserver(list => sample.tasks.push(...list.getEntries().map(entry => entry.duration)));
            observer.observe({ entryTypes: ["longtask"] });
            const frame = time => {
              if (sample.start != null) {
                sample.gaps.push(time - sample.last);
                if (sample.firstContentMs == null && document.querySelector('[data-testid="reminder-clock"] svg, [role="radiogroup"][aria-label="Reminder date"]')) sample.firstContentMs = performance.now() - sample.start;
              }
              sample.last = time; sample.frame = requestAnimationFrame(frame);
            };
            sample.frame = requestAnimationFrame(frame);
            window.reminderSample = { sample, observer };
          });
          // Dispatch the real action without Playwright's repeated hit-test work
          // inside the measured window. Pointer/keyboard behavior has its own matrix.
          await custom.evaluate(node => {
            window.reminderDateFormats = 0;
            window.reminderSample.sample.start = performance.now();
            window.reminderSample.sample.last = performance.now();
            node.click();
          });
          const dialog = page.getByRole("dialog", { name: "Custom reminder", exact: true });
          await dialog.waitFor(); await page.waitForTimeout(700);
          const measured = await page.evaluate(() => {
            const { sample, observer } = window.reminderSample;
            cancelAnimationFrame(sample.frame); observer.disconnect();
            const dialog = document.querySelector('[role="dialog"][aria-modal="true"]');
            return { firstContentMs: sample.firstContentMs, maxTaskMs: Math.max(0, ...sample.tasks),
              totalLongTaskMs: sample.tasks.reduce((a, b) => a + b, 0), maxFrameGapMs: Math.max(0, ...sample.gaps),
              dateFormats: window.reminderDateFormats, dialogNodes: dialog?.querySelectorAll("*").length,
              controls: dialog?.querySelectorAll('[role="button"], [role="radio"], [role="slider"]').length };
          });
          const metricEnd = Object.fromEntries((await cdp.send("Performance.getMetrics")).metrics.map(({ name, value }) => [name, value]));
          if (profile) await writeFile(`${output}/reminder-profile-${expressive}.json`, JSON.stringify((await cdp.send("Profiler.stop")).profile));
          assert.ok(measured.firstContentMs > 0);
          if (process.env.ORDO_REMINDER_MAX_OPEN_MS) assert.ok(measured.firstContentMs < Number(process.env.ORDO_REMINDER_MAX_OPEN_MS),
            `Custom reminder took ${measured.firstContentMs}ms to show content`);
          if (await dialog.getByTestId("reminder-clock").count()) {
            assert.equal(await dialog.getByRole("slider", { name: "Reminder hour", exact: true }).count(), 1);
            assert.equal(await dialog.getByRole("radiogroup", { name: "Reminder date", exact: true }).count(), 0);
            // A lighter first step must not just move the whole stall to Date.
            for (const [section, selector, key] of [["Date", '[role="radiogroup"][aria-label="Reminder date"]', "dateStepMs"],
              ["Time", '[data-testid="reminder-clock"] svg', "timeStepMs"]]) {
              await page.evaluate(selector => {
                const state = { start: null };
                const promise = new Promise(resolve => {
                  const frame = () => {
                    if (state.start != null && document.querySelector(selector)) resolve(performance.now() - state.start);
                    else requestAnimationFrame(frame);
                  };
                  requestAnimationFrame(frame);
                });
                window.reminderStep = { state, promise };
              }, selector);
              await dialog.getByRole("radiogroup", { name: "Reminder date or time", exact: true }).getByRole("radio", { name: section, exact: true })
                .evaluate(node => { window.reminderStep.state.start = performance.now(); node.click(); });
              await page.locator(selector).waitFor();
              measured[key] = await page.evaluate(() => window.reminderStep.promise);
              await settle(page);
            }
          } else assert.equal(await dialog.getByRole("radiogroup", { name: "Reminder hour", exact: true }).getByRole("radio").count(), expressive ? 24 : 12);
          results.reminderOpening.push({ expressive, opening, run, ...measured,
            scriptMs: (metricEnd.ScriptDuration - metricStart.ScriptDuration) * 1000,
            taskMs: (metricEnd.TaskDuration - metricStart.TaskDuration) * 1000 });
          await page.keyboard.press("Escape"); await dialog.waitFor({ state: "hidden" }); await settle(page);
        }
        await page.close();
    } finally { await context.close(); }
  }
  const median = values => values.sort((a, b) => a - b)[Math.floor(values.length / 2)];
  results.reminderOpeningMedians = [false, true].flatMap(expressive => ["cold", "reopen"].map(opening => {
    const samples = results.reminderOpening.filter(item => item.expressive === expressive && item.opening === opening);
    return { expressive, opening, ...Object.fromEntries(["firstContentMs", "maxTaskMs", "totalLongTaskMs", "maxFrameGapMs", "dateFormats", "dialogNodes", "controls", "dateStepMs", "timeStepMs", "scriptMs", "taskMs"]
      .filter(key => samples.every(item => Number.isFinite(item[key])))
      .map(key => [key, Math.round(median(samples.map(item => item[key])) * 100) / 100])) };
  }));
  console.log(JSON.stringify(results.reminderOpeningMedians, null, 2));
}
