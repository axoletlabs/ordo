import assert from "node:assert/strict";
import { test } from "node:test";
import {
  inkAlpha,
  SCROLLBAR_END_INSET,
  SCROLLBAR_FAB_CLEARANCE,
  listScrollOverlayClearance,
  scrollBarBottomInset,
  scrollThumbLayout,
  scrollbarColors,
  scrollViewShouldFill,
} from "./scrollbar.ts";
import type { Palette } from "./theme.ts";

function stubPalette(partial: Pick<Palette, "mode" | "amoled" | "text">): Palette {
  return partial as Palette;
}

test("inkAlpha converts hex to rgba", () => {
  assert.equal(inkAlpha("#15140F", 0.32), "rgba(21,20,15,0.32)");
});

test("light scrollbar uses ink, not a black OS overlay", () => {
  const { thumb, track } = scrollbarColors(stubPalette({ mode: "light", amoled: false, text: "#15140F" }));
  assert.match(thumb, /^rgba\(21,20,15,/);
  assert.equal(track, "transparent");
  assert.ok(!thumb.includes("0,0,0"));
});

test("dark scrollbar uses cream ink so it reads on warm dark surfaces", () => {
  const { thumb, track } = scrollbarColors(stubPalette({ mode: "dark", amoled: false, text: "#EBDDB2" }));
  assert.match(thumb, /^rgba\(235,221,178,/);
  assert.equal(track, "transparent");
});

test("AMOLED scrollbar is a light gray mark, with no track", () => {
  const { thumb, track } = scrollbarColors(stubPalette({ mode: "dark", amoled: true, text: "#E0E0E0" }));
  assert.match(thumb, /^rgba\(224,224,224,/);
  assert.ok(Number.parseFloat(thumb.slice(thumb.lastIndexOf(",") + 1)) >= 0.3);
  assert.equal(track, "transparent");
});

test("maxHeight-only hosts do not flex-fill (shrink-wrapped menus)", () => {
  assert.equal(scrollViewShouldFill(undefined), false);
  assert.equal(scrollViewShouldFill({ maxHeight: 240 }), false);
  assert.equal(scrollViewShouldFill({ height: null }), false);
  assert.equal(scrollViewShouldFill({ flex: 1 }), true);
  assert.equal(scrollViewShouldFill({ height: 400 }), true);
});

test("scrollThumbLayout hides when content fits", () => {
  assert.equal(scrollThumbLayout(400, 400, 0, 384), null);
  assert.equal(scrollThumbLayout(400, 399, 0, 384), null);
});

test("listScrollOverlayClearance ignores a docked tab bar", () => {
  assert.equal(
    listScrollOverlayClearance({
      hideBottomNav: false,
      selectionClearance: 90,
      floatingDockVisible: true,
      floatingDockClearance: 118,
      dockedTabScene: true,
      safeBottomClearance: 50,
    }),
    118,
  );
  assert.equal(
    listScrollOverlayClearance({
      hideBottomNav: false,
      selectionClearance: 90,
      floatingDockVisible: false,
      floatingDockClearance: 118,
      dockedTabScene: true,
      safeBottomClearance: 50,
    }),
    0,
  );
  assert.equal(
    listScrollOverlayClearance({
      hideBottomNav: true,
      selectionClearance: 90,
      floatingDockVisible: false,
      floatingDockClearance: 118,
      dockedTabScene: true,
      safeBottomClearance: 50,
    }),
    90,
  );
  assert.equal(
    listScrollOverlayClearance({
      hideBottomNav: false,
      selectionClearance: 90,
      floatingDockVisible: false,
      floatingDockClearance: 118,
      dockedTabScene: false,
      safeBottomClearance: 50,
    }),
    50,
  );
});

test("scrollBarBottomInset stays above floating chrome and the FAB", () => {
  assert.equal(scrollBarBottomInset(0), SCROLLBAR_END_INSET);
  assert.equal(scrollBarBottomInset(8), SCROLLBAR_END_INSET);
  assert.equal(scrollBarBottomInset(118), 118);
  assert.equal(scrollBarBottomInset(118, true), 118 + SCROLLBAR_FAB_CLEARANCE);
  assert.equal(scrollBarBottomInset(0, true), SCROLLBAR_FAB_CLEARANCE);
});

test("scrollThumbLayout maps offset onto the track", () => {
  const mid = scrollThumbLayout(200, 400, 100, 200, 40);
  assert.ok(mid);
  assert.equal(mid.thumb, 100);
  assert.equal(mid.y, 50);

  const start = scrollThumbLayout(200, 400, 0, 200, 40);
  assert.equal(start?.y, 0);

  const end = scrollThumbLayout(200, 400, 200, 200, 40);
  assert.equal(end?.y, 100);
});
