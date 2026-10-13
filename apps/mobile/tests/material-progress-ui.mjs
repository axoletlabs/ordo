import assert from "node:assert/strict";

/** Built-app checks, with API fixtures rather than a production backend. */
export async function progressMatrix({ browser, fixture, login, navigate, button, settle, capture, results, bookmark }) {
  for (const theme of ["dark", "light"]) for (const expressive of [false, true]) {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: theme, hasTouch: true });
    await context.addInitScript(({ theme, expressive }) => localStorage.setItem("ordo.settings",
      JSON.stringify({ themeMode: theme, expressive, materialYouColors: false })), { theme, expressive });
    const page = await context.newPage();
    await fixture(page, { bookmarkCount: 8, richReader: true });
    let refreshRequests = 0;
    let holdRefresh = false;
    let freezeExtraction = false;
    let releaseRefresh;
    const refreshGate = new Promise(resolve => { releaseRefresh = resolve; });
    let releaseExtraction;
    const extractionGate = new Promise(resolve => { releaseExtraction = resolve; });
    await page.route(/\/api\/bookmarks\/extraction-progress(?:\?|$)/, async route => {
      // Extraction polling legitimately reconciles bookmark lists. Pause it
      // while counting gesture requests rather than mistaking polls for pulls.
      if (freezeExtraction) await extractionGate;
      await route.fulfill({ contentType: "application/json", body: JSON.stringify({ pending: 11, completed: 9, total: 20 }) });
    });
    await page.route(/\/api\/bookmarks(?:\?|$)/, async route => {
      if (route.request().method() !== "GET") return route.fallback();
      if (new URL(route.request().url()).searchParams.get("scope") !== "all") {
        refreshRequests++;
        if (holdRefresh) await refreshGate;
      }
      await route.fulfill({ contentType: "application/json", body: JSON.stringify({ items: [bookmark,
        ...Array.from({ length: 7 }, (_, i) => ({ ...bookmark, id: `pending-${i}`, title: `Saved reading ${i + 1}`, fetchStatus: "pending", tags: [] }))],
        nextCursor: null, hasMore: false }) });
    });
    await login(page); await settle(page);
    const mode = `${theme}-${expressive ? "expressive" : "standard"}`;
    const progress = page.getByRole("progressbar", { name: "Fetching articles, 9 of 20", exact: true });
    assert.equal(await progress.getAttribute("aria-valuenow"), "45");
    assert.equal((await progress.boundingBox()).height, 4);
    const spinner = page.getByTestId("material-circular-progress").first();
    const arc = spinner.locator(expressive ? "path" : "circle");
    const before = await arc.getAttribute("stroke-dashoffset");
    await page.waitForTimeout(350);
    assert.notEqual(await arc.getAttribute("stroke-dashoffset"), before, `${mode}: arc animates`);
    for (const viewport of [{ name: "portrait", width: 390, height: 844 }, { name: "landscape", width: 1280, height: 800 }]) {
      await page.setViewportSize(viewport); await capture(page, `${mode}-loading-${viewport.name}`);
    }
    freezeExtraction = true;
    await page.setViewportSize({ width: 390, height: 844 }); await settle(page);
    // Observe pulls at the list's right edge, away from row actions.
    async function pull({ distance = 110, cancel = false, sideways = false } = {}) {
      await page.evaluate(({ distance, cancel, sideways }) => {
        const anchor = document.querySelector('[aria-label="Select Saved reading 1"]');
        let node = anchor;
        while (node && getComputedStyle(node).overflowY !== "auto" && getComputedStyle(node).overflowY !== "scroll") node = node.parentElement;
        if (!node) throw new Error("list scroll host not found");
        window.progressScrollHost = node;
        const x = node.getBoundingClientRect().right - 8;
        const touch = (type, y, dx = 0) => {
          const point = new Touch({ identifier: 1, target: node, clientX: x + dx, clientY: y, pageX: x + dx, pageY: y });
          node.dispatchEvent(new TouchEvent(type, { bubbles: true, cancelable: true, touches: type === "touchend" || type === "touchcancel" ? [] : [point], changedTouches: [point] }));
        };
        touch("touchstart", 300);
        touch("touchmove", 300 + distance, sideways ? 160 : 0);
        touch(cancel ? "touchcancel" : "touchend", 300 + distance);
      }, { distance, cancel, sideways });
    }
    holdRefresh = true;
    const idleCount = refreshRequests;
    await pull({ distance: 40 });
    await pull({ cancel: true });
    await pull({ sideways: true });
    await settle(page);
    assert.equal(refreshRequests, idleCount, `${mode}: short, cancelled and horizontal pulls do not refresh`);
    await pull();
    await page.getByRole("progressbar", { name: "Refreshing", exact: true }).waitFor();
    const refreshingCount = refreshRequests;
    assert.equal(refreshingCount, idleCount + 1, `${mode}: one request per completed pull`);
    await pull();
    await page.waitForTimeout(300);
    assert.equal(refreshRequests, refreshingCount, `${mode}: one refresh, not a loop`);
    for (const viewport of [{ name: "portrait", width: 390, height: 844 }, { name: "landscape", width: 1280, height: 800 }]) {
      await page.setViewportSize(viewport); await capture(page, `${mode}-refreshing-${viewport.name}`);
    }
    releaseRefresh();
    await page.getByRole("progressbar", { name: "Refreshing", exact: true }).waitFor({ state: "hidden" });
    holdRefresh = false;
    const completedCount = refreshRequests;
    const nextRefresh = page.waitForResponse(response => {
      const url = new URL(response.url());
      return url.pathname === "/api/bookmarks" && url.searchParams.get("scope") !== "all";
    });
    await pull();
    await nextRefresh; await settle(page);
    assert.equal(refreshRequests, completedCount + 1, `${mode}: a new pull refreshes once after completion in wide layout`);
    await page.getByRole("progressbar", { name: "Refreshing", exact: true }).waitFor({ state: "hidden" });
    await page.emulateMedia({ reducedMotion: "reduce" }); await page.waitForTimeout(500);
    const staticArc = await arc.getAttribute("stroke-dashoffset");
    await page.waitForTimeout(350);
    assert.equal(await arc.getAttribute("stroke-dashoffset"), staticArc, `${mode}: reduced motion stays still`);
    await navigate(page, "reader/article");
    const reading = page.getByRole("progressbar", { name: "Reading progress", exact: true });
    assert.equal((await reading.boundingBox()).height, 4);
    await reading.evaluate(node => {
      const parent = node.closest('[data-testid="reader-pane"]') ?? document.body;
      const host = [...parent.querySelectorAll("div")].find(element => {
        const style = getComputedStyle(element);
        return (style.overflowY === "auto" || style.overflowY === "scroll") && element.scrollHeight > element.clientHeight + 100;
      });
      if (!host) throw new Error("reader scroll host not found");
      host.scrollTop = (host.scrollHeight - host.clientHeight) * 0.55;
    });
    await settle(page);
    assert.ok(Number(await reading.getAttribute("aria-valuenow")) > 0, `${mode}: reader progress follows scroll`);
    await button(page, "Back").focus(); await page.keyboard.press("Enter"); await settle(page);
    await button(page, "Account and settings").waitFor();
    results.interactions.push(`${mode}: progress semantics, animated arcs, ignored invalid/duplicate pulls, single refresh completion in both layouts, reduced motion, reader scrolling, keyboard Back`);
    releaseExtraction();
    await context.close();
  }
}
