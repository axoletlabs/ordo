import assert from "node:assert/strict";
import { test } from "node:test";
import { panelKeyboardLift } from "./panel-keyboard-layout.ts";

test("keyboard does not move a dialog that already fits", () => {
  assert.equal(panelKeyboardLift(400, 200, 550, 16, 16), 0);
});
test("dialog moves only by the overlap, not half the keyboard height", () => {
  assert.equal(panelKeyboardLift(400, 300, 520, 16, 16), -46);
});
test("short windows keep the dialog above the keyboard and below the top inset", () => {
  const height = 288;
  const shift = panelKeyboardLift(400, height, 320, 16, 16);
  assert.equal(400 - height / 2 + shift, 16);
  assert.equal(400 + height / 2 + shift, 304);
});
