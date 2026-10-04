import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { responsiveLayout } from "./responsive-layout.ts";

test("portrait uses comfortable content density", () => {
  assert.deepEqual(responsiveLayout(390, 844), {
    isLandscape: false, isTablet: false, isWide: false,
    compactHeight: false,
  });
});

test("phone landscape uses compact density, including below the wide breakpoint", () => {
  for (const [width, height] of [[844, 390], [667, 375], [568, 320]]) {
    const traits = responsiveLayout(width, height);
    assert.equal(traits.isLandscape, true);
    assert.equal(traits.compactHeight, true);
  }
});

test("tablet and desktop retain comfortable density", () => {
  for (const [width, height] of [[768, 1024], [1280, 800], [1920, 1080]]) {
    const traits = responsiveLayout(width, height);
    assert.equal(traits.isTablet, true);
    assert.equal(traits.compactHeight, false);
  }
});

test("large text adapts vertical density", () => {
  assert.equal(responsiveLayout(390, 640, 1.5).compactHeight, true);
});

test("keyboard-sized and resized windows stay usable", () => {
  assert.equal(responsiveLayout(390, 300).compactHeight, true);
  assert.equal(responsiveLayout(600, 900).isWide, true);
  assert.equal(responsiveLayout(599, 900).isWide, false);
  assert.equal(responsiveLayout(844, 390, 0.8).compactHeight, true);
});

test("library uses one search app bar in every orientation", () => {
  const source = readFileSync(new URL("../components/bookmarks/LibraryHeader.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(source, /inlineLibraryHeader|showLibraryTitle|styles\.toolbar/);
  assert.match(source, /onFocusChange=\{setFocused\}/);
  assert.match(source, /motion\.reducedMotion \? 0 : 180/);
  assert.match(source, /const collapseTools = focused;/);
  assert.match(source, /rightAccessory=\{editing \?/);
  assert.match(source, /useSearchBack\(editing/);
});

for (const screen of ["(tabs)/index", "folder/[id]", "tags/[id]"]) {
  test(`${screen} keeps one list and opens the reader through stack navigation`, () => {
    const source = readFileSync(new URL(`../../app/(app)/${screen}.tsx`, import.meta.url), "utf8");
    assert.doesNotMatch(source, /hasDetailPane|splitPane|ReaderPane/);
    assert.match(source, /router\.push\(`\/reader\//);
    assert.match(source, /useLegacyReaderLink\(/);
    assert.match(source, /layout\.maxContentWidth/);
  });
}
