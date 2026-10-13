import assert from "node:assert/strict";

/** Save-dialog focus handoffs and move feedback in both Material modes. */
export async function bookmarkDialogMatrix({ browser, fixture, login, button, settle, capture, results, bookmark, folder }) {
  const baseline = Boolean(process.env.ORDO_UI_BOOKMARK_BASELINE);
  results.bookmarkDialogs = [];
  for (const theme of ["dark", "light"]) for (const expressive of [false, true]) for (const reducedMotion of [false, true]) {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: theme,
      reducedMotion: reducedMotion ? "reduce" : "no-preference" });
    await context.addInitScript(({ theme, expressive }) => localStorage.setItem("ordo.settings",
      JSON.stringify({ themeMode: theme, expressive, materialYouColors: false, createButtonTapAction: "menu" })), { theme, expressive });
    const page = await context.newPage();
    try {
      await fixture(page, { catalogue: true, bookmarkCount: 2 }); await login(page); await settle(page);
      const mode = `${theme}-${expressive ? "expressive" : "standard"}-${reducedMotion ? "reduced" : "motion"}`;
      for (const viewport of [{ name: "portrait", width: 390, height: 844 }, { name: "landscape", width: 1280, height: 800 }, { name: "compact", width: 320, height: 420 }]) {
        await page.setViewportSize(viewport);
        await page.getByTestId("add-bookmark-fab").click();
        await page.getByRole("menuitem", { name: "Save bookmark", exact: true }).click();
        const dialog = page.getByRole("dialog", { name: "Save bookmark", exact: true });
        await dialog.waitFor(); await settle(page);
        const link = dialog.getByRole("textbox", { name: "Link", exact: true });
        await link.fill("https://example.test/saved");
        await page.evaluate(() => {
          window.bookmarkSearchFocus = 0;
          window.bookmarkFocusTrace = [];
          if (window.bookmarkFocusListener) document.removeEventListener("focusin", window.bookmarkFocusListener);
          window.bookmarkFocusListener = event => {
            const label = event.target.getAttribute("aria-label");
            window.bookmarkFocusTrace.push(label);
            if (label === "Search your library") window.bookmarkSearchFocus++;
          };
          document.addEventListener("focusin", window.bookmarkFocusListener);
        });
        await button(page, "Folder, Bookmarks").click(); await settle(page);
        await page.getByRole("textbox", { name: "Find a folder", exact: true }).fill("Design");
        await page.getByRole("menuitemradio", { name: folder.name, exact: true }).click(); await settle(page);
        const focus = await page.evaluate(() => ({ searchFocus: window.bookmarkSearchFocus,
          inDialog: Boolean(document.activeElement?.closest('[role="dialog"]')),
          label: document.activeElement?.getAttribute("aria-label"), trace: window.bookmarkFocusTrace }));
        results.bookmarkDialogs.push({ mode, layout: viewport.name, ...focus });
        if (!baseline) {
          assert.equal(focus.searchFocus, 0, `${mode}/${viewport.name}: folder picker must never focus library search`);
          assert.equal(focus.inDialog, true, `${mode}/${viewport.name}: return focus to save dialog`);
          assert.equal(focus.label, `Folder, ${folder.name}`, "Restore the updated picker trigger, not the link keyboard");
        }
        assert.equal(await link.inputValue(), "https://example.test/saved");
        await capture(page, `${mode}-${viewport.name}-save-bookmark`);
        const bounds = await dialog.boundingBox();
        assert.ok(bounds.y >= 0 && bounds.y + bounds.height <= viewport.height, "Save form fits the viewport");
        // Escape closes the dropdown only; Tab stays in the parent afterwards.
        await button(page, `Folder, ${folder.name}`).click(); await settle(page);
        await page.keyboard.press("Escape"); await settle(page);
        assert.equal(await dialog.count(), 1);
        if (!baseline) for (let tab = 0; tab < 8; tab++) {
          await page.keyboard.press("Tab");
          assert.equal(await page.evaluate(() => Boolean(document.activeElement?.closest('[role="dialog"]'))), true);
        }
        await button(page, "Tags, Add tags").click(); await settle(page);
        await page.keyboard.press("Escape"); await settle(page);
        assert.equal(await link.inputValue(), "https://example.test/saved");
        if (!baseline) assert.equal(await page.evaluate(() => window.bookmarkSearchFocus), 0);
        await button(page, `Folder, ${folder.name}`).click(); await settle(page);
        await page.getByRole("menuitem", { name: "New folder", exact: true }).click(); await settle(page);
        const createFolder = page.getByRole("dialog", { name: "New folder", exact: true });
        await createFolder.waitFor();
        assert.equal(await page.getByRole("dialog").count(), 1, "Only the sibling picker is exposed");
        await createFolder.getByRole("textbox", { name: "Name", exact: true }).fill("Reading later");
        await page.keyboard.press("Escape"); await settle(page);
        assert.equal(await link.inputValue(), "https://example.test/saved", "Sibling creation preserves the save draft");
        if (!baseline) assert.equal(await page.evaluate(() => window.bookmarkSearchFocus), 0);
        await page.keyboard.press("Escape"); await settle(page);
      }
      await page.setViewportSize({ width: 390, height: 844 }); await settle(page);
      // Error must retain the picker, then retry can confirm one destination.
      let failMove = true, mutations = 0;
      await page.route(`**/api/bookmarks/${bookmark.id}`, async route => {
        if (route.request().method() !== "PATCH") return route.fallback();
        mutations++;
        await page.waitForTimeout(180);
        await route.fulfill({ status: failMove ? 500 : 200, contentType: "application/json",
          body: JSON.stringify(failMove ? { error: { code: "INTERNAL_ERROR", message: "Couldn't move bookmark. Try again." } }
            : { ...bookmark, folderId: folder.id }) });
      });
      const article = page.getByRole("button", { name: /^Building a more expressive design system,/ });
      await article.click({ button: "right" });
      await page.getByRole("menuitem", { name: "Move to folder", exact: true }).click(); await settle(page);
      await button(page, folder.name).click();
      await page.getByText("Couldn't move bookmark. Try again.", { exact: true }).waitFor();
      failMove = false;
      await page.evaluate(() => {
        window.bookmarkMoveFrames = [];
        const observer = new MutationObserver(() => {
          const node = document.querySelector('[data-testid="bookmark-move-feedback"]');
          if (!node) return;
          observer.disconnect();
          const start = performance.now();
          const sample = time => {
            window.bookmarkMoveFrames.push(node.firstElementChild.getBoundingClientRect().width);
            if (time - start < 400) requestAnimationFrame(sample);
          };
          sample(start);
        });
        observer.observe(document.body, { childList: true, subtree: true });
        setTimeout(() => observer.disconnect(), 2000);
      });
      if (baseline) await button(page, folder.name).click();
      else await button(page, folder.name).evaluate(node => { node.click(); node.click(); });
      if (!baseline && !reducedMotion) {
        const feedback = page.getByTestId("bookmark-move-feedback");
        await feedback.waitFor();
        assert.equal(await feedback.getAttribute("role"), "status");
        const name = `${mode}-move-confirmation`;
        await page.screenshot({ path: `${process.env.ORDO_UI_OUTPUT ?? "/tmp/opencode/ordo-material-ui"}/${name}.png` });
        results.screens.push(name);
        await page.waitForTimeout(450);
        const frames = await page.evaluate(() => window.bookmarkMoveFrames);
        assert.ok(Math.max(...frames) - Math.min(...frames) > 0.1, `Destination icon settles with the Material spatial spring: ${JSON.stringify(frames)}`);
        (results.bookmarkMoveMotion ??= []).push({ mode, frames: frames.length,
          scaleRangePx: Math.max(...frames) - Math.min(...frames) });
      }
      await page.getByRole("dialog", { name: "Move to folder", exact: true }).waitFor({ state: "hidden" });
      assert.equal(mutations, 2, "Exactly one request per destination choice, including retry");
      await settle(page);
      let batchMoves = 0;
      await page.route("**/api/bookmarks/batch", async route => {
        const body = route.request().postDataJSON();
        assert.equal(body.action, "move"); assert.equal(body.ids.length, 2);
        batchMoves++;
        await route.fulfill({ contentType: "application/json", body: JSON.stringify({ updated: 2 }) });
      });
      const selectBookmark = button(page, `Select ${bookmark.title}`);
      await selectBookmark.scrollIntoViewIfNeeded();
      const lead = await selectBookmark.boundingBox();
      await page.mouse.move(lead.x + lead.width / 2, lead.y + lead.height / 2);
      await page.mouse.down(); await page.waitForTimeout(550); await page.mouse.up(); await settle(page);
      await page.getByRole("checkbox", { name: /^Saved reading 1,/ }).click();
      await button(page, "Move").click(); await settle(page);
      await button(page, folder.name).click();
      await page.getByRole("dialog", { name: "Move to folder", exact: true }).waitFor({ state: "hidden" });
      assert.equal(batchMoves, 1, "Batch move uses the same confirmation flow without duplicate requests");
      results.interactions.push(`${mode}: folder/tag focus handoffs, keyboard containment, move failure/retry/success`);
    } catch (error) {
      console.error(error, (await page.locator("body").innerText()).slice(-4000));
      await page.screenshot({ path: `${process.env.ORDO_UI_OUTPUT ?? "/tmp/opencode/ordo-material-ui"}/${theme}-${expressive ? "expressive" : "standard"}-bookmark-failure.png` });
      throw error;
    } finally { await context.close(); }
  }
}
