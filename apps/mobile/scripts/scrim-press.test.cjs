const assert = require("node:assert/strict");
const { test } = require("node:test");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const ts = require("typescript");
const mod = { exports: {} };
new Function("module", "exports", ts.transpileModule(readFileSync(resolve(__dirname, "../src/lib/scrim-press.ts"), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText)(mod, mod.exports);
const { createScrimPressGuard } = mod.exports;

test("a long-press release retargeted to a new scrim is not a dismissal", () => {
  const guard = createScrimPressGuard();
  assert.equal(guard.consume(true, { detail: 1, type: "click" }), false);
  guard.begin();
  assert.equal(guard.consume(true, { detail: 1, type: "click" }), true);
  assert.equal(guard.consume(true, { detail: 1, type: "click" }), false, "one gesture cannot dismiss two openings");
});
test("cancelled or superseded scrim gestures cannot leak into another touch", () => {
  const guard = createScrimPressGuard();
  guard.begin();
  guard.reset();
  assert.equal(guard.consume(true, { detail: 1 }), false);
  guard.begin();
  assert.equal(guard.consume(true, { detail: 1 }), true, "a fresh rapid tap remains responsive");
});
test("keyboard, assistive virtual clicks and native responder activation remain valid", () => {
  const guard = createScrimPressGuard();
  assert.equal(guard.consume(true, { detail: 0, type: "click" }), true);
  assert.equal(guard.consume(true, { type: "keyup", key: " " }), true);
  assert.equal(guard.consume(false, {}), true);
});
