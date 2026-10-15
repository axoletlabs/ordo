import assert from "node:assert/strict";

/** Long articles must not turn the floating contents panel into a full-screen list. */
export async function readerContentsMatrix({ browser, fixture, login, navigate, button, settle, capture, results }) {
  const baseline = process.env.ORDO_UI_CONTENTS_BASELINE === "1";
  results.contentsMeasurements = [];
  for (const theme of ["light", "dark"]) for (const expressive of [false, true]) {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: theme });
    let page;
    try {
      await context.addInitScript(({ theme, expressive }) => localStorage.setItem("ordo.settings", JSON.stringify({ themeMode: theme, expressive, materialYouColors: false })), { theme, expressive });
      page = await context.newPage();
      await fixture(page, { longContents: true, readerPreferences: { theme } });
      await login(page);
      for (const viewport of [{ name: "portrait", width: 390, height: 844 }, { name: "landscape", width: 1280, height: 800 }, { name: "constrained", width: 320, height: 420 }]) {
        await page.setViewportSize(viewport);
        await navigate(page, "reader/article");
        const mode = `${theme}-${expressive ? "expressive" : "standard"}-${viewport.name}`;
        const trigger = button(page, "Table of contents");
        await trigger.focus();
        await trigger.click(); await settle(page);
        const dialog = page.getByRole("dialog"), bounds = await dialog.boundingBox();
        results.contentsMeasurements.push({ mode, width: bounds.width, height: bounds.height });
        assert.ok(bounds.x >= 16 && bounds.y >= 16 && bounds.y + bounds.height <= viewport.height - 16, `${mode}: panel stays inset`);
        if (!baseline) {
          assert.ok(bounds.width <= Math.min(384, viewport.width - 48), `${mode}: compact panel width`);
          assert.ok(bounds.height <= (viewport.height >= 600 ? viewport.height * 0.7 : viewport.height - 96), `${mode}: article remains visible around panel`);
          const close = button(page, "Close dialog"), closeBounds = await close.boundingBox();
          assert.ok(closeBounds.width >= 48 && closeBounds.height >= 48, `${mode}: accessible close target`);
          assert.ok(closeBounds.y >= bounds.y && closeBounds.y + closeBounds.height <= bounds.y + bounds.height, `${mode}: close remains inside panel`);
          const actions = button(page, "Article actions"), actionBounds = await actions.boundingBox();
          assert.ok(actionBounds.y + actionBounds.height <= bounds.y + bounds.height, `${mode}: footer stays visible`);
          const last = button(page, "Go to Section 24: Reading with purpose");
          await last.scrollIntoViewIfNeeded(); await settle(page);
          const scrolled = await dialog.boundingBox();
          assert.ok(Math.abs(scrolled.height - bounds.height) < 1, `${mode}: scrolling does not resize panel`);
          await button(page, "Go to Section 1: Reading with purpose").scrollIntoViewIfNeeded();
          await page.mouse.move(0, 0); await capture(page, `${mode}-contents`);
          await close.click(); await settle(page);
          assert.equal(await dialog.count(), 0, `${mode}: close dismisses panel`);
          assert.equal(await trigger.evaluate(node => node === document.activeElement), true, `${mode}: focus returns to trigger`);
          await trigger.click(); await settle(page);
          await actions.click(); await settle(page);
          await page.getByRole("menu").waitFor();
          await page.keyboard.press("Escape"); await settle(page);
          await trigger.click(); await settle(page);
          await page.keyboard.press("Escape"); await settle(page);
          assert.equal(await dialog.count(), 0, `${mode}: Escape dismisses panel`);
          await page.emulateMedia({ reducedMotion: "reduce" });
          await trigger.click(); await settle(page);
          await last.focus(); await page.keyboard.press("Enter"); await settle(page);
          assert.equal(await dialog.count(), 0, `${mode}: keyboard heading selection works with reduced motion`);
          await page.emulateMedia({ reducedMotion: "no-preference" });
          await page.getByText("Building a more expressive design system", { exact: true }).last().scrollIntoViewIfNeeded();
          await settle(page);
        } else {
          await capture(page, `${mode}-contents`);
          await page.keyboard.press("Escape"); await settle(page);
        }
        await navigate(page, "");
      }
      results.interactions.push(`${theme}-${expressive}: ${baseline ? "baseline long-contents geometry" : "bounded long contents, close, focus restore, actions, Escape, keyboard selection and reduced motion"}`);
    } catch (error) {
      if (page) {
        await capture(page, "reader-contents-failure");
      }
      throw error;
    } finally {
      await context.close();
    }
  }
}
