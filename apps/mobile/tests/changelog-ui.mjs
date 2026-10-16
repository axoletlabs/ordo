/** Built-web fixtures; no live API calls. Run with ORDO_UI_URL and PLAYWRIGHT_MODULE. */
import assert from "node:assert/strict";
import { mkdir, readFile } from "node:fs/promises";
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? "playwright");
const base = process.env.ORDO_UI_URL ?? "http://127.0.0.1:8257";
const output = process.env.ORDO_UI_OUTPUT ?? "/tmp/opencode/ordo-changelog-shots";
await mkdir(output, { recursive: true });
const notes = await readFile(new URL("../../../CHANGELOG.md", import.meta.url), "utf8");
const currentBody = notes.split("## 0.3.0 Preview 1\n")[1].split("\n## 0.2.0\n")[0];
const oldBody = notes.split("## 0.2.0 Preview 1\n")[1].split("\n## 0.1.0\n")[0];
const releases = [
  { tag_name: "v0.4.0", published_at: "2026-10-16T12:00:00Z", body: "A future release, not installed yet." },
  { tag_name: "v0.3.0", published_at: "2026-10-15T12:00:00Z", body: currentBody },
  { tag_name: "v0.2.0", published_at: "2026-10-01T12:00:00Z", body: oldBody },
];
const user = { id: "changelog-test", displayName: "Alex", email: "alex@example.test", emailVerified: true,
  mfaEnabled: false, createdAt: "2026-10-01T12:00:00Z", preferences: { theme: "system" } };
const tokens = { accessToken: "fixture", refreshToken: "fixture-refresh", expiresIn: 3600 };
const browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM, args: ["--no-sandbox"] });
const errors = [];

async function setup({ theme = "dark", expressive = true, viewport = { width: 390, height: 844 }, reducedMotion = "no-preference", feed = releases, feedStatus = 200 } = {}) {
  const context = await browser.newContext({ viewport, colorScheme: theme, reducedMotion });
  await context.addInitScript(({ theme, expressive, user, tokens }) => {
    if (!localStorage.getItem("ordo.settings")) localStorage.setItem("ordo.settings", JSON.stringify({ themeMode: theme, expressive, materialYouColors: false }));
    if (!localStorage.getItem("secure.ordo.auth")) localStorage.setItem("secure.ordo.auth", JSON.stringify({ user, tokens, accessExpiresAt: Date.now() + 3_600_000 }));
  }, { theme, expressive, user, tokens });
  const page = await context.newPage();
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.origin === new URL(base).origin) return route.continue();
    let body = [];
    if (url.hostname === "api.github.com") body = url.pathname.endsWith("/latest") ? feed[0] ?? {} : feed;
    else if (url.pathname === "/api/server/info") body = { name: "ordo", version: "0.3.0", mfaRequired: false, registrationEnabled: true };
    else if (url.pathname === "/api/auth/me") body = user;
    else if (url.pathname === "/api/auth/refresh") body = { user, tokens };
    else if (url.pathname === "/api/bookmarks") body = { items: [], hasMore: false, nextCursor: null };
    else if (url.pathname === "/api/bookmarks/extraction-progress") body = { pending: 0, total: 0 };
    await route.fulfill({ status: url.hostname === "api.github.com" ? feedStatus : 200,
      contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify(body) });
  });
  return { context, page };
}

const dialog = (page) => page.getByRole("dialog", { name: "What's new", exact: true });
async function visibleDialog(page) {
  const panel = dialog(page);
  await panel.waitFor({ state: "visible" }).catch(async (error) => {
    await page.screenshot({ path: `${output}/failure.png` });
    console.error(await page.locator("body").innerText(), errors);
    throw error;
  });
  await page.waitForTimeout(400);
  return panel;
}
async function assertContained(page, panel) {
  const viewport = page.viewportSize();
  for (const locator of [panel, panel.getByRole("button", { name: "Got it", exact: true }), panel.getByRole("button", { name: "v0.2.0", exact: true })]) {
    const box = await locator.boundingBox();
    assert.ok(box && box.y >= 0 && box.y + box.height <= viewport.height + 1, `Clipped vertically: ${JSON.stringify(box)}`);
  }
  for (const pill of await panel.getByRole("button", { name: /^v0\./ }).all()) assert.ok((await pill.boundingBox()).height >= 48);
}

try {
  for (const theme of ["light", "dark"]) for (const expressive of [false, true]) {
    for (const viewport of [{ width: 320, height: 740 }, { width: 390, height: 844 }, { width: 1280, height: 900 }, { width: 844, height: 390 }]) {
      const { context, page } = await setup({ theme, expressive, viewport, reducedMotion: expressive ? "reduce" : "no-preference" });
      await page.goto(base);
      const panel = await visibleDialog(page);
      await panel.getByText("Installed", { exact: true }).waitFor();
      assert.ok((await panel.innerText()).includes("Ordo v0.3.0"), "Automatically select installed notes, not a newer release");
      await assertContained(page, panel);
      const highlights = panel.getByTestId("changelog-highlights");
      const listGeometry = await highlights.evaluate((group) => {
        const rows = [...group.children];
        const first = rows[0];
        const text = first.firstElementChild;
        const style = getComputedStyle(first);
        return {
          content: first.textContent,
          textWidth: text.getBoundingClientRect().width,
          width: group.getBoundingClientRect().width,
          topCorner: style.borderTopLeftRadius,
          innerCorner: getComputedStyle(rows[1]).borderTopLeftRadius,
          lastCorner: getComputedStyle(rows.at(-1)).borderBottomLeftRadius,
          divider: parseFloat(style.borderBottomWidth),
          fontSize: getComputedStyle(text).fontSize,
          background: style.backgroundColor,
          horizontalOverflow: group.scrollWidth > group.clientWidth,
        };
      });
      assert.equal(listGeometry.content, "Faster long-article reading and smoother large libraries.", "No decorative ticks or icon column");
      assert.ok(listGeometry.textWidth >= listGeometry.width - 33, "Notes use the full list width, with only 16dp text rails");
      assert.equal(listGeometry.fontSize, "16px", "Keep the Material body-large role; don't shrink copy to fit");
      assert.equal(listGeometry.horizontalOverflow, false);
      if (expressive) {
        assert.equal(listGeometry.topCorner, "16px");
        assert.equal(listGeometry.innerCorner, "4px");
        assert.equal(listGeometry.lastCorner, "16px");
        assert.equal(listGeometry.divider, 0);
        assert.notEqual(listGeometry.background, "rgba(0, 0, 0, 0)");
      } else {
        assert.equal(listGeometry.topCorner, "0px");
        assert.ok(listGeometry.divider > 0, "Baseline lists use dividers, not nested cards");
      }
      const heading = await panel.getByRole("heading", { name: "What's new", exact: true }).boundingBox();
      const intro = await panel.getByText("The first preview of the 0.3.0 cycle, focused on performance and day-to-day reliability.", { exact: true }).boundingBox();
      assert.ok(intro.y - heading.y < 112, "Release metadata stays compact, including narrow portrait layouts");
      if (viewport.height < 480) {
        const firstNote = await panel.getByText("Faster long-article reading and smoother large libraries.", { exact: true }).boundingBox();
        const history = await panel.getByRole("button", { name: "v0.3.0", exact: true }).boundingBox();
        assert.ok(firstNote.y + firstNote.height <= history.y, "Landscape keeps the first change visible, not just the intro");
      }
      const footerBefore = await panel.getByRole("button", { name: "Got it", exact: true }).boundingBox();
      const notesPane = panel.locator("div").filter({ has: page.getByText("Faster long-article reading and smoother large libraries.", { exact: true }) });
      await notesPane.last().evaluate((node) => {
        let parent = node;
        while (parent && (parent.scrollHeight <= parent.clientHeight + 1 || !["auto", "scroll"].includes(getComputedStyle(parent).overflowY))) parent = parent.parentElement;
        assertScrollable(parent);
        function assertScrollable(node) {
          if (!node) throw new Error("Long notes need an accessible scroller");
          node.scrollTop = node.scrollHeight;
          if (node.scrollTop === 0) throw new Error("Release notes did not scroll");
        }
      });
      const footerAfter = await panel.getByRole("button", { name: "Got it", exact: true }).boundingBox();
      assert.equal(footerBefore.y, footerAfter.y, "Footer must not scroll with notes");
      await panel.getByRole("button", { name: "v0.2.0", exact: true }).click();
      await panel.getByText("Design and navigation", { exact: true }).waitFor();
      await panel.getByRole("button", { name: "v0.3.0", exact: true }).click();
      assert.equal(await panel.getByText("Faster long-article reading and smoother large libraries.", { exact: true }).evaluate((node) => {
        let parent = node.parentElement;
        while (parent && !["auto", "scroll"].includes(getComputedStyle(parent).overflowY)) parent = parent.parentElement;
        return parent?.scrollTop;
      }), 0, "Changing release resets notes to the top");
      await page.screenshot({ path: `${output}/${theme}-${expressive ? "expressive" : "standard"}-${viewport.width}.png` });
      for (let tab = 0; tab < 8; tab++) {
        await page.keyboard.press("Tab");
        assert.ok(await panel.evaluate((node) => node.contains(document.activeElement)), "Tab focus stays in the panel");
      }
      await panel.getByRole("button", { name: "Got it", exact: true }).click();
      await dialog(page).waitFor({ state: "hidden" });
      const seenKey = await page.evaluate(() => JSON.parse(localStorage.getItem("ordo.changelogSeenBuild")));
      assert.ok(seenKey.startsWith("0.3.0:"));
      await page.reload();
      await page.getByRole("button", { name: "Account and settings", exact: true }).waitFor();
      await page.waitForTimeout(500);
      assert.equal(await dialog(page).count(), 0, "Do not announce the same build on another launch");
      await page.goto(`${base}/settings/about`);
      await page.getByRole("button", { name: "Changelog", exact: true }).click();
      const manual = await visibleDialog(page);
      await assertContained(page, manual);
      await page.keyboard.press("Escape");
      await dialog(page).waitFor({ state: "hidden" });
      await page.getByRole("button", { name: "Changelog", exact: true }).click();
      await visibleDialog(page);
      await page.keyboard.press("Escape");
      await dialog(page).waitFor({ state: "hidden" });
      if (viewport.width === 390) {
        await page.evaluate(() => localStorage.setItem("ordo.changelogSeenBuild", JSON.stringify("0.2.0:previous-build")));
        await page.goto(base);
        await visibleDialog(page);
        assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem("ordo.changelogSeenBuild"))), seenKey,
          "A newer installed bundle announces again and remembers the new build");
      }
      await context.close();
    }
  }
  // An unavailable feed must not show or mark an empty automatic dialog.
  const { context, page } = await setup({ feed: [] });
  await page.goto(base);
  await page.getByRole("button", { name: "Account and settings", exact: true }).waitFor();
  await page.waitForTimeout(500);
  assert.equal(await dialog(page).count(), 0);
  assert.equal(await page.evaluate(() => localStorage.getItem("ordo.changelogSeenBuild")), null);
  await page.goto(`${base}/settings/about`);
  await page.getByRole("button", { name: "Changelog", exact: true }).click();
  await (await visibleDialog(page)).getByText("Published updates will show up here.", { exact: true }).waitFor();
  await context.close();
  const failed = await setup({ feedStatus: 403 });
  await failed.page.goto(base);
  await failed.page.getByRole("button", { name: "Account and settings", exact: true }).waitFor();
  await failed.page.waitForTimeout(500);
  assert.equal(await dialog(failed.page).count(), 0);
  assert.equal(await failed.page.evaluate(() => localStorage.getItem("ordo.changelogSeenBuild")), null);
  await failed.page.goto(`${base}/settings/about`);
  await failed.page.getByRole("button", { name: "Changelog", exact: true }).click();
  const failedPanel = await visibleDialog(failed.page);
  await failedPanel.getByText("GitHub is limiting requests. Try again in a few minutes.", { exact: true }).waitFor();
  await failedPanel.getByRole("button", { name: "Try again", exact: true }).click();
  await failedPanel.getByRole("button", { name: "Got it", exact: true }).click();
  await dialog(failed.page).waitFor({ state: "hidden" });
  await failed.context.close();
  assert.deepEqual(errors, []);
  console.log("Changelog UI: 16 theme/layout cases, full-width icon-free lists, Material type/shape roles, compact header, fixed footer, scroll reset, focus trap, keyboard dismissal, once-per-build persistence/replay, empty feed and rate-limit retry passed.");
} finally {
  await browser.close();
}
