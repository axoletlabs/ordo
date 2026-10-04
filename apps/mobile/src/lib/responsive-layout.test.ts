import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { responsiveLayout } from "./responsive-layout.ts";

test("portrait retains the stacked library header", () => {
  assert.deepEqual(responsiveLayout(390, 844), {
    isLandscape: false, isTablet: false, isWide: false,
    compactHeight: false, inlineLibraryHeader: false, showLibraryTitle: false,
  });
});

test("phone landscape uses one compact app bar, including below the wide breakpoint", () => {
  for (const [width, height] of [[844, 390], [667, 375], [568, 320]]) {
    const traits = responsiveLayout(width, height);
    assert.equal(traits.isLandscape, true);
    assert.equal(traits.compactHeight, true);
    assert.equal(traits.inlineLibraryHeader, true);
    assert.equal(traits.showLibraryTitle, width >= 600);
  }
});

test("tablet and desktop use an inline header without short-window density", () => {
  for (const [width, height] of [[768, 1024], [1280, 800], [1920, 1080]]) {
    const traits = responsiveLayout(width, height);
    assert.equal(traits.isTablet, true);
    assert.equal(traits.inlineLibraryHeader, true);
    assert.equal(traits.compactHeight, false);
  }
});

test("large text gets room instead of a crowded title beside search", () => {
  assert.equal(responsiveLayout(844, 390, 1.5).showLibraryTitle, false);
  assert.equal(responsiveLayout(768, 1024, 1.5).inlineLibraryHeader, false);
  assert.equal(responsiveLayout(390, 640, 1.5).compactHeight, true);
});

test("keyboard-sized and resized windows stay usable", () => {
  assert.equal(responsiveLayout(390, 300).inlineLibraryHeader, true);
  assert.equal(responsiveLayout(600, 900).inlineLibraryHeader, true);
  assert.equal(responsiveLayout(599, 900).inlineLibraryHeader, false);
  assert.equal(responsiveLayout(844, 390, 0.8).showLibraryTitle, true);
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
