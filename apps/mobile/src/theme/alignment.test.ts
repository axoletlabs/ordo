import assert from "node:assert/strict";
import { test } from "node:test";
import {
  CHEVRON_BACK_ICON_SIZE,
  CHEVRON_BACK_TIP_INSET,
  ROW_ICON_FRAME,
  ROW_ICON_GLYPH,
  ROW_INSET,
  SCREEN_RAIL,
  chevronBackTipShift,
  columnContentInset,
  contentInset,
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
  assert.equal(ROW_ICON_FRAME, 36);
  assert.equal(ROW_ICON_GLYPH, 18);
});

test("the back chevron tip sits on the leading edge of its hit target", () => {
  const control = 32;
  const shift = chevronBackTipShift(control);
  const iconLeft = (control - CHEVRON_BACK_ICON_SIZE) / 2 + shift;
  assert.equal(iconLeft + CHEVRON_BACK_TIP_INSET, 0);
});
