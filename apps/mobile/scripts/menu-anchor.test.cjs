const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const { test } = require("node:test");
const ts = require("typescript");
const { JSDOM } = require("jsdom");
const dom = new JSDOM("<!doctype html>");
globalThis.HTMLElement = dom.window.HTMLElement;
const mod = { exports: {} };
new Function("module", "exports", ts.transpileModule(readFileSync(resolve(__dirname, "../src/lib/menu-anchor.ts"), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText)(mod, mod.exports);
const { measureAnchor, menuAnchorScrollSnapshot } = mod.exports;

test("web trigger measurement opens the picker in the press task, before Escape can reach its parent", () => {
  const events = [];
  const rect = { x: 12, y: 24, width: 220, height: 56 };
  const node = dom.window.document.createElement("div");
  node.getBoundingClientRect = () => rect;
  node.measureInWindow = () => events.push("deferred");
  measureAnchor(node, anchor => {
    assert.deepEqual(anchor, rect);
    events.push("picker owns focus");
  });
  events.push("next key");
  assert.deepEqual(events, ["picker owns focus", "next key"]);
});

test("native measurement stays asynchronous even when its host exposes DOM-like methods", () => {
  let settle;
  const anchors = [];
  // Modern native hosts also expose DOM-like methods; they are not browser
  // HTMLElement instances and must keep using native window measurement.
  measureAnchor({ getBoundingClientRect: () => ({ x: 0, y: 0, width: 120, height: 48 }), measureInWindow: callback => { settle = callback; } }, anchor => anchors.push(anchor));
  assert.deepEqual(anchors, []);
  settle(10, 20, 200, 48);
  assert.deepEqual(anchors, [{ x: 10, y: 20, width: 200, height: 48 }]);
  measureAnchor(null, anchor => anchors.push(anchor), { nativeEvent: { pageX: 30, pageY: 40 } });
  assert.deepEqual(anchors[1], { x: 30, y: 40, width: 1, height: 1 });
});

test("an unmeasured DOM box still uses the original window measurement fallback", () => {
  const node = dom.window.document.createElement("div");
  node.measureInWindow = callback => callback(14, 28, 200, 48);
  let measured;
  measureAnchor(node, anchor => { measured = anchor; });
  assert.deepEqual(measured, { x: 14, y: 28, width: 200, height: 48 });
});

test("web anchors remember only their measured ancestor offsets without changing the rect shape", () => {
  const scroller = dom.window.document.createElement("div");
  const node = dom.window.document.createElement("div");
  scroller.append(node);
  dom.window.document.body.append(scroller);
  scroller.scrollTop = 106;
  scroller.scrollLeft = 12;
  node.getBoundingClientRect = () => ({ x: 20, y: 30, width: 150, height: 48 });
  let anchor;
  measureAnchor(node, value => { anchor = value; });
  assert.deepEqual(anchor, { x: 20, y: 30, width: 150, height: 48 });
  const snapshot = menuAnchorScrollSnapshot(anchor);
  assert.deepEqual(snapshot.get(scroller), { left: 12, top: 106 });
  assert.ok(snapshot.has(dom.window.document.documentElement), "document scrolling is part of the same ancestry");
  assert.equal(snapshot.has(dom.window.document.createElement("div")), false, "unrelated scrollers are not inspected");
  scroller.scrollTop = 107;
  assert.equal(snapshot.get(scroller).top, 106, "the snapshot stays at activation, not notification time");
  assert.equal(menuAnchorScrollSnapshot({ ...anchor }), undefined, "synthetic/native anchors keep existing dismissal behavior");
  assert.equal(menuAnchorScrollSnapshot(null), undefined);
  scroller.remove();
});
