const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const { test } = require("node:test");
const ts = require("typescript");
const mod = { exports: {} };
new Function("module", "exports", ts.transpileModule(readFileSync(resolve(__dirname, "../src/lib/menu-anchor.ts"), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText)(mod, mod.exports);
const { measureAnchor } = mod.exports;

test("web trigger measurement opens the picker in the press task, before Escape can reach its parent", () => {
  const events = [];
  const rect = { x: 12, y: 24, width: 220, height: 56 };
  measureAnchor({ getBoundingClientRect: () => rect, measureInWindow: () => events.push("deferred") }, anchor => {
    assert.deepEqual(anchor, rect);
    events.push("picker owns focus");
  });
  events.push("next key");
  assert.deepEqual(events, ["picker owns focus", "next key"]);
});

test("native measurement stays asynchronous and invalid DOM boxes use the original fallback", () => {
  let settle;
  const anchors = [];
  measureAnchor({ getBoundingClientRect: () => ({ x: 0, y: 0, width: 0, height: 0 }), measureInWindow: callback => { settle = callback; } }, anchor => anchors.push(anchor));
  assert.deepEqual(anchors, []);
  settle(10, 20, 200, 48);
  assert.deepEqual(anchors, [{ x: 10, y: 20, width: 200, height: 48 }]);
  measureAnchor(null, anchor => anchors.push(anchor), { nativeEvent: { pageX: 30, pageY: 40 } });
  assert.deepEqual(anchors[1], { x: 30, y: 40, width: 1, height: 1 });
});
