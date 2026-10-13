import assert from "node:assert/strict";
import { test } from "node:test";
import { selectionActionLayout, selectionActionPositions } from "./selection-action-layout.ts";

const bookmarkKeys = ["read", "move", "more", "delete"];

test("Delete stays right-anchored across all selection kinds", () => {
  for (const width of [272, 342, 928]) {
    for (const keys of [bookmarkKeys, ["pin", "delete"], ["delete"]]) {
      const layout = selectionActionLayout(keys, width);
      assert.equal(layout.delete!.right, 0);
      assert.ok(Math.abs(Object.values(layout).reduce((sum, slot) => sum + slot.width, 0) + (keys.length - 1) * 8 - width) < 0.0001);
    }
  }
});

test("a lone Delete fills the entire available toolbar width", () => {
  assert.deepEqual(selectionActionLayout(["delete"], 342, "delete", true), { delete: { right: 0, width: 342 } });
});

test("pressed expansion uses 15% and compresses only adjacent actions", () => {
  const resting = selectionActionLayout(bookmarkKeys, 342);
  const pressed = selectionActionLayout(bookmarkKeys, 342, "move", true);
  assert.ok(Math.abs(pressed.move!.width - resting.move!.width * 1.15) < 0.0001);
  assert.equal(pressed.delete!.width, resting.delete!.width);
  assert.ok(pressed.read!.width < resting.read!.width);
  assert.ok(pressed.more!.width < resting.more!.width);
  assert.equal(pressed.read!.width, pressed.more!.width);
});

test("compressed buttons keep 48dp targets on a narrow screen", () => {
  // 220dp squeezes four pills to a 49dp base so pressed compression binds at
  // the floor; 272dp is the usual portrait budget.
  for (const width of [220, 272]) {
    for (const key of bookmarkKeys) {
      const layout = selectionActionLayout(bookmarkKeys, width, key, true);
      assert.ok(Object.values(layout).every(slot => slot.width >= 48), `width ${width}, pressed ${key}`);
      assert.equal(layout.delete!.right, 0);
    }
  }
});

test("a disappearing pressed key does not distort the replacement layout", () => {
  assert.deepEqual(selectionActionLayout(["delete"], 342, "copy", true), selectionActionLayout(["delete"], 342));
});

test("reduced motion disables pressed-width expansion", () => {
  assert.deepEqual(selectionActionLayout(bookmarkKeys, 342, "read", false), selectionActionLayout(bookmarkKeys, 342));
});

test("spring positions are a flat numeric object matching the right-anchored layout", () => {
  const positions = selectionActionPositions(bookmarkKeys, 342);
  const layout = selectionActionLayout(bookmarkKeys, 342);
  assert.equal(Object.keys(positions).length, bookmarkKeys.length * 2);
  for (const key of bookmarkKeys) {
    assert.equal(positions[`${key}:right`], layout[key]!.right);
    assert.equal(positions[`${key}:width`], layout[key]!.width);
  }
  assert.deepEqual(selectionActionPositions([], 342), {});
});
