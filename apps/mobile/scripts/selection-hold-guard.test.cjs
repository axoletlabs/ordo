/** Long-press release guard: a delayed synthetic press (web double-tap
 * detection, native host replacement) must never open the row after the hold
 * already entered selection. Execute the real helper.
 * Run with: node --test apps/mobile/scripts/selection-hold-guard.test.cjs */
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const { test } = require("node:test");
const ts = require("typescript");

function load() {
  const filename = resolve(__dirname, "../src/lib/selection-hold-guard.ts");
  const { outputText } = ts.transpileModule(readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  });
  const mod = { exports: {} };
  new Function("module", "exports", "require", outputText)(mod, mod.exports, require);
  return mod.exports;
}

test("a delayed release press stays suppressed instead of opening the row", () => {
  const { createSelectionHoldGuard } = load();
  const guard = createSelectionHoldGuard();
  guard.pressIn();
  guard.markEnter();
  guard.pressOut();
  // Web can deliver the synthesized onPress after a rAF/timer cleanup; the
  // guard must not expire while that release is still in flight.
  assert.equal(guard.consumePress(), true);
  assert.equal(guard.consumePress(), false, "one release consumes the hold once");
});

test("a re-delivered press-in during the same hold does not clear suppression", () => {
  const { createSelectionHoldGuard } = load();
  const guard = createSelectionHoldGuard();
  guard.pressIn();
  guard.markEnter();
  guard.pressIn(); // host replacement / re-render can replay press-in
  guard.pressOut();
  assert.equal(guard.consumePress(), true);
});

test("the next gesture behaves normally after a hold", () => {
  const { createSelectionHoldGuard } = load();
  const guard = createSelectionHoldGuard();
  guard.pressIn();
  guard.markEnter();
  guard.consumePress();
  guard.pressOut();
  guard.pressIn();
  guard.pressOut();
  assert.equal(guard.consumePress(), false, "the next tap is not the long-press release");
});

test("reset clears a suppressed release when row identity changes", () => {
  const { createSelectionHoldGuard } = load();
  const guard = createSelectionHoldGuard();
  guard.pressIn();
  guard.markEnter();
  guard.pressOut();
  guard.reset();
  assert.equal(guard.consumePress(), false);
});
