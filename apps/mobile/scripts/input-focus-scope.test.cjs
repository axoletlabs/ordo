const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const { test } = require("node:test");
const ts = require("typescript");
const React = require("react");
const { createRoot } = require("react-dom/client");
const { JSDOM } = require("jsdom");

test("discarded visibility renders cannot invent a new autofocus session", async () => {
  const dom = new JSDOM("<!doctype html><div id='root'></div>");
  const previous = { window: globalThis.window, document: globalThis.document, act: globalThis.IS_REACT_ACT_ENVIRONMENT };
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const { outputText } = ts.transpileModule(readFileSync(process.env.ORDO_FOCUS_SCOPE_SOURCE ?? resolve(__dirname, "../src/components/ui/input-focus-scope.ts"), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  });
  const mod = { exports: {} };
  new Function("require", "module", "exports", outputText)(name => {
    assert.equal(name, "react"); return React;
  }, mod, mod.exports);
  const { useInputFocusScope } = mod.exports;
  let suspended = false;
  const pending = new Promise(() => {});
  function Harness({ visible, suspend, revision }) {
    const scope = useInputFocusScope(visible, true, visible);
    if (suspend) { suspended = true; throw pending; }
    return React.createElement("output", { "data-revision": revision }, scope.session);
  }
  const root = createRoot(dom.window.document.getElementById("root"));
  const view = (visible, suspend = false, revision = 0) => React.createElement(React.Suspense, { fallback: "loading" },
    React.createElement(Harness, { visible, suspend, revision }));
  const session = () => dom.window.document.querySelector("output").textContent;
  try {
    await React.act(() => root.render(view(true)));
    assert.equal(session(), "0");
    await React.act(() => { React.startTransition(() => root.render(view(false, true))); });
    assert.equal(suspended, true);
    assert.equal(session(), "0", "the live dialog never closed");
    await React.act(() => root.render(view(true, false, 1)));
    assert.equal(session(), "0", "an aborted close is not a fresh open");
    await React.act(() => root.render(view(false)));
    await React.act(() => root.render(view(true)));
    assert.equal(session(), "1", "a real close/reopen gets exactly one new session");
  } finally {
    await React.act(() => root.unmount());
    dom.window.close();
    globalThis.window = previous.window;
    globalThis.document = previous.document;
    globalThis.IS_REACT_ACT_ENVIRONMENT = previous.act;
  }
});
