/** Run with: node --test apps/mobile/scripts/overlay-focus.test.cjs
 *
 * Web focus ownership for retained overlays. The actual hook source
 * (hooks/use-overlay-focus.ts) and isolation source (lib/modal-isolation.ts)
 * run on a real jsdom document with React DOM. requestAnimationFrame is a
 * deterministic queue so publication, exit retention, and handoff frames can
 * be replayed exactly; Date.now advances with the fake frame clock so the old
 * wall-clock restore loop can be observed without waiting.
 *
 * These cases cover the Save popup flow and the edges around it:
 * menu -> save dialog handoff, dropdown handoff back to its picker trigger,
 * rapid close/reopen while the exit tree is still retained, a new top overlay
 * during restoration, navigation/unmount, body focus, inert/readonly controls,
 * Tab/Escape, and overlapping modal isolation.
 */
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve, dirname } = require("node:path");
const { test } = require("node:test");
const ts = require("typescript");
const { JSDOM } = require("../../../node_modules/jsdom");

const dom = new JSDOM("<!doctype html><html><body></body></html>", { pretendToBeVisual: true });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.navigator = dom.window.navigator;
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.Element = dom.window.Element;
globalThis.Node = dom.window.Node;
globalThis.MutationObserver = dom.window.MutationObserver;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// Load React after the browser globals exist so its DOM feature detection
// selects the modern input path (not the legacy propertychange polyfill).
const React = require("../../../node_modules/react");
const { createRoot } = require("../../../node_modules/react-dom/client");
const { act } = React;

// jsdom has no layout. Every connected element is treated as visible; tests
// that need hidden/disabled filtering use the real disabled/inert/aria-hidden
// attributes that the production selector checks.
dom.window.Element.prototype.getClientRects = function getClientRects() {
  return this.isConnected ? [this.getBoundingClientRect()] : [];
};
dom.window.Element.prototype.getBoundingClientRect = function getBoundingClientRect() {
  return { x: 0, y: 0, width: this.isConnected ? 240 : 0, height: this.isConnected ? 40 : 0,
    top: 0, left: 0, right: this.isConnected ? 240 : 0, bottom: this.isConnected ? 40 : 0, toJSON() {} };
};

/* ------------------------------ frame clock ------------------------------ */

let nextFrameId = 1;
let frameQueue = new Map();
const cancelledFrames = new Set();
let frameClock = 0;
const realDateNow = Date.now;
Date.now = () => 1_000_000 + frameClock;
globalThis.requestAnimationFrame = callback => {
  const id = nextFrameId++;
  frameQueue.set(id, callback);
  return id;
};
globalThis.cancelAnimationFrame = id => {
  cancelledFrames.add(id);
  frameQueue.delete(id);
};

function pendingFrames() { return frameQueue.size; }

function flushFrame(count = 1) {
  for (let frame = 0; frame < count; frame += 1) {
    frameClock += 16;
    const run = [...frameQueue];
    frameQueue = new Map();
    for (const [id, callback] of run) {
      if (cancelledFrames.has(id)) continue;
      callback(frameClock);
    }
    cancelledFrames.clear();
  }
}

async function flush(count = 1) {
  await act(async () => {
    flushFrame(count);
    await Promise.resolve();
  });
}

async function settleMutation() {
  await act(async () => { await Promise.resolve(); });
}

/* --------------------------- source loader ---------------------------- */

const modules = new Map();
function resolveLocal(from, name) {
  for (const candidate of [name, `${name}.ts`, `${name}.tsx`, `${name}/index.ts`]) {
    const path = resolve(from, candidate);
    try { readFileSync(path); return path; } catch {}
  }
  throw new Error(`Cannot resolve ${name} from ${from}`);
}
function load(filename) {
  if (modules.has(filename)) return modules.get(filename).exports;
  const module = { exports: {} };
  modules.set(filename, module);
  const source = readFileSync(filename, "utf8");
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  });
  const localRequire = name => {
    if (name === "react") return React;
    if (name === "react-native") return { Platform: { OS: "web" } };
    if (name.startsWith(".")) return load(resolveLocal(dirname(filename), name));
    throw new Error(`unmocked import: ${name} (from ${filename})`);
  };
  new Function("require", "module", "exports", outputText)(localRequire, module, module.exports);
  return module.exports;
}

const sourceRoot = process.env.ORDO_CONTROL_SOURCE_ROOT ?? resolve(__dirname, "../src");
const hookPath = resolve(sourceRoot, "hooks/use-overlay-focus.ts");
const isolationPath = resolve(sourceRoot, "lib/modal-isolation.ts");
const { useOverlayFocus } = load(hookPath);
const { isolateModal } = load(isolationPath);

/* --------------------------- React harness --------------------------- */

function mount() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  return {
    container,
    async render(element) { await act(async () => { root.render(element); }); },
    async unmount() { await act(async () => { root.unmount(); }); container.remove(); },
  };
}

const h = React.createElement;
const noop = () => {};
const button = (id, label = id) => h("button", { id, type: "button" }, label);
const input = (id, props = {}) => h("input", { id, "aria-label": id, defaultValue: "", ...props });
const overlay = (props, ...children) => h(Overlay, { key: props.id, ...props }, ...children);

/** The real hook in the same shape as FloatingPanel/ContextMenu use it. */
function Overlay({ id, active, published, suspended = false, kind = "dialog", dismissible = true, children }) {
  const ref = useOverlayFocus(active, noop, kind, dismissible, false, suspended);
  return h("div", {
    ref,
    id,
    role: kind === "menu" ? "menu" : "dialog",
    tabIndex: -1,
    "data-material-overlay": published ? "true" : "false",
    "aria-hidden": !published,
  }, children);
}

const trigger = id => h("div", null, button(id));

/* ------------------------------------------------------------------ */
/* Opening focus                                                       */
/* ------------------------------------------------------------------ */

test("opening focuses the editable field and never a disabled, inert, or readonly control", async () => {
  const app = mount();
  const render = (active, readonlyOnly = false) => app.render(h("div", null,
    trigger(readonlyOnly ? "fab-2" : "fab"),
    overlay({ id: readonlyOnly ? "panel-2" : "panel", active, published: active },
      readonlyOnly ? input("readonly-only", { readOnly: true }) : input("readonly", { readOnly: true }),
      readonlyOnly ? null : input("disabled", { disabled: true }),
      readonlyOnly ? null : h("div", { inert: true }, input("inert-field")),
      button(readonlyOnly ? "close-2" : "close", "Close"),
      readonlyOnly ? null : input("link"))));
  await render(false);
  document.getElementById("fab").focus();
  await render(true);
  await flush(3);
  assert.equal(document.activeElement?.id, "link", "the editable text field owns the opening focus");

  // A dialog with only a readonly input must not park the caret there; the
  // first real action (Close) is the safe fallback.
  await render(false, true);
  document.getElementById("fab-2").focus();
  await render(true, true);
  await flush(3);
  assert.equal(document.activeElement?.id, "close-2", "readonly fields are skipped for the dialog fallback");
  await app.unmount();
});

/* ------------------------------------------------------------------ */
/* Picker close returns to the picker trigger, not the link field      */
/* ------------------------------------------------------------------ */

test("resuming a suspended save sheet does not steal focus from the picker's restored trigger", async () => {
  const app = mount();
  const render = (sheetActive, panelSuspended, menuActive) => app.render(h("div", null,
    trigger("fab"),
    input("background-search"),
    sheetActive ? overlay({ id: "sheet", active: true, suspended: panelSuspended, published: !panelSuspended },
      input("link"),
      button("folder-field", "Folder")) : null,
    sheetActive ? overlay({ id: "picker", kind: "menu", active: menuActive, published: menuActive },
      input("picker-search")) : null));
  await render(false, false, false);
  document.getElementById("fab").focus();
  await render(true, false, false);
  await flush(3);
  assert.equal(document.activeElement?.id, "link");

  // The folder dropdown opens: the field releases focus, the menu search takes it.
  await render(true, true, false);
  document.getElementById("folder-field").focus();
  await render(true, true, true);
  await flush(3);
  assert.equal(document.activeElement?.id, "picker-search");

  // Dismissing only the picker resumes the sheet. Capture the whole handoff,
  // frame by frame: no intermediate Link/background-search focus and no focus
  // left inside the hidden closing child.
  const trace = [];
  const focusin = (event) => trace.push(`focusin:${event.target?.id ?? ""}`);
  document.addEventListener("focusin", focusin, true);
  try {
    await render(true, false, false);
    for (let frame = 0; frame < 4; frame += 1) {
      await flush(1);
      trace.push(`frame${frame}:${document.activeElement?.id ?? ""}`);
    }
  } finally {
    document.removeEventListener("focusin", focusin, true);
  }
  assert.equal(document.activeElement?.id, "folder-field",
    "picker close restores its trigger; the resumed dialog must not refocus the link field");
  assert.deepEqual(trace.filter((entry) => entry.startsWith("focusin:")), ["focusin:folder-field"],
    "the only focus move during close is the picker trigger");
  const frames = trace.filter((entry) => entry.startsWith("frame")).map((entry) => entry.slice(entry.indexOf(":") + 1));
  assert.ok(frames.every((id) => id === "folder-field"),
    `every settled frame stays on the restored trigger: ${trace.join(", ")}`);
  assert.ok(trace.every((entry) => !entry.includes("link") && !entry.includes("background-search")),
    `no transient Link or background search: ${trace.join(", ")}`);
  await app.unmount();
});

test("resuming with a removed picker trigger falls back to the first valid parent field", async () => {
  const app = mount();
  const render = (sheetActive, panelSuspended, menuActive, showFolder = true) => app.render(h("div", null,
    trigger("fab"),
    input("background-search"),
    sheetActive ? overlay({ id: "sheet", active: true, suspended: panelSuspended, published: !panelSuspended },
      input("link"),
      showFolder ? button("folder-field", "Folder") : null) : null,
    sheetActive ? overlay({ id: "picker", kind: "menu", active: menuActive, published: menuActive },
      input("picker-search")) : null));
  await render(false, false, false);
  document.getElementById("fab").focus();
  await render(true, false, false);
  await flush(3);
  document.getElementById("folder-field").focus();
  await render(true, true, false);
  await render(true, true, true);
  await flush(3);
  assert.equal(document.activeElement?.id, "picker-search");

  const trace = [];
  const focusin = (event) => trace.push(event.target?.id ?? "");
  document.addEventListener("focusin", focusin, true);
  try {
    // The picker row that opened the child disappears while the child is open.
    await render(true, false, false, false);
    await flush(4);
    assert.equal(document.activeElement?.id, "link",
      "the first valid dialog field replaces a removed picker trigger");
    assert.ok(!trace.includes("background-search"), "the fallback stays inside the dialog");
  } finally {
    document.removeEventListener("focusin", focusin, true);
  }
  await app.unmount();
});

test("a resuming dialog waits for a child restore whose trigger is temporarily inert", async () => {
  const app = mount();
  let folderInert = false;
  const render = (panelSuspended, menuActive, dismissible = true, menuPublished = menuActive) => app.render(h("div", null,
    trigger("fab"),
    input("background-search"),
    overlay({ id: "sheet", active: true, suspended: panelSuspended, published: !panelSuspended, dismissible },
      input("link"),
      h("button", { id: "folder-field", type: "button", inert: folderInert }, "Folder")),
    overlay({ id: "picker", kind: "menu", active: menuActive, published: menuPublished },
      input("picker-search"))));
  await render(false, false);
  document.getElementById("fab").focus();
  await render(false, false);
  await flush(3);
  assert.equal(document.activeElement?.id, "link");

  // The picker is mounted before it wins the top slot. This lets the test
  // record the Folder field as both the child trigger and the parent's last
  // focus, without the opening search take moving it first.
  document.getElementById("link").blur();
  document.getElementById("folder-field").focus();
  await render(true, true, true, false);
  await render(true, true, false, false);
  assert.equal(document.activeElement?.id, "folder-field");

  await render(true, true, false, true);
  await flush(3);
  assert.equal(document.activeElement?.id, "picker-search");

  // The child's launch row is temporarily inert while the exit isolation is
  // still held. Its restore must be allowed to finish before the parent picks
  // its first field; otherwise the IME visibly bounces to the Link input.
  folderInert = true;
  await render(true, true, false, false);
  const trace = [];
  const focusin = (event) => trace.push(event.target?.id ?? "");
  document.addEventListener("focusin", focusin, true);
  try {
    await render(false, false, false, false);
    for (let frame = 0; frame < 2; frame += 1) {
      await flush(1);
      trace.push(`frame${frame}:${document.activeElement?.id ?? ""}`);
    }
    assert.notEqual(document.activeElement?.id, "link", `the parent does not grab the link field while the child restore waits (${trace.join(", ")})`);
    assert.ok(!trace.includes("link"), "no transient Link focus during the handoff");
    folderInert = false;
    await render(false, false, false, false);
    await settleMutation();
    await flush(4);
    assert.equal(document.activeElement?.id, "folder-field", "the child trigger is restored once it is focusable");
  } finally {
    document.removeEventListener("focusin", focusin, true);
  }
  await app.unmount();
});

/* ------------------------------------------------------------------ */
/* Rapid close/reopen while the retained tree still has focus          */
/* ------------------------------------------------------------------ */

test("a close/reopen during the exit fade keeps the original trigger for the final close", async () => {
  const app = mount();
  const render = active => app.render(h("div", null,
    trigger("fab"),
    overlay({ id: "panel", active, published: active }, input("link"))));
  await render(false);
  document.getElementById("fab").focus();
  await render(true);
  await flush(3);
  assert.equal(document.activeElement?.id, "link");

  // Close and reopen before the first close's restoration runs. The link
  // field is still focused inside the retained exit tree; it must not become
  // the trigger for the new session.
  await render(false);
  await render(true);
  await flush(3);
  assert.equal(document.activeElement?.id, "link");
  // Let any old restore deadline expire; the reopened session must still own
  // the original trigger when the user closes it later.
  await flush(40);
  assert.equal(document.activeElement?.id, "link");
  await render(false);
  await flush(4);
  assert.equal(document.activeElement?.id, "fab",
    "the final close restores the original trigger, not the retained field/body");

  // Real panels unmount the retained tree after the fade; focus must already
  // be somewhere useful before that happens.
  await app.render(h("div", null, trigger("fab")));
  await flush(1);
  assert.equal(document.activeElement?.id, "fab", "unmounting the retained tree cannot drop focus to body");
  await app.unmount();
});

/* ------------------------------------------------------------------ */
/* Save menu -> save dialog handoff                                    */
/* ------------------------------------------------------------------ */

test("closing a save dialog opened from a closing menu restores the menu launch trigger", async () => {
  const app = mount();
  const render = (menuActive, sheetActive) => app.render(h("div", null,
    trigger("fab"),
    overlay({ id: "menu", kind: "menu", active: menuActive, published: menuActive },
      button("save-item", "Save bookmark")),
    overlay({ id: "sheet", active: sheetActive, published: sheetActive }, input("link"))));
  await render(false, false);
  document.getElementById("fab").focus();
  await render(true, false);
  await flush(3);
  document.getElementById("save-item").focus();

  // The menu closes and the sheet opens in one task. The menu item is still
  // connected/focused in its retained exit tree, but the sheet's trigger is
  // the control that launched the menu.
  await render(false, true);
  await flush(4);
  assert.equal(document.activeElement?.id, "link");

  await render(false, false);
  await flush(4);
  assert.equal(document.activeElement?.id, "fab",
    "the closing sheet restores the surviving launch trigger, not a dying menu item");
  await app.unmount();
});

test("closing a dialog and its open dropdown together restores the dialog launch trigger", async () => {
  const app = mount();
  const render = (sheetOpen, menuOpen) => app.render(h("div", null,
    trigger("fab"),
    overlay({ id: "sheet", active: sheetOpen, published: sheetOpen },
      input("link"),
      button("folder-field", "Folder")),
    overlay({ id: "picker", kind: "menu", active: menuOpen, published: menuOpen }, input("picker-search"))));
  await render(false, false);
  document.getElementById("fab").focus();
  await render(true, false);
  await flush(3);
  assert.equal(document.activeElement?.id, "link");

  // Opening the child menu captures the link field as its trigger.
  await render(true, true);
  await flush(3);
  assert.equal(document.activeElement?.id, "picker-search");
  // Both surfaces close in one task (Cancel also closes its dropdown).
  await render(false, false);
  await flush(4);
  assert.equal(document.activeElement?.id, "fab",
    "the outward trigger survives when a focused child menu closes with its dialog");
  await app.unmount();
});

test("a body-focused open never invents a trigger or falls back to the background search", async () => {
  const app = mount();
  const render = active => app.render(h("div", null,
    h("div", null, input("background-search")),
    overlay({ id: "panel", active, published: active }, input("link"))));
  await render(false);
  if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  await render(true);
  await flush(3);
  assert.equal(document.activeElement?.id, "link");
  await render(false);
  await flush(4);
  assert.notEqual(document.activeElement?.id, "background-search", "restoration does not guess a background field");
  await app.unmount();
});

/* ------------------------------------------------------------------ */
/* A newer overlay owns focus; stale restores must not steal it        */
/* ------------------------------------------------------------------ */

test("a restore whose top snapshot went stale never focuses the old trigger over a new overlay", async () => {
  const app = mount();
  const render = (first, second) => app.render(h("div", null,
    trigger("first-trigger"),
    overlay({ id: "first", active: first, published: first }, input("first-link")),
    second ? overlay({ id: "second", active: true, published: true }, input("second-link")) : null));
  await render(false, false);
  document.getElementById("first-trigger").focus();
  let staleFocus = 0;
  document.getElementById("first-trigger").addEventListener("focus", () => { staleFocus += 1; });
  await render(true, false);
  await flush(3);

  // Close the first surface: its restore attempt is queued for the next
  // frame, before any focus move.
  await render(false, false);
  assert.equal(pendingFrames() > 0, true, "a restore attempt is pending");

  // A second overlay is published before that attempt. Ownership must be
  // re-read when the attempt actually runs, not from the close snapshot.
  await render(false, true);
  await flush(4);
  assert.equal(document.activeElement?.id, "second-link", "the new overlay keeps focus");
  assert.equal(staleFocus, 0, "the old trigger never receives focus after the new surface opens");

  // Complete the new overlay's close; its own restore owns the next move.
  await render(false, false);
  await flush(4);
  assert.notEqual(document.activeElement?.id, "first-trigger",
    "the old surface cannot restore over the newer surface's session");
  await app.unmount();
});

test("unmount/navigation cancels a close restore instead of polling and focusing an old page", async () => {
  const app = mount();
  const render = active => app.render(h("div", null, trigger("fab"),
    overlay({ id: "panel", active, published: active }, input("link"))));
  await render(false);
  document.getElementById("fab").focus();
  await render(true);
  await flush(3);
  assert.equal(document.activeElement?.id, "link");

  // Navigate: the overlay tree unmounts without an explicit close render.
  await app.render(h("div", null, trigger("fab")));
  await flush(4);
  assert.equal(pendingFrames(), 0, "no restore frames survive the unmount");
  assert.notEqual(document.activeElement?.id, "fab", "navigation must not restore focus to the page that was left");
  await app.unmount();
});

test("a handoff to another top overlay ends the restore immediately (no 600ms polling)", async () => {
  const app = mount();
  const render = (first, second) => app.render(h("div", null,
    trigger("first-trigger"),
    overlay({ id: "first", active: first, published: first }, input("first-link")),
    overlay({ id: "second", active: second, published: second }, input("second-link"))));
  await render(false, false);
  document.getElementById("first-trigger").focus();
  await render(true, false);
  await flush(3);

  await render(false, true);
  await flush(4);
  assert.equal(document.activeElement?.id, "second-link");
  assert.equal(pendingFrames(), 0, "a newer surface cancels the old restore instead of polling a deadline");
  await app.unmount();
});

/* ------------------------------------------------------------------ */
/* Isolation release drives restoration, with no wall-clock deadline   */
/* ------------------------------------------------------------------ */

test("restoration waits for the exit isolation to release, then focuses the trigger", async () => {
  const app = mount();
  const render = active => app.render(h("div", null,
    h("div", { id: "background" }, trigger("fab")),
    overlay({ id: "panel", active, published: active }, input("link"))));
  await render(false);
  document.getElementById("fab").focus();
  await render(true);
  const panel = document.getElementById("panel");
  const release = isolateModal(panel);
  document.getElementById("fab").blur();
  await flush(3);
  assert.equal(document.activeElement?.id, "link");

  await render(false);
  // The exit layer stays isolated through its retained fade.
  const releaseExit = isolateModal(document.getElementById("panel"));
  const trace = [];
  for (let frame = 0; frame < 4; frame += 1) {
    await flush(1);
    trace.push(document.activeElement?.id ?? "");
  }
  assert.ok(trace.every((id) => id !== "link" && id !== "panel"),
    `focus leaves the hidden retained tree immediately: ${trace.join(", ")}`);
  assert.notEqual(document.activeElement?.id, "fab", "an inert background trigger must not receive focus");

  release();
  releaseExit();
  await settleMutation();
  await flush(4);
  assert.equal(document.activeElement?.id, "fab", "the trigger is restored once isolation actually releases");
  await app.unmount();
});

/* ------------------------------------------------------------------ */
/* Keyboard / caret                                                    */
/* ------------------------------------------------------------------ */

test("close evacuates a retained portal before its delayed inactive DOM publication", async () => {
  const app = mount();
  const render = (active, published) => app.render(h("div", null,
    h("div", { id: "portal-background" }, trigger("portal-fab")),
    overlay({ id: "portal-sheet", active, published }, input("portal-link"), button("portal-close"))));
  await render(false, false);
  document.getElementById("portal-fab").focus();
  await render(true, true);
  await flush(3);
  const release = isolateModal(document.getElementById("portal-sheet"));
  document.getElementById("portal-close").focus();
  // The publisher closes first; the portal's DOM still says active until its
  // own next commit. The background stays inert throughout the exit fade.
  await render(false, true);
  await flush(1);
  assert.notEqual(document.activeElement?.id, "portal-close");
  assert.notEqual(document.activeElement?.id, "portal-fab");
  await render(false, false);
  release();
  await settleMutation();
  await flush(3);
  assert.equal(document.activeElement?.id, "portal-fab");
  await app.unmount();
});

test("a fresh retained reopen focuses Link rather than the last Paste action", async () => {
  const app = mount();
  const render = active => app.render(h("div", null,
    trigger("paste-fab"),
    overlay({ id: "paste-sheet", active, published: active }, input("paste-link"), button("paste-action"))));
  await render(false);
  document.getElementById("paste-fab").focus();
  await render(true);
  await flush(3);
  document.getElementById("paste-action").focus();
  await render(false);
  await render(true);
  await flush(3);
  assert.equal(document.activeElement?.id, "paste-link");
  await app.unmount();
});

test("restoration observes isolation release on the trigger's immediate parent", async () => {
  const app = mount();
  const render = active => app.render(h("div", null,
    h("div", { id: "direct-background" }, button("direct-fab")),
    overlay({ id: "direct-sheet", active, published: active }, input("direct-link"))));
  await render(false);
  document.getElementById("direct-fab").focus();
  await render(true);
  await flush(3);
  const release = isolateModal(document.getElementById("direct-sheet"));
  await render(false);
  await flush(3);
  assert.notEqual(document.activeElement?.id, "direct-fab");
  release();
  await settleMutation();
  await flush(3);
  assert.equal(document.activeElement?.id, "direct-fab", "child-list observation must not replace the parent's attribute observation");
  await app.unmount();
});

test("Tab containment, only-top Escape, and typing keep the current caret", async () => {
  const app = mount();
  let dismissals = 0;
  function Dialog({ id, active, published, onDismiss, children }) {
    const ref = useOverlayFocus(active, onDismiss, "dialog", true, false, false);
    return h("div", { ref, id, role: "dialog", tabIndex: -1,
      "data-material-overlay": published ? "true" : "false", "aria-hidden": !published }, children);
  }
  await app.render(h("div", null,
    h(Dialog, { id: "lower", active: true, published: false, onDismiss: () => { dismissals += 100; } }, input("lower-input")),
    h(Dialog, { id: "upper", active: true, published: true, onDismiss: () => { dismissals += 1; } },
      input("first"), input("second"))));
  await flush(3);
  assert.equal(document.activeElement?.id, "first");

  const link = document.getElementById("first");
  link.value = "abcdef";
  link.setSelectionRange(3, 3);
  link.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "a", bubbles: true, cancelable: true }));
  assert.equal(link.selectionStart, 3, "ordinary typing does not reposition the caret");

  // jsdom does not perform the browser's default Tab move, so exercise the
  // two edges the hook owns: Shift+Tab from the first and Tab from the last.
  link.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Tab", shiftKey: true, bubbles: true, cancelable: true }));
  assert.equal(document.activeElement?.id, "second", "Shift+Tab wraps to the last control");

  document.getElementById("second").dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true }));
  assert.equal(document.activeElement?.id, "first", "Tab wraps to the first control");

  document.getElementById("first").dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
  assert.equal(dismissals, 1, "Escape dismisses only the top overlay");
  await app.unmount();
});

/* ------------------------------------------------------------------ */
/* Modal isolation                                                     */
/* ------------------------------------------------------------------ */

test("overlapping modal isolations keep the background inert until the last owner releases", () => {
  const body = document.body;
  body.innerHTML = "";
  const background = document.createElement("div");
  background.id = "background";
  background.inert = false;
  background.setAttribute("aria-hidden", "false");
  const layerA = document.createElement("div");
  const rootA = document.createElement("div");
  const layerB = document.createElement("div");
  const rootB = document.createElement("div");
  const untouched = document.createElement("script");
  const nested = document.createElement("div");
  nested.inert = true;
  layerA.append(rootA);
  layerB.append(rootB);
  background.append(nested);
  body.append(background, layerA, untouched, layerB);
  dom.window.document.documentElement.style.overflow = "auto";
  body.style.overflow = "scroll";

  const releaseA = isolateModal(rootA);
  const releaseB = isolateModal(rootB);
  assert.equal(background.inert, true);
  assert.equal(background.getAttribute("aria-hidden"), "true");
  assert.equal(dom.window.document.documentElement.style.overflow, "hidden");
  assert.equal(body.style.overflow, "hidden");
  assert.equal(nested.inert, true, "an already-inert child stays inert");

  releaseA();
  assert.equal(background.inert, true, "releasing the first owner cannot unlock a still-isolated background");
  assert.equal(background.getAttribute("aria-hidden"), "true");
  assert.equal(dom.window.document.documentElement.style.overflow, "hidden");
  assert.equal(body.style.overflow, "hidden");

  releaseB();
  releaseB();
  assert.equal(background.inert, false);
  assert.equal(background.getAttribute("aria-hidden"), "false");
  assert.equal(nested.inert, true, "pre-existing inert state is preserved");
  assert.equal(dom.window.document.documentElement.style.overflow, "auto");
  assert.equal(body.style.overflow, "scroll");
  assert.equal(untouched.hasAttribute("aria-hidden"), false, "script/style/link siblings are never touched");
});

test.after(() => {
  Date.now = realDateNow;
});
