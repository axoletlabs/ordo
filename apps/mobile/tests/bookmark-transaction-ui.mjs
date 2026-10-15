import assert from "node:assert/strict";

/** Stateful HTTP fixture: unlike a static picker smoke test, every subsequent
 * GET reflects the preceding write. Replays the user's move/delete/Undo loop. */
export async function bookmarkTransactionMatrix({ browser, fixture, login, button, settle, capture, results, bookmark, folder }) {
  const baseline = Boolean(process.env.ORDO_UI_TRANSACTION_BASELINE);
  results.bookmarkTransactions = [];
  const themes = process.env.ORDO_UI_THEME ? [process.env.ORDO_UI_THEME] : ["dark", "light"];
  for (const theme of themes) for (const expressive of [false, true]) for (const reducedMotion of [false, true]) {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: theme,
      reducedMotion: reducedMotion ? "reduce" : "no-preference" });
    await context.addInitScript(({ theme, expressive, folderId }) => {
      localStorage.setItem("ordo.settings", JSON.stringify({ themeMode: theme, expressive, materialYouColors: false }));
      localStorage.setItem("secure.ordo.folderTokens", JSON.stringify({ [folderId]: { token: "fixture-folder-token", expiresAt: Date.now() + 600_000 } }));
    }, { theme, expressive, folderId: folder.id });
    const page = await context.newPage();
    page.setDefaultTimeout(10_000);
    const mode = `${theme}-${expressive ? "expressive" : "standard"}-${reducedMotion ? "reduced" : "motion"}`;
    let current = { ...bookmark, title: "DeepSWE", tags: [], folderId: null };
    let folderPresent = true, patches = 0, deletes = 0, warmedInFolder = 0;
    await fixture(page);
    await page.route("**/api/**", async route => {
      const request = route.request(), url = new URL(request.url()), path = url.pathname;
      let body;
      if (path === "/api/folders" && request.method() === "GET") body = folderPresent
        ? [{ ...folder, name: "sleep", protected: true, lockType: "password", bookmarkCount: current.folderId ? 1 : 0, unreadCount: current.folderId && !current.isRead ? 1 : 0 }] : [];
      else if (path === `/api/folders/${folder.id}` && request.method() === "DELETE") { folderPresent = false; deletes++; body = { success: true }; }
      else if (path === "/api/bookmarks" && request.method() === "GET") {
        const all = url.searchParams.get("scope") === "all";
        const scope = url.searchParams.get("folderId");
        body = { items: all || scope === current.folderId ? [current] : [], nextCursor: null, hasMore: false };
      } else if (path === `/api/bookmarks/${bookmark.id}` && request.method() === "PATCH") {
        const patch = request.postDataJSON();
        assert.ok("folderId" in patch, "Move must explicitly send null to unfile");
        patches++;
        current = { ...current, ...patch, updatedAt: new Date(Date.parse(bookmark.updatedAt) + patches * 1000).toISOString() };
        body = current;
      } else if (path === `/api/bookmarks/${bookmark.id}` && request.method() === "GET") {
        if (current.folderId) warmedInFolder++;
        body = { ...current, contentHtml: "<p>Cached reader detail.</p>", highlights: [] };
      } else return route.fallback();
      await route.fulfill({ contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify(body) });
    });
    const row = () => page.getByRole("button", { name: /^DeepSWE,/ });
    const folderRow = () => page.getByRole("button", { name: /^sleep, \d+ bookmarks?/ });
    const dismissNotifications = async () => {
      for (let i = 0; i < 6 && await button(page, "Dismiss notification").count(); i++) {
        await button(page, "Dismiss notification").click(); await page.waitForTimeout(300);
      }
    };
    const move = async (destination, keyboardCheck = false) => {
      const bounds = await row().boundingBox();
      await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
      await page.mouse.down(); await page.waitForTimeout(600); await page.mouse.up();
      await page.getByRole("menuitem", { name: "Move to folder", exact: true }).waitFor();
      await page.evaluate(() => {
        window.moveHandoffOverlap = 0;
        const start = performance.now();
        const sample = () => {
          const fadingMenu = [...document.querySelectorAll('[role="menu"]')].some(node => +getComputedStyle(node).opacity > 0.01);
          const dialog = document.querySelector('[role="dialog"][data-material-overlay="true"]');
          if (fadingMenu && dialog) window.moveHandoffOverlap++;
          if (performance.now() - start < 700) requestAnimationFrame(sample);
        };
        requestAnimationFrame(sample);
      });
      await page.getByRole("menuitem", { name: "Move to folder", exact: true }).click();
      await page.getByRole("dialog", { name: "Move to folder", exact: true }).waitFor();
      await settle(page);
      if (!baseline) assert.equal(await page.evaluate(() => window.moveHandoffOverlap), 0, "Outgoing menu must leave before the picker opens");
      if (keyboardCheck) {
        const before = patches;
        for (let tab = 0; tab < 3; tab++) {
          await page.keyboard.press("Tab");
          assert.equal(await page.evaluate(() => Boolean(document.activeElement?.closest('[role="dialog"]'))), true);
        }
        await page.keyboard.press("Escape");
        await page.getByRole("dialog", { name: "Move to folder", exact: true }).waitFor({ state: "hidden" });
        await settle(page); assert.equal(patches, before, "Keyboard dismissal must not move anything");
        return move(destination);
      }
      await button(page, destination).click();
      await page.getByRole("dialog", { name: "Move to folder", exact: true }).waitFor({ state: "hidden" });
      await settle(page);
    };
    const deleteFolder = async () => {
      await folderRow().click({ button: "right" });
      await page.getByRole("menuitem", { name: "Delete folder", exact: true }).click();
      await page.getByRole("dialog", { name: "Delete sleep?", exact: true }).waitFor();
      await button(page, "Delete").click(); await settle(page);
    };
    try {
      await login(page); await settle(page);
      for (const viewport of [{ name: "portrait", width: 390, height: 844 }, { name: "landscape", width: 1280, height: 800 }]) {
        console.log(`Transactions: ${mode}/${viewport.name}`);
        await page.setViewportSize(viewport); await settle(page);
        await move("sleep", viewport.name === "portrait");
        assert.equal(current.folderId, folder.id);
        assert.equal(await row().count(), 0); assert.match(await folderRow().getAttribute("aria-label"), /1 bookmark/);
        await folderRow().click(); await row().waitFor();
        await move("Bookmarks");
        assert.equal(current.folderId, null);
        await page.getByText("No bookmarks here", { exact: true }).waitFor();
        await button(page, "Back").click(); await row().waitFor(); await dismissNotifications();
        for (let cycle = 0; cycle < 2; cycle++) {
          await deleteFolder();
          assert.equal(await row().count(), 1, "Deleting the empty folder must keep DeepSWE in Library");
          await button(page, "Undo").waitFor();
          // The former 6.3s fallback made this still-visible action a no-op.
          if (theme === "dark" && expressive && !reducedMotion && viewport.name === "portrait" && cycle === 0) {
            await page.waitForTimeout(6500);
            assert.equal(deletes, 0, "Deletion cannot commit before Undo leaves");
          }
          await button(page, "Undo").click(); await settle(page);
          assert.equal(await row().count(), 1);
          assert.match(await folderRow().getAttribute("aria-label"), /0 bookmarks/);
          await folderRow().click(); await page.getByText("No bookmarks here", { exact: true }).waitFor();
          assert.equal(await row().count(), 0, "Undo cannot resurrect a ghost bookmark inside the empty folder");
          await button(page, "Back").click(); await row().waitFor();
        }
        if (theme === "dark" && expressive && !reducedMotion) await capture(page, `${mode}-${viewport.name}-move-delete-undo`);
        results.bookmarkTransactions.push({ mode, layout: viewport.name, cycles: 2, patches, deletes, warmedInFolder });
        console.log(`Transactions passed: ${mode}/${viewport.name}`);
      }
      assert.ok(warmedInFolder > 0, "Long-press must reproduce the stale reader-detail prerequisite");
      assert.equal(deletes, 0, "Every undone deletion must stay off the server");
      if (theme === "dark" && expressive && !reducedMotion) {
        await deleteFolder();
        await page.reload(); await button(page, "Account and settings").waitFor(); await settle(page);
        assert.equal(deletes, 1, "Reload must replay the durable deletion");
        assert.equal(await folderRow().count(), 0); assert.equal(await row().count(), 1);
        results.interactions.push("Pending folder deletion survived reload; moved-out bookmark retained");
      }
    } catch (error) {
      console.error(mode, await page.locator("body").innerText());
      await page.screenshot({ path: `${process.env.ORDO_UI_OUTPUT ?? "/tmp/opencode/ordo-material-ui"}/${mode}-transaction-failure.png` });
      throw error;
    } finally { await context.close(); }
  }
}
