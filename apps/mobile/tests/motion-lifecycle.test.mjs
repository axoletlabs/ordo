import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { transformSync } from "@babel/core";
import React from "react";

const require = createRequire(import.meta.url);
const root = resolve(import.meta.dirname, "../src");

/** Execute the actual hooks with a deterministic commit/animation scheduler.
 * This checks interruption and completion ordering, not native visual rendering. */
function harness() {
  const slots = [], effects = [], cache = new Map(), animations = [];
  let cursor = 0, changed = false, reducedMotion = false;
  const depsEqual = (a, b) => a && b && a.length === b.length && a.every((value, i) => Object.is(value, b[i]));
  const effect = (callback, deps) => {
    const index = cursor++, old = slots[index];
    if (old && depsEqual(deps, old.deps)) return;
    effects.push(() => { old?.cleanup?.(); slots[index] = { deps, cleanup: callback() }; });
  };
  const hooks = { ...React,
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
  const spatial = { stiffness: 380, damping: 32, mass: 1 };
  const motion = { effects: { fast: { stiffness: 3800, damping: 124, mass: 1 } } };
  class Value { constructor(value) { this.value = value; } stopAnimation() {} setValue(value) { this.value = value; } }
  function load(filename) {
    if (cache.has(filename)) return cache.get(filename).exports;
    const module = { exports: {} }; cache.set(filename, module);
    const code = transformSync(readFileSync(filename, "utf8"), { filename, babelrc: false, configFile: false, presets: ["babel-preset-expo"] }).code;
    const localRequire = id => {
      if (id === "react") return hooks;
      if (id === "react-native") return { Platform: { OS: "web" }, StyleSheet: { flatten: value => value },
        Animated: { Value, View: "AnimatedView", spring: (value, config) => ({ start() { animations.push(config); }, stop() {} }) },
        AppState: { addEventListener: () => ({ remove() {} }) } };
      if (id === "react-native-reanimated") return { cancelAnimation: cancel, runOnJS: callback => callback,
        useSharedValue: value => hooks.useRef(shared(value)).current,
        Easing: { quad: value => value, inOut: fn => fn },
        withTiming: (target, config, callback) => ({ animation: true, target, config, callback }),
        withSpring: (target, config) => ({ animation: true, target, config }),
      };
      if (id.endsWith("/material-motion")) return { materialMotion: motion, useMaterialMotion: () => ({ reducedMotion, spatial }) };
      if (id.endsWith("/use-keyboard-visible")) return { dismissKeyboard() {} };
      if (id.startsWith(".")) {
        const file = resolve(dirname(filename), id);
        for (const extension of [".ts", ".tsx"]) {
          try { readFileSync(file + extension); } catch { continue; }
          return load(file + extension);
        }
      }
      return require(id);
    };
    new Function("require", "module", "exports", code)(localRequire, module, module.exports);
    return module.exports;
  }
  return {
    load: path => load(resolve(root, path)), animations,
    render(callback, options = {}) {
      reducedMotion = options.reducedMotion ?? reducedMotion;
      let result, commits = 0;
      do {
        changed = false; cursor = 0; effects.length = 0;
        result = callback(); effects.forEach(effect => effect());
        assert.ok(++commits < 10, "Commit loop did not settle");
      } while (changed);
      return result;
    },
  };
}

test("a measured overlay starts its entrance after ready, not while invisible", () => {
  const h = harness(), { useOverlayPresence } = h.load("hooks/use-overlay-presence.ts");
  const dismiss = () => {};
  const waiting = h.render(() => useOverlayPresence(true, dismiss, { ready: false }));
  assert.equal(waiting.rendered, true);
  assert.equal(waiting.progress.value, 0);
  assert.equal(h.animations.length, 0);
  const opening = h.render(() => useOverlayPresence(true, dismiss, { ready: true }));
  assert.equal(opening.progress.value, 0);
  assert.equal(opening.progress.animation.target, 1);
  opening.progress.complete();
  assert.equal(opening.progress.value, 1);
});

test("stale close completion cannot unmount a reopened overlay", () => {
  const h = harness(), { useOverlayPresence } = h.load("hooks/use-overlay-presence.ts");
  const dismiss = () => {};
  const open = h.render(() => useOverlayPresence(true, dismiss));
  open.progress.complete();
  const closing = h.render(() => useOverlayPresence(false, dismiss));
  const staleCallback = closing.progress.animation.callback;
  h.render(() => useOverlayPresence(true, dismiss));
  staleCallback(true);
  assert.equal(h.render(() => useOverlayPresence(true, dismiss)).rendered, true);
  // Dismiss the test instance so its fallback timer is cleaned up.
  const final = h.render(() => useOverlayPresence(false, dismiss));
  final.progress.complete();
  assert.equal(h.render(() => useOverlayPresence(false, dismiss)).rendered, false);
});

test("live reduced motion settles an in-flight entrance immediately", () => {
  const h = harness(), { useOverlayPresence } = h.load("hooks/use-overlay-presence.ts");
  const dismiss = () => {};
  h.render(() => useOverlayPresence(true, dismiss));
  const reduced = h.render(() => useOverlayPresence(true, dismiss), { reducedMotion: true });
  assert.equal(reduced.progress.animation, null);
  assert.equal(reduced.spatial.animation, null);
  assert.equal(reduced.progress.value, 1);
  assert.equal(reduced.spatial.value, 1);
});

test("state-layer release retains its ink throughout the exit fade", () => {
  const h = harness(), { StateLayer } = h.load("components/ui/StateLayer.tsx");
  const paint = fraction => h.render(() => StateLayer({ color: "#ffffff", fraction }));
  assert.equal(paint(0.1).props.style.at(-1).backgroundColor, "#ffffff1a");
  const released = paint(0);
  assert.equal(released.props.style.at(-1).backgroundColor, "#ffffff1a");
  assert.equal(h.animations.at(-1).toValue, 0);
  assert.equal(paint(0.08).props.style.at(-1).backgroundColor, "#ffffff14");
});

test("reduced-motion dismissal removes the overlay without waiting for animation callbacks", () => {
  const h = harness(), { useOverlayPresence } = h.load("hooks/use-overlay-presence.ts");
  const dismiss = () => {};
  h.render(() => useOverlayPresence(true, dismiss), { reducedMotion: true });
  const closed = h.render(() => useOverlayPresence(false, dismiss));
  assert.equal(closed.rendered, false);
  assert.equal(closed.progress.value, 0);
  assert.equal(closed.spatial.value, 0);
  assert.equal(h.animations.length, 0);
});
