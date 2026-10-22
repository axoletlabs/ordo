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

function setup(snapshotFor) {
  const dom = new JSDOM('<input id="link"><textarea id="text"></textarea><div id="library"></div><div id="other"></div><div id="menu" data-material-overlay="true"><div id="rows"></div></div>');
  const doc = dom.window.document;
  let dismissals = 0;
  const release = listenForMenuOutsideScroll(() => doc.getElementById("menu"), () => { dismissals++; }, doc, snapshotFor?.(doc));
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

test("queued scroll echoes at the measured anchor position do not dismiss, even when delayed", () => {
  const app = setup(doc => {
    const scroller = doc.getElementById("library");
    scroller.scrollTop = 106;
    scroller.scrollLeft = 12;
    return new Map([[scroller, { top: 106, left: 12 }]]);
  });
  try {
    for (let i = 0; i < 5; i++) app.dispatch("library", "scroll");
    assert.equal(app.count(), 0, "notification delivery count/time is irrelevant when nothing moved");
    app.doc.getElementById("library").scrollTop = 107;
    app.dispatch("library", "scroll");
    assert.equal(app.count(), 1, "one real pixel of scrollbar/momentum movement dismisses immediately");
  } finally { app.close(); }
});

test("horizontal movement and raw gestures still dismiss with an unchanged-anchor snapshot", () => {
  for (const kind of ["horizontal", "wheel", "touchmove", "unknown target"]) {
    const app = setup(doc => new Map([[doc.getElementById("library"), { top: 0, left: 0 }]]));
    try {
      if (kind === "horizontal") app.doc.getElementById("library").scrollLeft = 1;
      const event = app.dispatch(kind === "unknown target" ? "other" : "library",
        kind === "horizontal" || kind === "unknown target" ? "scroll" : kind);
      assert.equal(app.count(), 1, `${kind} must not gain a scroll-dismiss exemption`);
      if (kind === "wheel" || kind === "touchmove") assert.equal(event.defaultPrevented, true);
    } finally { app.close(); }
  }
});

test("document scroll notifications compare the document scrolling element", () => {
  const app = setup(doc => {
    Object.defineProperty(doc, "scrollingElement", { value: doc.documentElement });
    doc.documentElement.scrollTop = 38;
    return new Map([[doc.documentElement, { top: 38, left: 0 }]]);
  });
  try {
    app.doc.dispatchEvent(new app.dom.window.Event("scroll"));
    assert.equal(app.count(), 0);
    app.doc.documentElement.scrollTop = 39;
    app.doc.dispatchEvent(new app.dom.window.Event("scroll"));
    assert.equal(app.count(), 1);
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
