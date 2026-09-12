import assert from "node:assert/strict";
import { test } from "node:test";
import { BROWSER_PTR_THRESHOLD } from "./in-app-browser.ts";
import { listRefreshHudDy, listRefreshOverscrollDy } from "./list-refresh.ts";

test("list refresh HUD holds at the website rest point while refreshing", () => {
  assert.equal(listRefreshHudDy(true, 0), BROWSER_PTR_THRESHOLD);
  assert.equal(listRefreshHudDy(true, 12), BROWSER_PTR_THRESHOLD);
  assert.equal(listRefreshHudDy(false, 24), 24);
  assert.equal(listRefreshHudDy(false, -8), 0);
});

test("list overscroll is the pull past the top", () => {
  assert.equal(listRefreshOverscrollDy(12), 0);
  assert.equal(listRefreshOverscrollDy(0), 0);
  assert.equal(listRefreshOverscrollDy(-40), 40);
});
