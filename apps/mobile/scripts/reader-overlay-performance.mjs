/** Release-web reader opening benchmark, including the complete animation.
 * Serve an Expo export, then set ORDO_UI_URL and PLAYWRIGHT_MODULE.
 * ORDO_UI_CPU=1|4, ORDO_UI_REPEATS=5, ORDO_UI_READY_WAIT=700.
 * Optional median gates: ORDO_UI_MAX_HALF_OPAQUE_MS, _ENTRANCE_FRAME_MS,
 * _LONGTASK_TOTAL_MS (each sample must also stay within 1.5x its median gate).
 * ORDO_UI_BASELINE rejects median regressions beyond both 15% and 30 ms.
 * This measures browser response, not native-device frame pacing.
 */
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? "playwright");
const base = process.env.ORDO_UI_URL ?? "http://127.0.0.1:8361";
const output = process.env.ORDO_UI_OUTPUT ?? "/tmp/opencode/ordo-reader-overlay-performance";
const repeats = Number(process.env.ORDO_UI_REPEATS ?? 5);
const cpu = Number(process.env.ORDO_UI_CPU ?? 4);
const readyWait = Number(process.env.ORDO_UI_READY_WAIT ?? 700);
const sampleWindow = 1500;
const viewport = process.env.ORDO_UI_WIDE === "1" ? { width: 1280, height: 800 } : { width: 390, height: 844 };
const touch = viewport.width < 768;
const stamp = "2026-10-20T12:00:00Z";
const count = 1000;
const tag = { id: "design", name: "Design", color: "blue", bookmarkCount: count, createdAt: stamp, updatedAt: stamp };
const article = { id: "article", folderId: null, title: "Performance audit article", url: "https://example.test/article",
  domain: "example.test", description: "A saved article for interaction checks.", fetchStatus: "ok", contentKind: "article",
  contentKindOverride: null, extractionVersion: 1, author: null, publishedAt: null, readingTimeMinutes: 4,
  readProgress: 0, isRead: false, remindAt: null, tags: [tag], suggestedTags: [], createdAt: stamp, updatedAt: stamp };
const user = { id: "performance-fixture", displayName: "Fixture reader", email: "reader@example.test", emailVerified: true,
  hasAvatar: false, mfaEnabled: false, libraryEncrypted: false, canRenameInstance: false, createdAt: stamp,
  preferences: { fontFamily: "sans", fontSize: "medium", lineSpacing: "default", theme: "system", amoled: false } };
const contentHtml = Array.from({ length: 100 }, (_, i) => `<h2>Section ${i + 1}</h2><p>${"An article should remain responsive while opening its controls. ".repeat(12)}</p>`).join("");
const button = (page, name) => page.getByRole("button", { name, exact: true });
const results = { measurementVersion: 2, fixtureBookmarks: count, fixtureSections: 100, cpuThrottle: cpu, readyWaitMs: readyWait,
  sampleWindowMs: sampleWindow, viewport, samples: [], errors: [] };
const metrics = ["inputDelayMs", "firstVisibleMs", "halfOpaqueMs", "opaqueMs", "settledMs", "maxEntranceFrameMs", "maxLongTaskMs", "longTaskTotalMs"];
const median = values => {
  const sorted = values.toSorted((a, b) => a - b), middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};
function summarize(data) {
  return ["overflow", "settings"].flatMap(kind => ["cold", "warm"].map(temperature => {
    const samples = data.samples.filter(sample => sample.kind === kind && sample.temperature === temperature);
    assert.ok(samples.length, `Missing ${kind}/${temperature} samples`);
    return { kind, temperature, repeats: samples.length,
      medians: Object.fromEntries(metrics.map(key => [key, median(samples.map(sample => sample[key]))])),
      maxima: Object.fromEntries(metrics.map(key => [key, Math.max(...samples.map(sample => sample[key]))])) };
  }));
}
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM, args: ["--no-sandbox"] });

async function setup(page) {
  await page.addInitScript(({ user }) => {
    localStorage.setItem("ordo.settings", JSON.stringify({ themeMode: "dark", expressive: true, materialYouColors: false,
      serverUrl: "https://fixture.example.test", hapticsEnabled: false }));
    localStorage.setItem("secure.ordo.auth", JSON.stringify({ user, tokens: {
      accessToken: "fixture-access", refreshToken: "fixture-refresh", expiresIn: 86400,
    }, accessExpiresAt: Date.now() + 86400000 }));
  }, { user });
  page.on("pageerror", error => results.errors.push(error.message));
  let state = { ...article };
  await page.route("**/*", async route => {
    const request = route.request(), url = new URL(request.url()), path = url.pathname;
    if (url.origin === new URL(base).origin) return route.continue();
    let body = { success: true };
    if (path === "/api/auth/me") body = user;
    else if (path === "/api/auth/refresh") body = { user, tokens: { accessToken: "fixture-access", refreshToken: "fixture-refresh", expiresIn: 86400 } };
    else if (path === "/api/server/info") body = { name: "ordo", version: "0.3.0", reminders: true, folderLockTypes: true };
    else if (path === "/api/folders") body = [];
    else if (path === "/api/tags") body = [tag];
    else if (path === "/api/bookmarks/extraction-progress") body = { pending: 0, total: count };
    else if (path === "/api/bookmarks/reminders") body = [];
    else if (path.startsWith("/api/bookmarks/article")) {
      if (request.method() === "PATCH") state = { ...state, ...request.postDataJSON() };
      body = { ...state, contentHtml, highlights: [] };
    } else if (path.includes("/bookmarks")) body = { items: [state, ...Array.from({ length: count - 1 }, (_, i) => ({
      ...article, id: `saved-${i}`, title: `Saved reading ${i + 1}`, tags: [],
      createdAt: new Date(Date.parse(stamp) - (i + 1) * 60000).toISOString(),
    }))], nextCursor: null, hasMore: false };
    else if (url.hostname === "api.github.com") body = [];
    if (url.hostname === "www.google.com") return route.fulfill({ contentType: "image/svg+xml", body: '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"/>' });
    await route.fulfill({ contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify(body) });
  });
}

async function measure(page, trigger, target) {
  await trigger.evaluate((node, { target, sampleWindow }) => {
    window.readerOpeningSample = null;
    let releasedAt, inputDelayMs;
    node.addEventListener("pointerup", event => {
      releasedAt = event.timeStamp;
      inputDelayMs = performance.now() - releasedAt;
    }, { once: true, capture: true });
    node.addEventListener("click", event => {
      // Include queued input time: idle preparation must not hide a blocked tap
      // by starting the clock only when the click handler finally runs.
      const start = releasedAt ?? event.timeStamp, frames = [], longTasks = [];
      const queueDelay = inputDelayMs ?? performance.now() - event.timeStamp;
      let last = start;
      const observer = new PerformanceObserver(list => longTasks.push(...list.getEntries().map(entry => ({
        startMs: entry.startTime - start, durationMs: entry.duration,
      }))));
      observer.observe({ type: "longtask" });
      const frame = () => {
        const sampleStart = performance.now();
        let opacity = 0, geometry = null, transforms = [], controlCount = 0;
        const destination = [...document.querySelectorAll(target.selector)].find(element => element.textContent.includes(target.text) &&
          !element.closest('[aria-hidden="true"], [inert]'));
        if (destination) {
          opacity = 1;
          const panel = destination.closest('[role="menu"], [role="dialog"]') ?? destination;
          // A role may be on an unanimated wrapper. Sample the actual label and
          // its ancestors, including animated descendants of that wrapper.
          const walker = document.createTreeWalker(destination, NodeFilter.SHOW_TEXT);
          let textNode, label = destination;
          while ((textNode = walker.nextNode())) {
            if (textNode.textContent.includes(target.text)) { label = textNode.parentElement; break; }
          }
          const rect = label.getBoundingClientRect();
          geometry = { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
          controlCount = panel.querySelectorAll('button, input, [role="button"], [role="radio"], [role="menuitem"], [role="switch"]').length;
          for (let parent = label; parent; parent = parent.parentElement) {
            const style = getComputedStyle(parent);
            if (style.display === "none" || style.visibility === "hidden") opacity = 0;
            opacity *= Number(style.opacity);
            if (style.transform !== "none") transforms.push(style.transform);
          }
          if (!rect.width || !rect.height) opacity = 0;
        }
        // Layout/style reads can themselves finish a pending browser flush.
        // Timestamp after them, never credit visibility before that work ends.
        const now = performance.now();
        frames.push({ timeMs: now - start, gapMs: now - last, sampleWorkMs: now - sampleStart,
          opacity, geometry, transforms, controlCount });
        last = now;
        if (now - start < sampleWindow) return requestAnimationFrame(frame);
        longTasks.push(...observer.takeRecords().map(entry => ({ startMs: entry.startTime - start, durationMs: entry.duration })));
        observer.disconnect();
        window.readerOpeningSample = { inputDelayMs: queueDelay, frames, longTasks };
      };
      requestAnimationFrame(frame);
    }, { once: true, capture: true });
  }, { target, sampleWindow });
  if (touch) await trigger.tap();
  else await trigger.click();
  await page.waitForFunction(() => window.readerOpeningSample !== null);
  const sample = await page.evaluate(() => window.readerOpeningSample);
  const first = threshold => sample.frames.find(frame => frame.opacity >= threshold)?.timeMs ?? null;
  assert.notEqual(first(0.05), null, "Overlay must visibly open");
  const stable = (a, b) => a.geometry && b.geometry &&
    Object.keys(a.geometry).every(key => Math.abs(a.geometry[key] - b.geometry[key]) < 0.25) &&
    JSON.stringify(a.transforms) === JSON.stringify(b.transforms);
  const settled = sample.frames.find((frame, i, frames) => frame.opacity >= 0.995 && i >= 2 &&
    frames[i - 1].opacity >= 0.995 && frames[i - 2].opacity >= 0.995 &&
    stable(frame, frames[i - 1]) && stable(frame, frames[i - 2]));
  assert.ok(settled, "Overlay must finish its animation");
  const entranceFrames = sample.frames.filter(frame => frame.timeMs <= settled.timeMs);
  const visibleFrames = sample.frames.slice(sample.frames.findIndex(frame => frame.opacity >= 0.05));
  assert.ok(visibleFrames[0].controlCount > 0, "The sampled surface must contain interactive controls");
  assert.equal(visibleFrames[0].controlCount, visibleFrames.at(-1).controlCount,
    "First visible content must include the controls, not an empty shell");
  for (let i = 1; i < visibleFrames.length; i++) {
    assert.ok(visibleFrames[i].opacity >= visibleFrames[i - 1].opacity - 0.02, "Entrance opacity must not flash backwards");
  }
  return { firstVisibleMs: first(0.05), halfOpaqueMs: first(0.5), opaqueMs: first(0.995), settledMs: settled.timeMs,
    maxEntranceFrameMs: Math.max(...entranceFrames.map(frame => frame.gapMs)),
    maxLongTaskMs: Math.max(0, ...sample.longTasks.map(task => task.durationMs)),
    longTaskTotalMs: sample.longTasks.reduce((total, task) => total + task.durationMs, 0),
    ...sample };
}

try {
  for (let repeat = 0; repeat < repeats; repeat++) {
    // Fresh readers for each kind: opening overflow must not prewarm settings.
    for (const kind of ["overflow", "settings"]) {
      const context = await browser.newContext({ viewport, colorScheme: "dark", hasTouch: touch, isMobile: touch });
      const page = await context.newPage();
      page.setDefaultTimeout(30000);
      try {
        await setup(page);
        const session = await context.newCDPSession(page);
        await session.send("Emulation.setCPUThrottlingRate", { rate: cpu });
        await page.goto(base);
        await page.getByRole("button", { name: /^Performance audit article,/ }).click();
        await button(page, "Reader settings").waitFor();
        await page.getByText("Section 100", { exact: true }).waitFor();
        await page.waitForTimeout(readyWait);
        const trigger = button(page, kind === "overflow" ? "More article actions" : "Reader settings");
        const target = kind === "overflow" ? { selector: '[role="menuitem"]', text: "Open original" } :
          { selector: '[role="dialog"]', text: "Text size" };
        for (const temperature of ["cold", "warm"]) {
          const elementsBefore = await page.locator("*").count();
          const fontsBefore = await page.evaluate(() => Array.from(document.fonts).map(font => ({ family: font.family, status: font.status })));
          const sample = { repeat, kind, temperature, elementsBefore, fontsBefore, ...await measure(page, trigger, target) };
          results.samples.push(sample);
          console.log(JSON.stringify({ ...sample, frames: undefined, longTasks: undefined, fontsBefore: undefined }));
          if (kind === "settings" && temperature === "warm") {
            // Correctness only, after both measured windows: small preview
            // assets must still draw their actual typefaces, not UI fallbacks.
            const expected = [
              ["Libron", "Libron_400Regular"], ["Legible Sans", "NVLegibleNext_400Regular"],
              ["Garamond", "NVGaramond_400Regular"], ["Bitter", "NVBitter_400Regular"], ["Jost", "NVJost_400Regular"],
            ];
            await page.waitForFunction(expected => expected.every(([label, family]) => {
              const radio = [...document.querySelectorAll('[role="radio"]')].find(node => node.getAttribute("aria-label")?.startsWith(`${label},`));
              if (!radio) return false;
              const walker = document.createTreeWalker(radio, NodeFilter.SHOW_TEXT);
              let text;
              while ((text = walker.nextNode())) {
                if (text.textContent.trim() !== label) continue;
                const drawn = getComputedStyle(text.parentElement).fontFamily.split(",")[0].replaceAll('"', "").replaceAll("'", "").trim();
                return (drawn === family || drawn === `${family}_Preview`) &&
                  [...document.fonts].some(face => face.family.replaceAll('"', "").replaceAll("'", "") === drawn && face.status === "loaded");
              }
              return false;
            }), expected, { timeout: 5000 });
            sample.fontsAfter = await page.evaluate(() => [...document.fonts].map(font => ({ family: font.family, status: font.status })));
          }
          await page.keyboard.press("Escape");
          await page.waitForTimeout(500);
          assert.equal(await page.getByRole(kind === "overflow" ? "menuitem" : "dialog").count(), 0,
            "Closed content must not remain accessible");
        }
      } finally { await context.close(); }
    }
  }
  assert.deepEqual(results.errors, []);
  results.summary = summarize(results);
  results.budgets = Object.fromEntries([
    ["halfOpaqueMs", process.env.ORDO_UI_MAX_HALF_OPAQUE_MS],
    ["maxEntranceFrameMs", process.env.ORDO_UI_MAX_ENTRANCE_FRAME_MS],
    ["longTaskTotalMs", process.env.ORDO_UI_MAX_LONGTASK_TOTAL_MS],
  ].filter(([, value]) => value !== undefined).map(([key, value]) => [key, Number(value)]));
  for (const group of results.summary) {
    for (const [metric, limit] of Object.entries(results.budgets)) {
      assert.ok(Number.isFinite(limit) && limit >= 0, `${metric} budget must be finite and nonnegative`);
      assert.ok(group.medians[metric] <= limit,
        `${group.kind}/${group.temperature} median ${metric}: ${group.medians[metric].toFixed(1)} > ${limit} ms`);
      assert.ok(group.maxima[metric] <= limit * 1.5,
        `${group.kind}/${group.temperature} worst ${metric}: ${group.maxima[metric].toFixed(1)} > ${limit * 1.5} ms`);
    }
  }
  if (process.env.ORDO_UI_BASELINE) {
    const before = JSON.parse(await readFile(process.env.ORDO_UI_BASELINE, "utf8"));
    for (const key of ["measurementVersion", "fixtureBookmarks", "fixtureSections", "cpuThrottle", "readyWaitMs", "sampleWindowMs", "viewport"]) {
      assert.deepEqual(before[key], results[key], `Compare the same ${key}`);
    }
    assert.deepEqual(before.errors, [], "Baseline must not have browser errors");
    const summaryBefore = summarize(before);
    results.comparison = results.summary.map((group, i) => ({ kind: group.kind, temperature: group.temperature,
      metrics: Object.fromEntries(metrics.map(key => {
        const prior = summaryBefore[i].medians[key], current = group.medians[key];
        return [key, { before: prior, after: current,
          beforeMax: summaryBefore[i].maxima[key], afterMax: group.maxima[key],
          changePercent: prior > 0 ? 100 * (current / prior - 1) : current === 0 ? 0 : null }];
      })) }));
    for (const group of results.comparison) {
      for (const [metric, sample] of Object.entries(group.metrics)) {
        const limit = Math.max(sample.before * 1.15, sample.before + 30);
        assert.ok(sample.after <= limit,
          `${group.kind}/${group.temperature} ${metric}: ${sample.before.toFixed(1)} -> ${sample.after.toFixed(1)} ms exceeds ${limit.toFixed(1)} ms non-regression limit`);
      }
    }
  }
  console.log(JSON.stringify(results.comparison ?? results.summary, null, 2));
} finally {
  await writeFile(`${output}/results.json`, JSON.stringify(results, null, 2));
  await browser.close();
}
