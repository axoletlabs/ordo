import assert from "node:assert/strict";
import { test } from "node:test";
import {
  CHEVRON_BACK_ICON_SIZE,
  CHEVRON_BACK_TIP_INSET,
  FLOATING_RAIL_EDGE,
  FLOATING_RAIL_GAP,
  ROW_ICON_FRAME,
  ROW_ICON_GLYPH,
  ROW_INSET,
  SCREEN_RAIL,
  chevronBackTipShift,
  columnContentInset,
  contentInset,
  sceneEdgeInsets,
  sceneLeadingChrome,
} from "./alignment.ts";

test("the screen rail is 16, and a cutout replaces it instead of stacking", () => {
  assert.equal(SCREEN_RAIL, 16);
  assert.equal(contentInset(0), SCREEN_RAIL);
  assert.equal(contentInset(47), 47);
  assert.equal(columnContentInset(0, 390, 720), SCREEN_RAIL);
  assert.equal(columnContentInset(47, 390, 720), 47);
});

test("a centered column does not pad for a cutout it already clears", () => {
  assert.equal(columnContentInset(0, 1280, 720), SCREEN_RAIL);
  assert.equal(columnContentInset(47, 1280, 720), SCREEN_RAIL);
  // 40px of margin, 80px cutout: 40px of the column is still unsafe.
  assert.equal(columnContentInset(80, 800, 720), 40);
});

test("list rows share one well, one glyph, and one inset", () => {
  assert.equal(ROW_INSET, SCREEN_RAIL);
  assert.equal(ROW_ICON_FRAME, 40);
  assert.equal(ROW_ICON_GLYPH, 24);
});

test("a side rail narrows the scene and clears the leading cutout", () => {
  assert.equal(
    sceneLeadingChrome({ sideNavigation: false, floating: false, railWidth: 96, safeLeading: 47 }),
    0,
  );
  assert.equal(
    sceneLeadingChrome({ sideNavigation: true, floating: false, railWidth: 96, safeLeading: 47 }),
    96 + 47,
  );
  assert.equal(
    sceneLeadingChrome({ sideNavigation: true, floating: true, railWidth: 96, safeLeading: 47 }),
    47 + 96 + FLOATING_RAIL_GAP,
  );
  assert.equal(
    sceneLeadingChrome({ sideNavigation: true, floating: true, railWidth: 96, safeLeading: 0 }),
    FLOATING_RAIL_EDGE + 96 + FLOATING_RAIL_GAP,
  );
  assert.deepEqual(sceneEdgeInsets(true, 47, 20), { leading: 0, trailing: 20 });
  assert.deepEqual(sceneEdgeInsets(false, 47, 20), { leading: 47, trailing: 20 });
});

test("a trailing cutout is cleared from the scene, not the full window", () => {
  const windowWidth = 844;
  const scene = windowWidth - sceneLeadingChrome({
    sideNavigation: true,
    floating: false,
    railWidth: 96,
    safeLeading: 0,
  });
  // The window still looks like it has margin around a 720 column, so it
  // would skip a 47px trailing cutout. The scene does not have that margin.
  assert.equal(columnContentInset(47, windowWidth, 720), SCREEN_RAIL);
  assert.equal(columnContentInset(47, scene, 720), 33);
});

test("the back chevron tip sits on the leading edge of its hit target", () => {
  const control = 32;
  const shift = chevronBackTipShift(control);
  const iconLeft = (control - CHEVRON_BACK_ICON_SIZE) / 2 + shift;
  assert.equal(iconLeft + CHEVRON_BACK_TIP_INSET, 0);
});
