const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const { test } = require("node:test");
const ts = require("typescript");
const React = require("react");
const { createRoot } = require("react-dom/client");
const { JSDOM } = require("jsdom");

const SOURCE = () => process.env.ORDO_FOCUS_SCOPE_SOURCE
  ?? resolve(__dirname, "../src/components/ui/input-focus-scope.ts");

function loadScope(platform) {
  const { outputText } = ts.transpileModule(readFileSync(SOURCE(), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  });
  const mod = { exports: {} };
  new Function("require", "module", "exports", outputText)(name => {
    if (name === "react") return React;
    if (name === "react-native") return { Platform: { OS: platform } };
    throw new Error(`unexpected import ${name}`);
  }, mod, mod.exports);
  return mod.exports;
}

function withDom() {
  const dom = new JSDOM("<!doctype html><div id='root'></div>");
  const previous = { window: globalThis.window, document: globalThis.document, act: globalThis.IS_REACT_ACT_ENVIRONMENT };
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  return {
    dom,
    restore() {
      dom.window.close();
      globalThis.window = previous.window;
      globalThis.document = previous.document;
      globalThis.IS_REACT_ACT_ENVIRONMENT = previous.act;
    },
  };
}

async function flushMicrotasks() {
  await Promise.resolve();
  await Promise.resolve();
}

test("discarded visibility renders cannot invent a new autofocus session", async () => {
  const env = withDom();
  const { useInputFocusScope } = loadScope("android");
  let suspended = false;
  const pending = new Promise(() => {});
  function Harness({ visible, suspend, revision }) {
    const scope = useInputFocusScope(visible, true, visible);
    if (suspend) { suspended = true; throw pending; }
    return React.createElement("output", { "data-revision": revision }, scope.session);
  }
  const root = createRoot(env.dom.window.document.getElementById("root"));
  const view = (visible, suspend = false, revision = 0) => React.createElement(React.Suspense, { fallback: "loading" },
    React.createElement(Harness, { visible, suspend, revision }));
  const session = () => env.dom.window.document.querySelector("output").textContent;
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
    env.restore();
  }
});

test("native focus ownership follows the top portal sibling and restores only its own field", async () => {
  const env = withDom();
  const scopeModule = loadScope("android");
  const {
    useInputFocusScope, registerNativeFocusField, markNativeFocus,
    nativeFocusPermitted,
  } = scopeModule;
  const focusLog = [];
  const owners = { parent: null, child: null };

  function Field({ scope, id, focused, log }) {
    const field = React.useRef({}).current;
    React.useLayoutEffect(() => registerNativeFocusField(scope.owner, field, {
      canFocus: () => true,
      focus: () => { log.push(id); },
    }), [field, scope.owner]);
    React.useLayoutEffect(() => {
      if (focused) markNativeFocus(scope.owner, field);
    }, [field, focused, scope.owner]);
    return null;
  }

  function Scope({ active, visible, field, focused, log, onScope }) {
    const scope = useInputFocusScope(active, true, visible);
    onScope(scope.owner);
    return React.createElement(Field, { scope, id: field, focused, log });
  }

  function Tree({ parentActive, parentVisible = true, childOpen }) {
    return React.createElement(React.Fragment, null,
      React.createElement(Scope, {
        active: parentActive, visible: parentVisible, field: "link", focused: true, log: focusLog,
        onScope: (owner) => { owners.parent = owner; },
      }),
      React.createElement(Scope, {
        active: childOpen, visible: childOpen, field: "find-folder", focused: childOpen, log: focusLog,
        onScope: (owner) => { owners.child = owner; },
      }));
  }

  const root = createRoot(env.dom.window.document.getElementById("root"));
  try {
    await React.act(() => root.render(React.createElement(Tree, { parentActive: true, childOpen: false })));
    assert.equal(nativeFocusPermitted(owners.parent), true, "the open Save dialog owns native focus");
    assert.equal(nativeFocusPermitted(null), false, "the library field is background while Save is open");

    // The folder picker becomes the top sibling. The suspended dialog keeps
    // its last field but may not take focus back.
    await React.act(() => root.render(React.createElement(Tree, { parentActive: false, childOpen: true })));
    await flushMicrotasks();
    assert.deepEqual(focusLog, [], "opening a child never restores the obscured parent");
    assert.equal(nativeFocusPermitted(owners.child), true, "the picker owns native focus");
    assert.equal(nativeFocusPermitted(owners.parent), false, "the obscured Save dialog refuses focus");
    assert.equal(nativeFocusPermitted(null), false, "background search refuses focus even during the handoff");

    // An outside tap closes only the picker. The immediate parent resumes the
    // field the user actually left, without waiting for a fresh opening.
    await React.act(() => root.render(React.createElement(Tree, { parentActive: true, childOpen: false })));
    await flushMicrotasks();
    assert.deepEqual(focusLog, ["link"], "closing the picker returns the keyboard to Link");
    assert.equal(nativeFocusPermitted(null), false, "the background still never owns focus while Save is open");

    // Opening the child again is a fresh focus handoff, not a parent resume.
    await React.act(() => root.render(React.createElement(Tree, { parentActive: false, childOpen: true })));
    await flushMicrotasks();
    assert.deepEqual(focusLog, ["link"], "a fresh child opening cancels the previous resume");
    await React.act(() => root.render(React.createElement(Tree, { parentActive: true, childOpen: false })));
    await flushMicrotasks();
    assert.deepEqual(focusLog, ["link", "link"], "every picker close resumes the parent once");

    // A real close clears the session. Reopening the same component must not
    // replay the old field focus.
    await React.act(() => root.render(React.createElement(Tree, { parentActive: false, parentVisible: false, childOpen: false })));
    await flushMicrotasks();
    await React.act(() => root.render(React.createElement(Tree, { parentActive: true, childOpen: false })));
    await flushMicrotasks();
    assert.deepEqual(focusLog, ["link", "link"], "a fresh open is not a resume");
    assert.equal(nativeFocusPermitted(owners.parent), true);
    assert.equal(nativeFocusPermitted(null), false);
  } finally {
    await React.act(() => root.unmount());
    env.restore();
  }
});

test("an active parent behind an active child resumes when the child closes", async () => {
  const env = withDom();
  const {
    useInputFocusScope, registerNativeFocusField, markNativeFocus, nativeFocusPermitted,
  } = loadScope("android");
  const focusLog = [];
  const owners = { parent: null, child: null };

  function Field({ scope, id, focused }) {
    const field = React.useRef({}).current;
    React.useLayoutEffect(() => registerNativeFocusField(scope.owner, field, {
      canFocus: () => true,
      focus: () => { focusLog.push(id); },
    }), [field, scope.owner]);
    React.useLayoutEffect(() => {
      if (focused) markNativeFocus(scope.owner, field);
    }, [field, focused, scope.owner]);
    return null;
  }

  function Scope({ active, visible, field, focused, onScope }) {
    const scope = useInputFocusScope(active, true, visible);
    onScope(scope.owner);
    return React.createElement(Field, { scope, id: field, focused });
  }

  // Two live portal siblings: the Save form never sets active=false while the
  // picker is open. Only the top-owner layer ordering changes.
  function Tree({ childOpen }) {
    return React.createElement(React.Fragment, null,
      React.createElement(Scope, {
        active: true, visible: true, field: "link", focused: true,
        onScope: (owner) => { owners.parent = owner; },
      }),
      React.createElement(Scope, {
        active: childOpen, visible: childOpen, field: "find-folder", focused: childOpen,
        onScope: (owner) => { owners.child = owner; },
      }));
  }

  const root = createRoot(env.dom.window.document.getElementById("root"));
  try {
    await React.act(() => root.render(React.createElement(Tree, { childOpen: false })));
    assert.equal(nativeFocusPermitted(owners.parent), true);
    assert.equal(nativeFocusPermitted(owners.child), false);

    await React.act(() => root.render(React.createElement(Tree, { childOpen: true })));
    await flushMicrotasks();
    assert.deepEqual(focusLog, [], "opening the child never refocuses the still-active parent");
    assert.equal(nativeFocusPermitted(owners.parent), false, "the parent is behind the top sibling");
    assert.equal(nativeFocusPermitted(owners.child), true);

    await React.act(() => root.render(React.createElement(Tree, { childOpen: false })));
    await flushMicrotasks();
    assert.deepEqual(focusLog, ["link"], "closing the top sibling resumes the parent field exactly once");
    assert.equal(nativeFocusPermitted(owners.parent), true);
    assert.equal(nativeFocusPermitted(null), false, "the background still never owns focus while Save is open");
  } finally {
    await React.act(() => root.unmount());
    env.restore();
  }
});

test("reactivating a parent behind a live child cannot overtake the child layer", async () => {
  const env = withDom();
  const {
    useInputFocusScope, registerNativeFocusField, markNativeFocus, nativeFocusPermitted,
  } = loadScope("android");
  const focusLog = [];
  const owners = { parent: null, child: null };

  function Field({ scope, id, focused }) {
    const field = React.useRef({}).current;
    React.useLayoutEffect(() => registerNativeFocusField(scope.owner, field, {
      canFocus: () => true,
      focus: () => { focusLog.push(id); },
    }), [field, scope.owner]);
    React.useLayoutEffect(() => {
      if (focused) markNativeFocus(scope.owner, field);
    }, [field, focused, scope.owner]);
    return null;
  }

  function Scope({ active, visible, field, focused, onScope }) {
    const scope = useInputFocusScope(active, true, visible);
    onScope(scope.owner);
    return React.createElement(Field, { scope, id: field, focused });
  }

  function Tree({ parentActive, childOpen }) {
    return React.createElement(React.Fragment, null,
      React.createElement(Scope, {
        active: parentActive, visible: true, field: "link", focused: true,
        onScope: (owner) => { owners.parent = owner; },
      }),
      React.createElement(Scope, {
        active: childOpen, visible: childOpen, field: "find-folder", focused: childOpen,
        onScope: (owner) => { owners.child = owner; },
      }));
  }

  const root = createRoot(env.dom.window.document.getElementById("root"));
  try {
    await React.act(() => root.render(React.createElement(Tree, { parentActive: true, childOpen: false })));
    await React.act(() => root.render(React.createElement(Tree, { parentActive: true, childOpen: true })));
    await flushMicrotasks();
    assert.equal(nativeFocusPermitted(owners.child), true);

    // A reactivated parent (e.g. an interactive/ready churn) must keep its
    // original portal position; it cannot tie with or jump above the child.
    await React.act(() => root.render(React.createElement(Tree, { parentActive: false, childOpen: true })));
    await React.act(() => root.render(React.createElement(Tree, { parentActive: true, childOpen: true })));
    await flushMicrotasks();
    assert.equal(nativeFocusPermitted(owners.child), true, "the child stays top by layer order");
    assert.equal(nativeFocusPermitted(owners.parent), false);
    assert.deepEqual(focusLog, [], "no parent focus while the child is still live");

    await React.act(() => root.render(React.createElement(Tree, { parentActive: true, childOpen: false })));
    await flushMicrotasks();
    assert.deepEqual(focusLog, ["link"], "the parent resumes only after the child actually closes");
  } finally {
    await React.act(() => root.unmount());
    env.restore();
  }
});

test("resume falls back inside the parent when the exact field was removed", async () => {
  const env = withDom();
  const {
    useInputFocusScope, registerNativeFocusField, markNativeFocus, nativeFocusPermitted,
  } = loadScope("android");
  const focusLog = [];
  const owners = {};

  function Field({ scope, id, focused }) {
    const field = React.useRef({}).current;
    React.useLayoutEffect(() => registerNativeFocusField(scope.owner, field, {
      canFocus: () => true,
      focus: () => { focusLog.push(id); },
    }), [field, scope.owner]);
    React.useLayoutEffect(() => {
      if (focused) markNativeFocus(scope.owner, field);
    }, [field, focused, scope.owner]);
    return null;
  }

  function Scope({ active, visible, fields, onScope }) {
    const scope = useInputFocusScope(active, true, visible);
    onScope(scope.owner);
    return React.createElement(React.Fragment, null,
      fields.map((field) => React.createElement(Field, {
        key: field.id, scope, id: field.id, focused: !!field.focused,
      })));
  }

  function Tree({ parentActive, childOpen, fields }) {
    return React.createElement(React.Fragment, null,
      React.createElement(Scope, {
        active: parentActive, visible: true, fields, onScope: (owner) => { owners.parent = owner; },
      }),
      React.createElement(Scope, {
        active: childOpen, visible: childOpen,
        fields: [{ id: "find-folder", focused: childOpen }],
        onScope: (owner) => { owners.child = owner; },
      }));
  }

  const root = createRoot(env.dom.window.document.getElementById("root"));
  try {
    await React.act(() => root.render(React.createElement(Tree, {
      parentActive: true, childOpen: false, fields: [{ id: "link", focused: true }, { id: "tags", focused: false }],
    })));
    await React.act(() => root.render(React.createElement(Tree, {
      parentActive: false, childOpen: true, fields: [{ id: "link", focused: false }, { id: "tags", focused: false }],
    })));
    await flushMicrotasks();
    assert.equal(nativeFocusPermitted(owners.child), true);

    // The row that held focus disappears while the picker is open. Closing
    // still stays in the immediate parent instead of the background.
    await React.act(() => root.render(React.createElement(Tree, {
      parentActive: true, childOpen: false, fields: [{ id: "tags", focused: false }],
    })));
    await flushMicrotasks();
    assert.deepEqual(focusLog, ["tags"], "the parent's first remaining field reclaims the keyboard");
  } finally {
    await React.act(() => root.unmount());
    env.restore();
  }
});

test("web focus ownership never blocks native browser fields", () => {
  const { nativeFocusPermitted, registerNativeFocusField, markNativeFocus } = loadScope("web");
  assert.equal(nativeFocusPermitted(null), true);
  assert.equal(nativeFocusPermitted(7), true, "web uses the DOM focus trap, not the native registry");
  const unregister = registerNativeFocusField(7, {}, { canFocus: () => true, focus() {} });
  assert.equal(typeof unregister, "function");
  markNativeFocus(7, {});
  assert.equal(nativeFocusPermitted(null), true);
});
