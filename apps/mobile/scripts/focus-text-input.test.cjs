const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const { test } = require("node:test");
const ts = require("typescript");

function setup(os, isVisible) {
  const { outputText } = ts.transpileModule(readFileSync(resolve(__dirname, "../src/lib/focus-text-input.ts"), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  });
  const mod = { exports: {} };
  new Function("require", "module", "exports", outputText)(name => {
    assert.equal(name, "react-native");
    return { Platform: { OS: os }, Keyboard: { isVisible } };
  }, mod, mod.exports);
  return mod.exports.focusTextInput;
}

test("an explicit Android focus request reopens only its already-focused hidden keyboard", () => {
  const focus = setup("android", () => false), events = [];
  const target = { isFocused: () => true, blur: () => events.push("blur"), focus: () => events.push("focus") };
  focus(target);
  assert.deepEqual(events, ["blur", "focus"]);
});

test("ordinary focus and visible keyboards never blur another field", () => {
  for (const [os, visible, focused] of [["android", true, true], ["android", false, false], ["ios", false, true], ["web", false, true]]) {
    const events = [];
    setup(os, () => visible)({ isFocused: () => focused, blur: () => events.push("blur"), focus: () => events.push("focus") });
    assert.deepEqual(events, ["focus"]);
  }
});

test("missing or throwing keyboard APIs do not trigger a speculative blur", () => {
  for (const isVisible of [undefined, () => { throw new Error("unavailable"); }]) {
    const events = [];
    const focus = setup("android", isVisible);
    focus({ isFocused: () => true, blur: () => events.push("blur"), focus: () => events.push("focus") });
    focus(null);
    assert.deepEqual(events, ["focus"]);
  }
});
