import assert from "node:assert/strict";

/** Reader preferences affect the article, never the settings panel geometry. */
export async function readerSettingsLayoutMatrix({ browser, fixture, login, navigate, button, settle, capture, results }) {
  const baseline = process.env.ORDO_UI_READER_SETTINGS_BASELINE === "1";
  for (const theme of ["dark", "light"]) for (const expressive of [false, true]) {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: theme });
    await context.addInitScript(({ theme, expressive }) => localStorage.setItem("ordo.settings", JSON.stringify({ themeMode: theme, expressive, materialYouColors: false })), { theme, expressive });
    const page = await context.newPage();
    await fixture(page, { richReader: true, readerPreferences: { theme, fontFamily: "serif", fontSize: "medium", lineSpacing: "default" } });
    try {
      await login(page); await navigate(page, "reader/article");
      await button(page, "Reader settings").click(); await settle(page);
      const dialog = page.getByRole("dialog", { name: "Reader", exact: true });
      const group = name => dialog.getByRole("radiogroup", { name, exact: true });
      for (const viewport of [
        { name: "portrait", width: 390, height: 844 },
        { name: "landscape", width: 1280, height: 800 },
        // Tall windows expose intrinsic sizing bugs hidden by the height cap.
        { name: "tall", width: 1280, height: 1100 },
        { name: "compact", width: 320, height: 420 },
      ]) {
        await page.setViewportSize(viewport); await settle(page);
        const rect = await dialog.boundingBox();
        const bounds = [rect];
        for (const size of ["Small", "Medium", "Large", "Extra large"]) {
          const radio = group("Text size").getByRole("radio", { name: size, exact: true });
          await radio.click(); await settle(page);
          assert.equal(await radio.getAttribute("aria-checked"), "true");
          bounds.push(await dialog.boundingBox());
        }
        for (const family of ["Libron", "Legible Sans", "Garamond", "Bitter", "Jost"]) {
          const radio = group("Typeface").getByRole("radio", { name: new RegExp(`^${family},`) });
          await radio.click(); await settle(page);
          assert.equal(await radio.getAttribute("aria-checked"), "true");
          bounds.push(await dialog.boundingBox());
        }
        for (const spacing of ["Tight line spacing", "Default line spacing", "Wide line spacing"]) {
          await group("Line spacing").getByRole("radio", { name: spacing, exact: true }).click(); await settle(page);
          bounds.push(await dialog.boundingBox());
        }
        const drift = Object.fromEntries(["x", "y", "width", "height"].map(key => [key, Math.max(...bounds.map(bound => Math.abs(bound[key] - rect[key])))]));
        const mode = `${theme}-${expressive ? "expressive" : "standard"}-${viewport.name}-reader-settings`;
        console.log(`${mode}: ${JSON.stringify({ rect, drift })}`);
        if (!baseline) {
          assert.ok(Object.values(drift).every(value => value < 0.5), `${mode}: preference changes move the panel`);
          assert.equal(await dialog.getByLabel("Type specimen", { exact: true }).count(), 0);
        }
        assert.ok(rect.y >= 0 && rect.y + rect.height <= viewport.height + 0.5, `${mode}: stays in viewport`);
        // Selecting the last control must remain possible in short windows.
        const amoled = dialog.getByRole("switch", { name: "Reader AMOLED black", exact: true });
        await amoled.scrollIntoViewIfNeeded();
        const target = await amoled.boundingBox();
        assert.ok(target.y >= rect.y && target.y + target.height <= rect.y + rect.height + 0.5);
        await group("Text size").getByRole("radio", { name: "Extra large", exact: true }).scrollIntoViewIfNeeded();
        await capture(page, mode);
        results.interactions.push(`${mode}: 4 sizes, 5 typefaces, 3 spacings, stable panel and reachable controls`);
      }
      await page.setViewportSize({ width: 390, height: 844 }); await settle(page);
      const size = group("Text size").getByRole("radio", { name: "Extra large", exact: true });
      await size.focus(); await size.press("Home"); await settle(page);
      assert.equal(await group("Text size").getByRole("radio", { name: "Small", exact: true }).getAttribute("aria-checked"), "true");
      await page.keyboard.press("Escape"); await settle(page);
      assert.equal(await dialog.count(), 0);
      const metrics = await page.getByText("Plain reader paragraph for contrast.", { exact: true }).first().evaluate(element => {
        const style = getComputedStyle(element);
        return { size: parseFloat(style.fontSize), font: style.fontFamily, lineHeight: parseFloat(style.lineHeight) };
      });
      assert.equal(metrics.size, 15);
      assert.ok(metrics.font.includes("NVJost"), JSON.stringify(metrics));
      assert.ok(metrics.lineHeight > 25, JSON.stringify(metrics));
      await page.emulateMedia({ reducedMotion: "reduce" });
      await button(page, "Reader settings").click(); await settle(page);
      assert.equal(await group("Text size").getByRole("radio", { name: "Small", exact: true }).getAttribute("aria-checked"), "true");
      await page.keyboard.press("Escape"); await settle(page);
      assert.equal(await dialog.count(), 0);
      results.interactions.push(`${theme}-${expressive}: keyboard selection, article typography, retained choices and reduced-motion dismissal`);
    } finally { await context.close(); }
  }
}
