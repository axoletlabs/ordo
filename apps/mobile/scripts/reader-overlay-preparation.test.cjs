/** Actual-source scheduling contract; browser/native layout is tested separately. */
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const { test } = require("node:test");
const React = require("react");
const { createRoot } = require("react-dom/client");
const { JSDOM } = require("jsdom");
const ts = require("typescript");

const dom = new JSDOM("<html><body></body></html>");
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let active = true;
const subscribers = new Set();
function useAnimationActivityEffect(callback) {
  React.useEffect(() => {
    let cleanup;
    const update = () => { cleanup?.(); cleanup = callback(active); };
    subscribers.add(update);
    update();
    return () => { subscribers.delete(update); cleanup?.(); };
  }, [callback]);
}
const filename = resolve(__dirname, "../src/components/reader/use-prepared-reader-overlay.ts");
const { outputText } = ts.transpileModule(readFileSync(filename, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
});
const loaded = { exports: {} };
new Function("require", "module", "exports", outputText)(name => name === "react" ? React :
  name === "../../hooks/use-animation-activity" ? { useAnimationActivityEffect } : require(name), loaded, loaded.exports);
const { usePreparedReaderOverlay } = loaded.exports;

function scheduler() {
  const pending = new Set();
  let starts = 0;
  return {
    pending,
    get starts() { return starts; },
    schedule(work) { starts++; pending.add(work); return () => pending.delete(work); },
    run() { const work = [...pending]; pending.clear(); work.forEach(callback => callback()); },
  };
}
async function mount() {
  active = true;
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container), work = scheduler();
  let api;
  function Probe() { api = usePreparedReaderOverlay(work); return React.createElement("span", null, String(api.prepared)); }
  await React.act(async () => root.render(React.createElement(Probe)));
  return { work, container, get api() { return api; },
    async unmount() { await React.act(async () => root.unmount()); container.remove(); },
  };
}
async function setActive(value) {
  await React.act(async () => { active = value; [...subscribers].forEach(callback => callback()); });
}

test("reader preparation waits for readiness and cancellable idle work, then runs only once", async () => {
  const view = await mount();
  try {
    assert.equal(view.work.pending.size, 0, "article startup must not mount controls");
    await React.act(async () => { view.api.prepare(); view.api.prepare(); });
    assert.equal(view.work.pending.size, 1);
    assert.equal(view.api.prepared, false, "prepare is a request, not an urgent mount");
    await React.act(async () => view.work.run());
    assert.equal(view.api.prepared, true);
    assert.equal(view.work.pending.size, 0);
    await setActive(false);
    await setActive(true);
    await React.act(async () => view.api.prepare());
    assert.equal(view.work.starts, 1, "resume must not rebuild already prepared controls");
  } finally { await view.unmount(); }
});

test("covered/background readers cancel preparation and resume without a duplicate surface", async () => {
  const view = await mount();
  try {
    await React.act(async () => view.api.prepare());
    await setActive(false);
    assert.equal(view.work.pending.size, 0);
    await React.act(async () => view.work.run());
    assert.equal(view.api.prepared, false);
    await setActive(true);
    assert.equal(view.work.pending.size, 1);
    await React.act(async () => view.work.run());
    assert.equal(view.api.prepared, true);
  } finally { await view.unmount(); }
});

test("an early urgent open retains immediately and withdraws pending idle work", async () => {
  const view = await mount();
  try {
    await React.act(async () => view.api.prepare());
    await React.act(async () => view.api.retain());
    assert.equal(view.api.prepared, true);
    assert.equal(view.work.pending.size, 0);
    await React.act(async () => view.work.run());
    assert.equal(view.api.prepared, true);
    assert.equal(view.work.starts, 1);
  } finally { await view.unmount(); }
});

test("unmount/navigation cancels work which has not started", async () => {
  const view = await mount();
  await React.act(async () => view.api.prepare());
  assert.equal(view.work.pending.size, 1);
  await view.unmount();
  assert.equal(view.work.pending.size, 0);
  assert.equal(subscribers.size, 0);
});
