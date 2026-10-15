import assert from "node:assert/strict";

/** Keep preset labels and local times readable without changing menu typography. */
export async function reminderMenuLayoutMatrix({ browser, fixture, login, navigate, button, settle, capture, results }) {
  const baseline = !!process.env.ORDO_UI_REMINDER_MENU_BASELINE;
  results.reminderMenuMeasurements = [];
  const themes = process.env.ORDO_UI_THEME ? [process.env.ORDO_UI_THEME] : ["dark", "light"];
  const modes = process.env.ORDO_UI_EXPRESSIVE ? [process.env.ORDO_UI_EXPRESSIVE === "true"] : [false, true];
  const locales = process.env.ORDO_UI_LOCALE ? [process.env.ORDO_UI_LOCALE] : ["en-US", "en-GB"];
  for (const theme of themes) for (const expressive of modes) for (const locale of locales) {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: theme,
      locale, reducedMotion: expressive ? "reduce" : "no-preference" });
    await context.addInitScript(({ theme, expressive }) => localStorage.setItem("ordo.settings", JSON.stringify({ themeMode: theme, expressive, materialYouColors: false })), { theme, expressive });
    const page = await context.newPage();
    try {
      await page.clock.setFixedTime(new Date("2026-10-15T12:00:00"));
      await fixture(page); await login(page); await settle(page);
      for (const source of ["library", "reader"]) {
        if (source === "reader") {
          await page.setViewportSize({ width: 390, height: 844 });
          await navigate(page, "reader/article"); await settle(page);
        }
        for (const viewport of [{ name: "portrait", width: 390, height: 844 }, { name: "landscape", width: 1280, height: 800 }, { name: "narrow", width: 320, height: 640 }]) {
          await page.setViewportSize(viewport); await settle(page);
          if (source === "library") await page.getByRole("button", { name: /^Building a more expressive design system,/ }).click({ button: "right" });
          else await button(page, "More article actions").click();
          await settle(page);
          const menu = page.getByRole("menu"), original = await menu.boundingBox();
          await page.getByRole("menuitem", { name: "Remind", exact: true }).click(); await settle(page);
          const bounds = await menu.boundingBox();
          const mode = `${theme}-${expressive ? "expressive" : "standard"}-${locale}-${source}-${viewport.name}`;
          const rows = [];
          for (const label of ["In 1 hour", "In 3 hours", "Tomorrow", "Next week"]) {
            const row = page.getByRole("menuitem", { name: new RegExp(`^${label},`) });
            rows.push(await row.evaluate((node, label) => {
              const children = [...node.children];
              const text = children.find(child => child.textContent === label);
              const detail = children.find(child => child !== text && /\d/.test(child.textContent));
              const rect = text.getBoundingClientRect(), style = getComputedStyle(text);
              const range = document.createRange(); range.selectNodeContents(text);
              const lines = [...new Set([...range.getClientRects()].map(rect => rect.top))].length;
              return { label, lines, labelHeight: rect.height, labelWidth: rect.width, fontSize: style.fontSize,
                detailClipped: detail.scrollWidth > detail.clientWidth, rowHeight: node.getBoundingClientRect().height };
            }, label));
          }
          results.reminderMenuMeasurements.push({ mode, menuWidth: bounds.width, rows });
          if (!baseline) {
            assert.ok(rows.every(row => row.lines === 1 && row.labelHeight === 24), `${mode}: preset labels must remain on one line: ${JSON.stringify(rows)}`);
            assert.ok(rows.every(row => !row.detailClipped && row.fontSize === "16px" && row.rowHeight >= 48), `${mode}: preserve full times, font size, and touch targets`);
            assert.ok(bounds.x >= 12 && bounds.x + bounds.width <= viewport.width - 12, `${mode}: menu fits viewport`);
            assert.ok(Math.abs(bounds.x - original.x) < 1 && Math.abs(bounds.y - original.y) < 1, `${mode}: nested menu keeps its origin`);
          }
          if (theme === "dark" && expressive && locale === "en-US" && source === "library" && viewport.name !== "narrow") {
            await page.mouse.move(0, 0); await capture(page, `reminder-menu-${viewport.name}`);
          }
          await page.getByRole("menuitem", { name: "Back", exact: true }).focus(); await page.keyboard.press("Enter"); await settle(page);
          const restored = await menu.boundingBox();
          assert.ok(Math.abs(restored.height - original.height) < 1, `${mode}: keyboard Back restores actions`);
          await page.keyboard.press("Escape"); await settle(page);
          assert.equal(await menu.count(), 0, `${mode}: Escape dismisses`);
        }
      }
      results.interactions.push(`${theme}-${expressive}-${locale}: reminder labels, times, keyboard Back/Escape, library/reader, three viewport sizes`);
    } catch (error) {
      await capture(page, "reminder-menu-failure");
      console.error(await page.locator("body").innerText());
      throw error;
    } finally { await context.close(); }
  }
}
