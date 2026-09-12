import assert from "node:assert/strict";
import { test } from "node:test";
import { BROWSER_PTR_THRESHOLD } from "./in-app-browser.ts";
import {
  PTR_THRESHOLD,
  listIsAtTop,
  listRefreshOverscrollDy,
  ptrHudOpacity,
  ptrHudScale,
  ptrHudTranslateY,
  ptrProgress,
  ptrPullRotation,
  shouldCommitPtr,
} from "./pull-refresh.ts";

test("lists and the in-app browser share one arming distance", () => {
  assert.equal(PTR_THRESHOLD, BROWSER_PTR_THRESHOLD);
});

test("refresh does not start until the pull clears the safe distance", () => {
  assert.equal(shouldCommitPtr(0, false), false);
  assert.equal(shouldCommitPtr(PTR_THRESHOLD - 1, false), false);
  assert.equal(shouldCommitPtr(PTR_THRESHOLD, false), true);
  assert.equal(shouldCommitPtr(200, true), false);
});

test("HUD follows the pull, then rubber-bands past the threshold", () => {
  assert.equal(ptrHudTranslateY(0), 0);
  assert.ok(ptrHudTranslateY(40) > 0);
  assert.ok(ptrHudTranslateY(40) < ptrHudTranslateY(PTR_THRESHOLD));
  assert.ok(ptrHudTranslateY(PTR_THRESHOLD + 40) > ptrHudTranslateY(PTR_THRESHOLD));
  assert.ok(ptrHudTranslateY(400) <= 72);
});

test("scale and opacity grow across the pull and lock while refreshing", () => {
  assert.equal(ptrHudOpacity(0, false), 0);
  assert.ok(ptrHudOpacity(20, false) > 0);
  assert.equal(ptrHudOpacity(48, false), 1);
  assert.equal(ptrHudOpacity(0, true), 1);
  assert.ok(ptrHudScale(0, false) < 1);
  assert.equal(ptrHudScale(PTR_THRESHOLD, false), 1);
  assert.equal(ptrHudScale(0, true), 1);
});

test("pull rotation tracks progress until a refresh is committed", () => {
  assert.equal(ptrProgress(0), 0);
  assert.equal(ptrProgress(PTR_THRESHOLD), 1);
  assert.equal(ptrPullRotation(0), 0);
  assert.equal(ptrPullRotation(PTR_THRESHOLD), 270);
});

test("list overscroll is the pull past the top", () => {
  assert.equal(listRefreshOverscrollDy(12), 0);
  assert.equal(listRefreshOverscrollDy(0), 0);
  assert.equal(listRefreshOverscrollDy(-40), 40);
  assert.equal(listIsAtTop(0), true);
  assert.equal(listIsAtTop(8), false);
});
