import assert from "node:assert/strict";

/** Frame-by-frame coverage of the multi-select toolbar, including interrupted handoffs. */
export async function selectionActionMotionMatrix({ browser, fixture, login, button, settle, capture, results }) {
  results.toolbarMotion = [];
  const baseline = !!process.env.ORDO_UI_SELECTION_BASELINE;
  for (const theme of ["dark", "light"]) for (const expressive of [false, true]) {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: theme });
    await context.addInitScript(({ theme, expressive }) => localStorage.setItem("ordo.settings", JSON.stringify({ themeMode: theme, expressive, materialYouColors: false })), { theme, expressive });
    const page = await context.newPage();
    await fixture(page); await login(page); await settle(page);
    const lead = await page.getByRole("button", { name: /^Select Building/ }).boundingBox();
    await page.mouse.move(lead.x + lead.width / 2, lead.y + lead.height / 2);
    await page.mouse.down(); await page.waitForTimeout(550); await page.mouse.up(); await settle(page);
    const folder = page.getByRole("checkbox", { name: /^Design & inspiration,/ });
    const bookmark = page.getByRole("checkbox", { name: /^Building a more expressive design system,/ });
    const mode = `${theme}-${expressive ? "expressive" : "standard"}`;
    if (theme === "dark" && expressive) await capture(page, `${mode}-selection-toolbar`);
    for (const viewport of [{ name: "portrait", width: 390, height: 844 }, { name: "landscape", width: 1280, height: 800 }]) {
      await page.setViewportSize(viewport); await settle(page);
      const sampleNextToggle = () => page.evaluate(() => {
        window.toolbarFrames = [];
        const row = [...document.querySelectorAll('[role="checkbox"]')].find(node => node.getAttribute("aria-label")?.startsWith("Design & inspiration,"));
        row.addEventListener("click", () => {
          const start = performance.now();
          const deletion = [...document.querySelectorAll('[role="button"]')].find(node => node.getAttribute("aria-label") === "Delete");
          // Count changed *layout* coordinates, rather than treating zero
          // overlap as proof of smooth rendering. Transform-only motion should
          // leave the live button and all its descendants' layout untouched.
          const toolbar = deletion.parentElement.parentElement.parentElement;
          let layoutStyleUpdates = 0;
          const previous = new WeakMap();
          const layout = node => ["width", "height", "left", "right", "top", "bottom"].map(property => node.style[property]).join("|");
          for (const node of [toolbar, ...toolbar.querySelectorAll("*")]) previous.set(node, layout(node));
          const observer = new MutationObserver(records => {
            for (const { target } of records) {
              const value = layout(target);
              if (previous.has(target) && previous.get(target) !== value) layoutStyleUpdates++;
              previous.set(target, value);
            }
          });
          observer.observe(toolbar, { subtree: true, attributes: true, attributeFilter: ["style"] });
          const sample = time => {
            const buttons = [...document.querySelectorAll('[role="button"]')].filter(node => ["Read", "Move", "More", "Pin", "Unpin", "Delete"].includes(node.getAttribute("aria-label")));
            window.toolbarFrames.push({ elapsed: time - start, layoutStyleUpdates, buttons: buttons.map(node => {
              const rect = node.getBoundingClientRect();
              const content = node.querySelector('[data-testid="material-pill-content"]')?.getBoundingClientRect();
              const cap = node.querySelector('[data-testid="material-pill-leading-cap"]')?.getBoundingClientRect();
              const trailing = node.querySelector('[data-testid="material-pill-trailing-cap"]')?.getBoundingClientRect();
              let opacity = 1;
              for (let parent = node; parent; parent = parent.parentElement) opacity *= +getComputedStyle(parent).opacity;
              return { label: node.getAttribute("aria-label"), x: rect.x, right: rect.right, width: rect.width, opacity,
                contentWidth: content?.width, capWidth: cap?.width, capHeight: cap?.height,
                capLeft: cap?.left, trailingRight: trailing?.right };
            }) });
            if (time - start < 900) requestAnimationFrame(sample);
            else observer.disconnect();
          };
          requestAnimationFrame(sample);
        }, { once: true });
      });
      await sampleNextToggle();
      const before = await button(page, "Delete").boundingBox();
      await folder.click(); await page.waitForTimeout(1000);
      const frames = await page.evaluate(() => window.toolbarFrames);
      const overlapFrames = frames.filter(frame => {
        const deleting = frame.buttons.find(item => item.label === "Delete");
        return deleting && frame.buttons.some(item => item.label !== "Delete" && item.opacity > 0.02 && item.right > deleting.x + 0.5);
      });
      const drift = Math.max(...frames.map(frame => Math.abs((frame.buttons.find(item => item.label === "Delete")?.right ?? before.x + before.width) - before.x - before.width)));
      const after = await button(page, "Delete").boundingBox();
      const overshoot = Math.max(0, ...frames.flatMap(frame => frame.buttons.filter(item => item.label === "Delete").map(item => item.width - after.width)));
      const layoutStyleUpdates = frames.at(-1).layoutStyleUpdates;
      // Paint cadence, not just geometry: count repeated widths within the
      // moving interval and record actual rAF spacing. These are WEB metrics,
      // not evidence of a native device's FPS.
      const deletionWidths = frames.map(frame => frame.buttons.find(item => item.label === "Delete")?.width);
      const movingIndices = deletionWidths.flatMap((width, index) => index && width != null && Math.abs(width - deletionWidths[index - 1]) > 0.001 ? [index] : []);
      const activeIntervals = movingIndices.length ? frames.slice(movingIndices[0], movingIndices.at(-1) + 1)
        .map((frame, index) => frame.elapsed - frames[movingIndices[0] + index - 1].elapsed).sort((a, b) => a - b) : [];
      let repeatedPaintFrames = 0;
      if (movingIndices.length) for (let index = movingIndices[0]; index <= movingIndices.at(-1); index++) {
        if (Math.abs(deletionWidths[index] - deletionWidths[index - 1]) <= 0.001) repeatedPaintFrames++;
      }
      results.toolbarMotion.push({ mode, layout: viewport.name, frames: frames.length, overlapFrames: overlapFrames.length, rightEdgeDriftPx: drift, overshootPx: overshoot, layoutStyleUpdates,
        paintedWidthUpdates: movingIndices.length, repeatedPaintFrames,
        p95ActiveFrameIntervalMs: activeIntervals[Math.floor(activeIntervals.length * 0.95)] ?? null,
        maxActiveFrameIntervalMs: activeIntervals.at(-1) ?? null, beforeWidth: before.width, afterWidth: after.width });
      if (!baseline) {
        assert.equal(overlapFrames.length, 0, `${mode}-${viewport.name}: departing actions overlap Delete`);
        assert.ok(drift < 1, `${mode}-${viewport.name}: right edge drift ${drift}`);
        assert.ok(overshoot < 1, `${mode}-${viewport.name}: expansion overshoot ${overshoot}`);
        assert.equal(layoutStyleUpdates, 0, `${mode}-${viewport.name}: expansion must not relayout each frame`);
        const deletionFrames = frames.flatMap(frame => frame.buttons.filter(item => item.label === "Delete"));
        assert.ok(deletionFrames.every(item => Math.abs(item.capWidth - 24) < 0.1 && Math.abs(item.capHeight - 48) < 0.1), "Pill ends must not stretch into ellipses");
        assert.ok(deletionFrames.every(item => Math.abs(item.capLeft - item.x) < 0.1 && Math.abs(item.trailingRight - item.right) < 0.1), "Both painted caps must meet the actual hit-tested edges");
        assert.ok(Math.max(...deletionFrames.map(item => item.contentWidth)) - Math.min(...deletionFrames.map(item => item.contentWidth)) < 0.1, "Delete icon and label must remain unscaled");
        assert.equal(await page.locator('[role="button"][aria-label="Read"]').count(), 0, "Departing slots must be removed, not only hidden");
        assert.ok(after.width > before.width * 4);
      }
      if (theme === "dark" && expressive) await capture(page, `${mode}-delete-expanded-${viewport.name}`);
      await sampleNextToggle();
      await folder.click();
      if (!baseline) {
        await page.waitForTimeout(30);
        assert.equal(await button(page, "Read").count(), 0, "Incoming controls cannot receive focus before Delete makes room");
      }
      await page.waitForTimeout(1000);
      assert.equal(await button(page, "Read").count(), 1);
      const restoring = await page.evaluate(() => window.toolbarFrames);
      results.toolbarMotion.at(-1).restoreLayoutStyleUpdates = restoring.at(-1).layoutStyleUpdates;
      if (!baseline) assert.equal(restoring.at(-1).layoutStyleUpdates, 0, `${mode}-${viewport.name}: restoration must not relayout each frame`);
      const restoreOverlapFrames = restoring.filter(frame => {
        const visible = frame.buttons.filter(item => item.opacity > 0.02);
        return visible.some((item, index) => visible.slice(index + 1).some(other => Math.min(item.right, other.right) - Math.max(item.x, other.x) > 0.5));
      }).length;
      results.toolbarMotion.at(-1).restoreOverlapFrames = restoreOverlapFrames;
      if (!baseline) assert.equal(restoreOverlapFrames, 0, `${mode}-${viewport.name}: incoming actions overlap shrinking Delete`);
      if (!baseline) {
        // Reverse the transition before its departure fade finishes, repeatedly.
        for (let index = 0; index < 6; index++) { await folder.click(); await page.waitForTimeout(25); }
        await page.waitForTimeout(1100);
        assert.equal(await button(page, "Read").count(), 1);
        assert.ok(Math.abs((await button(page, "Delete").boundingBox()).width - before.width) < 1);
        if (viewport.name === "portrait") {
          // Tags and copy live behind More, anchored to its own pill.
          const moreRect = await button(page, "More").boundingBox();
          await button(page, "More").click();
          await page.getByRole("menuitem", { name: "Add tags", exact: true }).waitFor();
          await page.getByRole("menuitem", { name: "Copy links", exact: true }).waitFor();
          await settle(page);
          const menuRect = await page.getByRole("menu").boundingBox();
          assert.ok(Math.abs(menuRect.x + menuRect.width - moreRect.x - moreRect.width) < 1, "More menu must anchor to the visible pill, not its layout canvas");
          await page.keyboard.press("Escape"); await settle(page);
          assert.equal(await page.getByRole("menu").count(), 0);
        }
        await folder.focus(); await page.keyboard.press("Space"); await page.waitForTimeout(1000);
        await button(page, "Delete").focus(); await page.keyboard.press("Enter"); await settle(page);
        await page.getByRole("dialog").waitFor(); await page.keyboard.press("Escape"); await settle(page);
        await folder.focus(); await page.keyboard.press("Space"); await page.waitForTimeout(1000);
        // Folder-only -> mixed -> bookmark-only also reintroduces entirely different keys.
        await bookmark.click(); await folder.click(); await page.waitForTimeout(1000);
        assert.equal(await page.getByRole("button", { name: /^(Unpin|Pin)$/ }).count(), 1);
        await bookmark.click(); await page.waitForTimeout(1000);
        assert.equal(await page.getByRole("button", { name: /^(Unpin|Pin)$/ }).count(), 0);
        await folder.click(); await page.waitForTimeout(1000);
        assert.equal(await button(page, "Read").count(), 1);
        // Live reduced-motion preference must finish an in-flight transition.
        await folder.click(); await page.emulateMedia({ reducedMotion: "reduce" }); await page.waitForTimeout(100);
        assert.equal(await button(page, "Read").count(), 0);
        await folder.click(); await page.waitForTimeout(100);
        assert.ok(Math.abs((await button(page, "Delete").boundingBox()).width - before.width) < 1);
        await page.emulateMedia({ reducedMotion: "no-preference" });
      }
    }
    await button(page, "Cancel selection").click();
    if (!baseline) await page.emulateMedia({ reducedMotion: "reduce" });
    await settle(page);
    assert.equal(await button(page, "Delete").count(), 0);
    results.interactions.push(`${mode}: toolbar overlap, anchoring, interruptions, keyboard, folder-only and reduced motion`);
    await context.close();
  }
}
