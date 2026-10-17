/** Real pointer-driven cold/warm overlay profiles, using synthetic UI fixtures.
 * Uses the same PLAYWRIGHT_*, ORDO_UI_URL/OUTPUT environment as ui-audit.mjs.
 * CPU profiles are diagnostic artifacts, not native frame-time measurements.
 */
import { writeFile } from "node:fs/promises";
process.env.ORDO_AUDIT_LIBRARY = "1";
const { browser, context, button, base, output } = await import("./ui-audit.mjs");
const samples = Number(process.env.ORDO_PROFILE_SAMPLES ?? 3);
const profiles = [];
try {
  for (let sample = 0; sample < samples; sample++) {
    const { page, context: ctx } = await context({ theme: "light", expressive: true });
    await page.goto(base);
    await button(page, "Save bookmark").first().waitFor();
    await page.locator('[data-testid="launch-splash"]').waitFor({ state: "hidden" });
    await page.waitForTimeout(800);
    const cdp = await ctx.newCDPSession(page);
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
    await cdp.send("Profiler.enable");
    await cdp.send("Profiler.setSamplingInterval", { interval: 500 });
    for (const kind of ["cold", "warm"]) {
      if (process.env.ORDO_PROFILE_TRACE === "1") await cdp.send("Tracing.start", {
        categories: "devtools.timeline,blink.user_timing,v8", transferMode: "ReturnAsStream",
      });
      await page.evaluate(() => {
        window.auditTasks = [];
        window.auditObserver = new PerformanceObserver((list) => window.auditTasks.push(...list.getEntries().map((entry) => entry.toJSON())));
        window.auditObserver.observe({ entryTypes: ["longtask"] });
      });
      await cdp.send("Profiler.start");
      const start = performance.now();
      await button(page, "Save bookmark").first().click();
      await page.getByRole("dialog").waitFor();
      await page.waitForTimeout(400);
      const { profile } = await cdp.send("Profiler.stop");
      if (process.env.ORDO_PROFILE_TRACE === "1") {
        const complete = new Promise((resolve) => cdp.once("Tracing.tracingComplete", resolve));
        await cdp.send("Tracing.end");
        const { stream } = await complete;
        let trace = "", eof = false;
        while (!eof) { const chunk = await cdp.send("IO.read", { handle: stream }); trace += chunk.data; eof = chunk.eof; }
        await cdp.send("IO.close", { handle: stream });
        await writeFile(`${output}/${sample}-${kind}.trace.json`, trace);
      }
      const tasks = await page.evaluate(() => { window.auditObserver.disconnect(); return window.auditTasks; });
      const result = { sample, kind, actionAndSettleMs: +(performance.now() - start).toFixed(1), tasks };
      profiles.push(result);
      await writeFile(`${output}/${sample}-${kind}.cpuprofile`, JSON.stringify(profile));
      await page.keyboard.press("Escape");
      await page.getByRole("dialog").waitFor({ state: "hidden" });
      await page.waitForTimeout(400);
    }
    await cdp.detach(); await ctx.close();
  }
} finally { await browser.close(); }
await writeFile(`${output}/dialog-profiles.json`, JSON.stringify(profiles, null, 2));
console.log(JSON.stringify(profiles.map(({ sample, kind, actionAndSettleMs, tasks }) => ({ sample, kind, actionAndSettleMs,
  longTasks: tasks.length, maxLongTaskMs: Math.max(0, ...tasks.map((task) => task.duration)),
})), null, 2));
