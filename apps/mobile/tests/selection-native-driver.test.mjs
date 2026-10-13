import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { transformSync } from "@babel/core";
import React from "react";

const require = createRequire(import.meta.url);
const nativeRoot = dirname(require.resolve("react-native/package.json"));
const root = resolve(import.meta.dirname, "../src");

/** Execute RN's real animated arithmetic, native graph promotion and driver
 * guard. The bridge and completion clock are simulated: this is NOT an FPS
 * measurement or an Android touch integration test. */
function harness(platform = "android") {
  const cache = new Map(), slots = [], effects = [], animations = [], nodes = [];
  let cursor = 0, changed = false, reducedMotion = false, expressive = false, tag = 0;
  const equal = (a, b) => a && b && a.length === b.length && a.every((value, index) => Object.is(value, b[index]));
  const hooks = { ...React,
    useRef: initial => slots[cursor++] ??= { current: initial },
    useState: initial => {
      const index = cursor++;
      slots[index] ??= { value: initial };
      return [slots[index].value, value => {
        const next = typeof value === "function" ? value(slots[index].value) : value;
        if (!Object.is(next, slots[index].value)) { slots[index].value = next; changed = true; }
      }];
    },
    useCallback: (fn, deps) => {
      const index = cursor++;
      if (!slots[index] || !equal(deps, slots[index].deps)) slots[index] = { value: fn, deps };
      return slots[index].value;
    },
    useLayoutEffect: (fn, deps) => {
      const index = cursor++, old = slots[index];
      if (old && equal(deps, old.deps)) return;
      effects.push(() => { old?.cleanup?.(); slots[index] = { deps, cleanup: fn() }; });
    },
  };
  const bridge = {
    API: new Proxy({}, { get: (_target, key) => key === "createAnimatedNode"
      ? (_tag, config) => nodes.push(config) : () => {} }),
    shouldUseNativeDriver: config => config.useNativeDriver,
    generateNewNodeTag: () => ++tag, generateNewAnimationId: () => ++tag,
    assertNativeAnimatedModule() {},
  };
  const spatial = { stiffness: 700, damping: 48, mass: 1 };
  const expressiveSpatial = { stiffness: 380, damping: 31, mass: 1 };
  const materialMotion = { effects: { fast: { stiffness: 3800, damping: 124, mass: 1 } } };
  let Animated;
  const flatten = style => Array.isArray(style) ? Object.assign({}, ...style.map(flatten)) : style;
  function load(filename) {
    if (cache.has(filename)) return cache.get(filename).exports;
    const module = { exports: {} }; cache.set(filename, module);
    const code = transformSync(readFileSync(filename, "utf8"), {
      filename, babelrc: false, configFile: false, presets: ["babel-preset-expo"],
    }).code;
    const localRequire = id => {
      if (id === "react") return hooks;
      if (id === "react-native") return { Animated, Easing: { out: fn => fn, quad: value => value }, Platform: { OS: platform } };
      if (id.endsWith("/NativeAnimatedHelper")) return bridge;
      if (id.endsWith("/ReactNativeFeatureFlags")) return new Proxy({}, { get: () => () => false });
      if (id.endsWith("/Platform")) return { OS: platform };
      if (id.endsWith("/normalizeColor") || id.endsWith("/processColor")) return value => value;
      if (id.endsWith("/Easing")) return { linear: value => value };
      if (id.endsWith("/AnimatedProps")) return class AnimatedProps {};
      if (id.endsWith("/flattenStyle")) return flatten;
      if (id.endsWith("/material-motion")) return { materialMotion,
        useMaterialMotion: () => ({ reducedMotion, spatial: expressive ? expressiveSpatial : spatial }) };
      if (id.startsWith(".")) {
        const path = resolve(dirname(filename), id);
        for (const extension of [".js", ".ts", ".tsx"]) {
          try { readFileSync(path + extension); } catch { continue; }
          return load(path + extension);
        }
      }
      return require(id);
    };
    new Function("require", "module", "exports", "__DEV__", code)(localRequire, module, module.exports, false);
    return module.exports;
  }
  const native = path => load(resolve(nativeRoot, `Libraries/Animated/${path}.js`)).default;
  const Value = native("nodes/AnimatedValue"), Style = native("nodes/AnimatedStyle"), Animation = native("animations/Animation");
  const Addition = native("nodes/AnimatedAddition"), Multiply = native("nodes/AnimatedMultiplication"), Divide = native("nodes/AnimatedDivision");
  const start = (value, config) => {
    const nativeAnimation = new Animation(config);
    nativeAnimation.__getNativeAnimationConfig = () => ({ type: "spring" });
    let record;
    return {
      start(callback) {
        record = { value, config, callback, active: true, complete() {
          if (!this.active) return;
          this.active = false; value.setValue(config.toValue); callback?.({ finished: true });
        } };
        animations.push(record);
        nativeAnimation.start(value.__getValue(), () => {}, () => {}, null, value);
        nativeAnimation.__startAnimationIfNative(value);
      },
      stop() { if (record?.active) { record.active = false; record.callback?.({ finished: false }); } },
    };
  };
  const parallel = children => {
    let callback, remaining;
    return { start(fn) {
      callback = fn; remaining = children.length;
      if (!remaining) return fn?.({ finished: true });
      children.forEach(child => child.start(result => { if (!result.finished) callback?.(result); else if (!--remaining) callback?.(result); }));
    }, stop() { children.forEach(child => child.stop()); } };
  };
  const sequence = children => {
    let index = 0, callback;
    const next = result => {
      if (!result.finished || index === children.length) return callback?.(result);
      children[index++].start(next);
    };
    return { start(fn) { callback = fn; next({ finished: true }); }, stop() { children[index - 1]?.stop(); } };
  };
  Animated = { Value, spring: start, timing: start, parallel, sequence,
    add: (a, b) => new Addition(a, b), multiply: (a, b) => new Multiply(a, b),
    subtract: (a, b) => new Addition(a, new Multiply(b, -1)), divide: (a, b) => new Divide(a, b) };
  const { useSelectionBarMotion } = load(resolve(root, "hooks/use-selection-bar-motion.ts"));
  const { stretchablePillMotion } = load(resolve(root, "lib/stretchable-pill-motion.ts"));
  return {
    animations, nodes, Animated, stretchablePillMotion,
    render(keys, width = 342, pressed = null, options = {}) {
      reducedMotion = options.reducedMotion ?? reducedMotion; expressive = options.expressive ?? expressive;
      let result, commits = 0;
      do {
        changed = false; cursor = 0; effects.length = 0;
        result = useSelectionBarMotion(keys, width, pressed);
        effects.forEach(fn => fn()); assert.ok(++commits < 10, "Render loop");
      } while (changed);
      return result;
    },
    settle() {
      let passes = 0;
      while (animations.some(item => item.active)) {
        animations.filter(item => item.active).forEach(item => item.complete());
        assert.ok(++passes < 10, "Animation loop");
      }
    },
    attach(style) { const node = Style.from(style); node.__attach(); node.__makeNative(); return node; },
  };
}

const all = ["read", "move", "more", "delete"];
for (const platform of ["android", "ios", "web"]) {
  test(`${platform}: deletion only animates one changing coordinate, after departures finish`, () => {
    const h = harness(platform);
    h.render(all); h.settle();
    const start = h.animations.length;
    let motion = h.render(["delete"]);
    assert.equal(motion.geometryReady, false);
    assert.deepEqual(motion.retainedKeys, ["delete", "read", "move", "more"]);
    assert.equal(h.animations.length - start, 1, "Only the fade may start before Delete moves");
    assert.equal(h.animations.at(-1).config.toValue, 0);
    h.animations.at(-1).complete();
    assert.equal(h.animations.length - start, 2, "Exactly one resize spring, not eight object-member springs");
    assert.equal(h.animations.at(-1).value, motion.values.get("delete").width);
    assert.ok(h.animations.slice(start).every(item => item.config.useNativeDriver === (platform !== "web")));
    assert.ok(h.animations.every(item => item.config.isInteraction === false));
    h.settle(); motion = h.render(["delete"]);
    assert.equal(motion.geometryReady, true);
    assert.deepEqual(motion.retainedKeys, ["delete"]);
    assert.equal(motion.values.get("delete").width.__getValue(), 342);
  });
}

test("native pill arithmetic exactly preserves painted edges, cap dimensions and text scale", () => {
  const h = harness(), width = new h.Animated.Value(79.5);
  const graph = h.stretchablePillMotion(width, 342);
  h.attach({ transform: [{ translateX: graph.shift }, { scaleX: graph.scale }] });
  h.attach({ transform: [{ translateX: graph.inverseShift }, { scaleX: graph.inverseScale }] });
  for (let frame = 0; frame <= 120; frame++) {
    const paintedWidth = 79.5 + (342 - 79.5) * frame / 120;
    width.setValue(paintedWidth);
    const scale = graph.scale.__getValue(), shift = graph.shift.__getValue();
    assert.ok(Math.abs(171 + shift + 171 * scale - 342) < 0.00001);
    assert.ok(Math.abs(scale * graph.inverseScale.__getValue() - 1) < 0.00001);
    assert.ok(Math.abs(342 - graph.leadingShift.__getValue() - paintedWidth) < 0.00001);
    assert.ok(Math.abs(graph.middleScale.__getValue() * 294 + 48 - paintedWidth) < 0.00001);
  }
  assert.ok(h.nodes.some(node => node.type === "division"), "Counter-scaling must compile into native arithmetic");
  assert.equal(width.hasListeners(), false, "No per-frame bridge listener");
});

test("an interrupted resize retargets safely even when only the motion scheme changes", () => {
  const h = harness(); h.render(all); h.settle();
  h.render(["delete"]); h.animations.at(-1).complete();
  const old = h.animations.at(-1);
  h.render(["delete"], 342, null, { expressive: true });
  assert.equal(old.active, false);
  const restarted = h.animations.findLast(item => item.value === old.value);
  assert.equal(restarted.config.toValue, 342);
  assert.notEqual(restarted, old);
  old.callback({ finished: true });
  assert.equal(h.render(["delete"]).geometryReady, false, "A stale completion cannot enable returning controls");
  h.settle(); assert.equal(h.render(["delete"]).geometryReady, true);
});

test("live reduced motion cancels native work and settles without completion callbacks", () => {
  const h = harness(); h.render(all); h.settle(); h.render(["delete"]);
  const count = h.animations.length;
  const motion = h.render(["delete"], 342, null, { reducedMotion: true });
  assert.equal(h.animations.length, count);
  assert.equal(motion.geometryReady, true);
  assert.equal(motion.values.get("delete").width.__getValue(), 342);
  assert.deepEqual(motion.retainedKeys, ["delete"]);
});

test("retargeting during departure cannot hand still-visible slots to the resize", () => {
  const h = harness(); h.render(all); h.settle();
  const start = h.animations.length;
  const motion = h.render(["delete"]);
  h.render(["delete"], 792);
  assert.equal(h.animations.length - start, 2, "Only fade animations start before the barrier");
  assert.ok(h.animations.slice(start).every(item => item.value === motion.departureOpacity));
  h.animations.at(-1).complete();
  assert.equal(h.animations.at(-1).value, motion.values.get("delete").width);
  assert.equal(h.animations.at(-1).config.toValue, 792);
  h.settle(); assert.equal(h.render(["delete"], 792).geometryReady, true);
});

test("stale exit completion cannot unmount a reopened native toolbar", () => {
  const h = harness(); h.render(all); h.settle();
  h.render([]);
  const stale = h.animations.filter(item => item.active).map(item => item.callback);
  h.render(all);
  stale.forEach(callback => callback?.({ finished: true }));
  assert.equal(h.render(all).shown, true);
  h.settle();
  h.render([], 342, null, { reducedMotion: true });
  assert.equal(h.render([]).shown, false);
});

test("native hit-testing is opt-in and cannot replace existing synthetic-event consumers", () => {
  const source = readFileSync(resolve(root, "components/ui/PressableScale.tsx"), "utf8");
  assert.match(source, /nativeGesture && Platform\.OS !== "web" \? NativeGesturePressable : Pressable/);
  assert.match(source, /nativeGesture && Platform\.OS !== "web" \? AnimatedGesturePressable : AnimatedPressable/);
  assert.match(readFileSync(resolve(root, "components/bookmarks/SelectionActionBar.tsx"), "utf8"), /canvasWidth=\{canvasWidth\} nativeGesture/);
});
