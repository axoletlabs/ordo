import assert from "node:assert/strict";
import { test } from "node:test";
import { hapticPlayFor, mergeHaptic, shouldPlayHaptic } from "./haptic-policy.ts";

test("same-turn tap plus confirmation keeps a single confirmation", () => {
  assert.equal(mergeHaptic("light", "success"), "success");
  assert.equal(mergeHaptic("light", "error"), "error");
  assert.equal(mergeHaptic("light", "medium"), "medium");
});

test("menu tap plus a weaker picker tick keeps the tap", () => {
  assert.equal(mergeHaptic("light", "selection"), "light");
});

test("a second impact on the same gesture is dropped", () => {
  assert.equal(shouldPlayHaptic("success", "light", 20), false);
  assert.equal(shouldPlayHaptic("error", "medium", 40), false);
  assert.equal(shouldPlayHaptic("success", "light", 200), true);
});

test("pattern and picker ticks still fire in quick succession", () => {
  assert.equal(shouldPlayHaptic("selection", "selection", 16), true);
});

test("outcomes never use the two-tick notification styles", () => {
  assert.deepEqual(hapticPlayFor("success"), { type: "impact", style: "light" });
  assert.deepEqual(hapticPlayFor("warning"), { type: "impact", style: "light" });
  assert.deepEqual(hapticPlayFor("error"), { type: "impact", style: "light" });
});

test("everyday taps are quieter than confirmations", () => {
  assert.deepEqual(hapticPlayFor("light"), { type: "impact", style: "soft" });
  assert.deepEqual(hapticPlayFor("medium"), { type: "impact", style: "light" });
  assert.deepEqual(hapticPlayFor("selection"), { type: "selection" });
});
