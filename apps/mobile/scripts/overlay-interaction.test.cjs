/** Run with: node --test apps/mobile/scripts/overlay-interaction.test.cjs
 *
 * Regression tests for the shared overlay interaction primitives:
 * - hooks/use-overlay-presence.ts exit sequencing (sequential-exit latency,
 *   retained exit trees, onExiting/onExited handoff semantics, interruption)
 * - lib/overlay-registry.ts stacking (an exiting surface yields to a sibling)
 *
 * The harness executes the actual hook source with a deterministic commit and
 * animation scheduler: no renderer, no native modules, effects flush in order
 * and animation completions are driven by hand. It checks completion ordering
 * and callback timing, not visual rendering.
 */
const assert = require("node:assert/strict");
const { test } = require("node:test");
const { readFileSync } = require("node:fs");
const { resolve, dirname } = require("node:path");
const ts = require("typescript");

function harness() {
  const slots = [], effects = [], cache = new Map(), animations = [];
  let cursor = 0, changed = false, reducedMotion = false;
  const depsEqual = (a, b) => a && b && a.length === b.length && a.every((value, i) => Object.is(value, b[i]));
  const effect = (callback, deps) => {
    const index = cursor++, old = slots[index];
    if (old && depsEqual(deps, old.deps)) return;
    effects.push(() => { old?.cleanup?.(); slots[index] = { deps, cleanup: callback() }; });
  };
  const hooks = {
    useRef: value => slots[cursor++] ??= { current: value },
    useState: initial => {
      const index = cursor++;
      slots[index] ??= { value: initial };
      return [slots[index].value, value => {
        const next = typeof value === "function" ? value(slots[index].value) : value;
        if (!Object.is(next, slots[index].value)) { slots[index].value = next; changed = true; }
      }];
    },
    useCallback: (callback, deps) => {
      const index = cursor++;
      if (!slots[index] || !depsEqual(deps, slots[index].deps)) slots[index] = { deps, value: callback };
      return slots[index].value;
    },
    useLayoutEffect: effect, useEffect: effect,
  };
  const cancel = value => {
    const animation = value.animation;
    value.animation = null;
    animation?.callback?.(false);
  };
  const shared = initial => {
    let current = initial;
    return { animation: null,
      get value() { return current; },
      set value(next) {
        cancel(this);
        if (next?.animation) { this.animation = next; animations.push(next); }
        else current = next;
      },
      complete() {
        const animation = this.animation;
        if (!animation) return;
        this.animation = null; current = animation.target; animation.callback?.(true);
      },
    };
  };
  const spatial = { stiffness: 700, damping: 52, mass: 1 };
  function load(filename) {
    if (cache.has(filename)) return cache.get(filename).exports;
    const module = { exports: {} }; cache.set(filename, module);
    const source = readFileSync(filename, "utf8");
    const { outputText } = ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    });
    const localRequire = (id) => {
      if (id === "react") return hooks;
      if (id === "react-native") return { Platform: { OS: "web" }, AppState: { addEventListener: () => ({ remove() {} }) } };
      if (id === "react-native-reanimated") return {
        cancelAnimation: cancel, runOnJS: callback => callback,
        useSharedValue: value => hooks.useRef(shared(value)).current,
        Easing: { quad: value => value, inOut: fn => fn },
        withTiming: (target, config, callback) => ({ animation: true, target, config, callback }),
        withSpring: (target, config) => ({ animation: true, target, config }),
      };
      if (id.endsWith("/material-motion")) return { useMaterialMotion: () => ({ reducedMotion, spatial }) };
      if (id.endsWith("/use-keyboard-visible")) return { dismissKeyboard() {} };
      if (id.startsWith(".")) {
        const file = resolve(dirname(filename), id);
        for (const extension of [".ts", ".tsx"]) {
          try { readFileSync(file + extension); } catch { continue; }
          return load(file + extension);
        }
      }
      throw new Error(`unmocked import: ${id} (from ${filename})`);
    };
    new Function("require", "module", "exports", outputText)(localRequire, module, module.exports);
    return module.exports;
  }
  return {
    load: path => load(resolve(__dirname, path)), animations,
    render(callback, options = {}) {
      reducedMotion = options.reducedMotion ?? reducedMotion;
      let commits = 0, result;
      do {
        changed = false; cursor = 0; effects.length = 0;
        result = callback(); effects.forEach(effect => effect());
        assert.ok(++commits < 10, "Commit loop did not settle");
      } while (changed);
      this.lastCommits = commits;
      return result;
    },
    lastCommits: 0,
    unmount() { slots.forEach(slot => slot?.cleanup?.()); },
  };
}

const PRESENCE = "../src/hooks/use-overlay-presence.ts";

test("exit handoff fires with the completed animation, before any further commit", () => {
  const h = harness(), { useOverlayPresence } = h.load(PRESENCE);
  let exits = 0;
  const render = visible => h.render(() => useOverlayPresence(visible, () => {}, { onExited: () => exits++ }));
  render(true);
  // Complete the entrance so the surface is fully shown.
  h.animations.splice(0).forEach(animation => animation.callback?.(true));
  render(true);
  render(false);
  assert.equal(exits, 0, "handoff must not fire while the exit fade is still running");
  // Drive the exit timing to completion. The handoff releases in this very
  // task — synchronously with the animation callback — not one commit later.
  h.animations.splice(0).forEach(animation => animation.callback?.(true));
  assert.equal(exits, 1, "handoff fires in the same task as the completed exit animation");
  render(false);
  assert.equal(h.lastCommits, 1, "the exit unmount settles in a single commit");
  assert.equal(exits, 1);
});

test("the fallback timer and animation callback race cannot double-fire the handoff", t => {
  const h = harness(), { useOverlayPresence } = h.load(PRESENCE);
  let exits = 0;
  const render = visible => h.render(() => useOverlayPresence(visible, () => {}, { onExited: () => exits++ }));
  render(true);
  h.animations.splice(0).forEach(animation => animation.callback?.(true));
  render(true);
  t.mock.timers.enable({ apis: ["setTimeout"] });
  try {
    render(false);
    t.mock.timers.tick(300); // CLOSE_FALLBACK_MS lands first
    assert.equal(exits, 1);
    h.animations.splice(0).forEach(animation => animation.callback?.(true)); // late animation callback
    assert.equal(exits, 1, "a second completion of the same exit must not re-fire the handoff");
    render(false);
    assert.equal(exits, 1);
  } finally {
    t.mock.timers.reset();
  }
});

test("a sibling handoff runs once per completed exit, and reopening cancels a pending one", () => {
  const h = harness(), { useOverlayPresence } = h.load(PRESENCE);
  let exits = 0;
  const render = visible => h.render(() => useOverlayPresence(visible, () => {}, { onExited: () => exits++ }));
  render(true);
  h.animations.splice(0).forEach(animation => animation.callback?.(true));
  render(true);
  // Close, then reopen before the exit animation completes.
  render(false);
  const stale = h.animations.at(-1);
  render(true);
  stale.callback?.(true);
  render(true);
  assert.equal(exits, 0, "a stale close completion cannot fire the handoff of a reopened overlay");
  render(false);
  h.animations.splice(0).forEach(animation => animation.callback?.(true));
  render(false);
  assert.equal(exits, 1);
});

test("unmounting the owner cancels a pending exit handoff", () => {
  const h = harness(), { useOverlayPresence } = h.load(PRESENCE);
  let exits = 0;
  const render = visible => h.render(() => useOverlayPresence(visible, () => {}, { onExited: () => exits++ }));
  render(true);
  h.animations.splice(0).forEach(animation => animation.callback?.(true));
  render(false);
  const late = h.animations.at(-1);
  h.unmount();
  late.callback?.(true);
  assert.equal(exits, 0, "a late animation callback must not open a sibling after navigation/unmount");
});

test("onExiting fires once at exit start while the tree is retained for the fade", () => {
  const h = harness(), { useOverlayPresence } = h.load(PRESENCE);
  const events = [];
  const render = visible => h.render(() => useOverlayPresence(visible, () => {}, {
    onExiting: () => events.push("exiting"),
    onExited: () => events.push("exited"),
  }));
  render(true);
  h.animations.splice(0).forEach(animation => animation.callback?.(true));
  const shown = render(true);
  assert.equal(shown.rendered, true);
  const closing = render(false);
  assert.deepEqual(events, ["exiting"], "the handoff hook fires as the fade begins");
  assert.equal(closing.rendered, true, "the exiting tree stays mounted through the fade");
  h.animations.splice(0).forEach(animation => animation.callback?.(true));
  const closed = render(false);
  assert.equal(closed.rendered, false);
  assert.deepEqual(events, ["exiting", "exited"], "each hook fires exactly once, in order");
});

test("onExiting does not re-fire when effects re-run mid-exit", () => {
  const h = harness(), { useOverlayPresence } = h.load(PRESENCE);
  let exiting = 0;
  const render = (visible, reduced) => h.render(() => useOverlayPresence(visible, () => {}, { onExiting: () => exiting++ }), { reducedMotion: reduced });
  render(true, false);
  h.animations.splice(0).forEach(animation => animation.callback?.(true));
  render(true, false);
  render(false, false);
  render(false, true); // reduced-motion preference flips during the exit fade
  assert.equal(exiting, 1);
  h.animations.splice(0).forEach(animation => animation.callback?.(true));
  render(false, true);
  assert.equal(exiting, 1);
});

test("onExiting stays silent for surfaces that never rendered", () => {
  const h = harness(), { useOverlayPresence } = h.load(PRESENCE);
  let exiting = 0, exits = 0;
  const render = visible => h.render(() => useOverlayPresence(visible, () => {}, {
    onExiting: () => exiting++, onExited: () => exits++,
  }));
  render(false);
  render(false);
  assert.equal(exiting, 0);
  assert.equal(exits, 0);
});

test("reduced-motion dismissal releases both hooks immediately", () => {
  const h = harness(), { useOverlayPresence } = h.load(PRESENCE);
  const events = [];
  const render = visible => h.render(() => useOverlayPresence(visible, () => {}, {
    onExiting: () => events.push("exiting"), onExited: () => events.push("exited"),
  }), { reducedMotion: true });
  const shown = render(true);
  assert.equal(shown.rendered, true);
  assert.equal(shown.progress.value, 1);
  const closed = render(false);
  assert.equal(closed.rendered, false);
  assert.equal(closed.progress.value, 0);
  assert.deepEqual(events, ["exiting", "exited"]);
  assert.equal(h.animations.length, 0);
});

test("a close before the entrance started releases both hooks in the close task", () => {
  const h = harness(), { useOverlayPresence } = h.load(PRESENCE);
  const events = [];
  const options = {
    ready: false,
    onExiting: () => events.push("exiting"), onExited: () => events.push("exited"),
  };
  const gated = h.render(() => useOverlayPresence(true, () => {}, options));
  assert.equal(gated.rendered, true);
  assert.equal(gated.progress.value, 0, "entrance held while not ready");
  const closing = h.render(() => useOverlayPresence(false, () => {}, options));
  // Nothing was ever painted, so there is no exit to watch: a rapid open/close
  // must not retain an invisible blocking layer for the 200ms fade.
  assert.equal(closing.rendered, false);
  assert.deepEqual(events, ["exiting", "exited"]);
  assert.equal(h.animations.length, 0, "no exit animation is allocated");
});

test("registry: an exiting surface yields top-blocking to an active sibling", () => {
  const { createOverlayRegistry, topBlockingLayer } = harness().load("../src/lib/overlay-registry.ts");
  const api = createOverlayRegistry();
  api.upsert("menu", { kind: "menu" }, true, true);
  assert.equal(topBlockingLayer(api.getLayers()), "menu");
  // The menu begins exiting (visible=false → active=false) while its
  // successor opens: the sibling takes over blocking, background, and focus.
  api.upsert("menu", { kind: "menu" }, true, false);
  api.upsert("panel", { kind: "panel" }, true, true);
  assert.equal(topBlockingLayer(api.getLayers()), "panel");
  api.upsert("menu", null);
  assert.equal(topBlockingLayer(api.getLayers()), "panel");
  assert.ok(api.isBlocked());
  api.upsert("panel", null);
  assert.equal(api.isBlocked(), false);
  assert.deepEqual(api.getLayers(), []);
});

test("registry: upsert is idempotent for identical layers and removal of unknown ids is a no-op", () => {
  const { createOverlayRegistry } = harness().load("../src/lib/overlay-registry.ts");
  let notifications = 0;
  const api = createOverlayRegistry();
  const unsubscribe = api.subscribe(() => notifications++);
  const node = { kind: "menu" };
  api.upsert("menu", node, true, true);
  assert.equal(notifications, 1);
  api.upsert("menu", node, true, true);
  assert.equal(notifications, 1, "identical node and flags must not notify");
  api.upsert("missing", null);
  assert.equal(notifications, 1);
  api.upsert("menu", node, false, true);
  assert.equal(notifications, 2);
  unsubscribe();
  api.upsert("menu", null);
  assert.equal(notifications, 2, "unsubscribed listeners are not notified");
});
