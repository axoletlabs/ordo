const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const { test } = require("node:test");
const { JSDOM } = require("jsdom");
const ts = require("typescript");
const mod = { exports: {} };
new Function("module", "exports", ts.transpileModule(readFileSync(process.env.ORDO_OUTSIDE_SCROLL_SOURCE ?? resolve(__dirname, "../src/lib/menu-outside-scroll.ts"), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText)(mod, mod.exports);
const { listenForMenuOutsideScroll } = mod.exports;

function setup() {
  const dom = new JSDOM('<input id="link"><textarea id="text"></textarea><div id="library"></div><div id="menu" data-material-overlay="true"><div id="rows"></div></div>');
  const doc = dom.window.document;
  let dismissals = 0;
  const release = listenForMenuOutsideScroll(() => doc.getElementById("menu"), () => { dismissals++; }, doc);
  return { doc, dom, release, count: () => dismissals, close() { release(); dom.window.close(); },
    dispatch(id, type) {
      const event = new dom.window.Event(type, { bubbles: false, cancelable: type !== "scroll" });
      doc.getElementById(id).dispatchEvent(event);
      return event;
    } };
}

test("a delayed caret viewport scroll cannot close the newly opened picker", () => {
  const app = setup();
  try {
    app.dispatch("link", "scroll");
    app.dispatch("text", "scroll");
    assert.equal(app.count(), 0);
    const wheel = app.dispatch("link", "wheel");
    assert.equal(app.count(), 1, "an actual outside gesture still dismisses");
    assert.equal(wheel.defaultPrevented, true);
  } finally { app.close(); }
});

test("menu body scrolling is contained and background scrolling dismisses once", () => {
  const app = setup();
  try {
    app.dispatch("rows", "scroll");
    app.dispatch("rows", "touchmove");
    assert.equal(app.count(), 0);
    app.dispatch("library", "scroll");
    app.dispatch("library", "wheel");
    assert.equal(app.count(), 1);
  } finally { app.close(); }
});

test("teardown removes outside scroll and gesture listeners", () => {
  const app = setup();
  try {
    app.release();
    app.dispatch("library", "scroll");
    app.dispatch("library", "wheel");
    app.dispatch("library", "touchmove");
    assert.equal(app.count(), 0);
  } finally { app.close(); }
});
