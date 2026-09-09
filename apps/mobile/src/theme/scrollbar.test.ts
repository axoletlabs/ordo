import assert from "node:assert/strict";
import { test } from "node:test";
import { inkAlpha, scrollThumbLayout, scrollbarColors, scrollViewShouldFill } from "./scrollbar.ts";
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
  assert.match(track, /^rgba\(21,20,15,/);
  assert.ok(!thumb.includes("0,0,0"));
});

test("dark scrollbar uses cream ink so it reads on warm dark surfaces", () => {
  const { thumb } = scrollbarColors(stubPalette({ mode: "dark", amoled: false, text: "#EBDDB2" }));
  assert.match(thumb, /^rgba\(235,221,178,/);
});

test("AMOLED scrollbar is a light gray, not black-on-black", () => {
  const { thumb, track } = scrollbarColors(stubPalette({ mode: "dark", amoled: true, text: "#E0E0E0" }));
  assert.match(thumb, /^rgba\(214,214,214,/);
  assert.ok(Number.parseFloat(thumb.slice(thumb.lastIndexOf(",") + 1)) >= 0.5);
  assert.notEqual(track, "transparent");
});

test("maxHeight-only hosts do not flex-fill (shrink-wrapped menus)", () => {
  assert.equal(scrollViewShouldFill(undefined), false);
  assert.equal(scrollViewShouldFill({ maxHeight: 240 }), false);
  assert.equal(scrollViewShouldFill({ flex: 1 }), true);
  assert.equal(scrollViewShouldFill({ height: 400 }), true);
});

test("scrollThumbLayout hides when content fits", () => {
  assert.equal(scrollThumbLayout(400, 400, 0, 384), null);
  assert.equal(scrollThumbLayout(400, 399, 0, 384), null);
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
