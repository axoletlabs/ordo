import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { test } from "node:test";
import { transformSync } from "@babel/core";
import React from "react";

const require = createRequire(import.meta.url);
const nativeRoot = dirname(require.resolve("react-native/package.json"));
const sourceRoot = resolve(import.meta.dirname, "../src");

/** Run the real RN Animated graph and driver guard without a device. Only the
 * native bridge, frame scheduling and React hook lifecycle are simulated. */
function harness(platform = "android") {
  const cache = new Map(), refs = [], effects = [], effectStates = [], animations = [];
  let cursor = 0, expressive = true, reducedMotion = false, tag = 0;
  const bridge = {
    API: new Proxy({}, { get: () => () => {} }),
    shouldUseNativeDriver: config => config.useNativeDriver,
    generateNewNodeTag: () => ++tag,
    generateNewAnimationId: () => ++tag,
    assertNativeAnimatedModule() {},
  };
  const hooks = { ...React,
    useRef: value => { const index = cursor++; return refs[index] ??= { current: value }; },
    useEffect: (effect, deps) => {
      const index = cursor++, previous = effectStates[index];
      if (previous && deps.every((value, i) => Object.is(value, previous.deps[i]))) return;
      effects.push(() => {
        previous?.cleanup?.();
        effectStates[index] = { deps, cleanup: effect() };
      });
    },
  };
  const motion = { effects: { fast: { stiffness: 1400, damping: 80, mass: 1 } } };
  const flatten = style => Array.isArray(style) ? Object.assign({}, ...style.map(flatten)) : style;
  let Animated;
  function load(filename) {
    if (cache.has(filename)) return cache.get(filename).exports;
    const module = { exports: {} }; cache.set(filename, module);
    const code = transformSync(readFileSync(filename, "utf8"), {
      filename, babelrc: false, configFile: false,
      presets: ["babel-preset-expo"],
    }).code;
    const localRequire = id => {
      if (id === "react") return hooks;
      if (id === "react-native") return { Animated, Platform: { OS: platform }, StyleSheet: { absoluteFill: {}, flatten } };
      if (id.endsWith("/NativeAnimatedHelper")) return bridge;
      if (id.endsWith("/NativeAnimatedValidation")) return new Proxy({}, { get: () => () => {} });
      if (id.endsWith("/ReactNativeFeatureFlags")) return new Proxy({}, { get: () => () => false });
      if (id.endsWith("/Platform")) return { OS: platform };
      if (id.endsWith("/normalizeColor") || id.endsWith("/processColor")) return value => value;
      if (id.endsWith("/Easing")) return { linear: value => value };
      if (id.endsWith("/AnimatedProps")) return class AnimatedProps {};
      if (id.endsWith("/ThemeProvider")) return { useTheme: () => ({ palette: { onSurface: "#ffffff" } }) };
      if (id.endsWith("/material-motion")) return { materialMotion: motion, useMaterialMotion: () => ({ reducedMotion }) };
      if (id.startsWith(".")) {
        const path = resolve(dirname(filename), id);
        for (const extension of [".js", ".ts", ".tsx"]) {
          try { readFileSync(path + extension); } catch { continue; }
          return load(path + extension);
        }
        throw new Error(`Unresolved module: ${id}`);
      }
      return require(id);
    };
    new Function("require", "module", "exports", "__DEV__", code)(localRequire, module, module.exports, false);
    return module.exports;
  }
  const native = path => load(resolve(nativeRoot, `Libraries/Animated/${path}.js`)).default;
  const Value = native("nodes/AnimatedValue");
  const Style = native("nodes/AnimatedStyle");
  const Animation = native("animations/Animation");
  Animated = { Value, View: "AnimatedView", spring: (value, config) => {
    const animation = new Animation(config);
    // Use RN's actual start guard and native graph promotion. No spring frames
    // are needed to reproduce this crash; it happens before the first frame.
    animation.__getNativeAnimationConfig = () => ({ type: "spring" });
    return { start() {
      animations.push(config);
      animation.start(value.__getValue(), () => {}, () => {}, null, value);
      animation.__startAnimationIfNative(value);
    }, stop: () => animation.stop() };
  } };
  const { RowHighlight } = load(resolve(sourceRoot, "components/bookmarks/RowHighlight.tsx"));
  const { useStateVisibility } = load(resolve(sourceRoot, "components/ui/StateLayer.tsx"));
  let attached = [];
  return {
    animations,
    render(props = {}, options = {}) {
      expressive = options.expressive ?? expressive;
      reducedMotion = options.reducedMotion ?? reducedMotion;
      cursor = 0; effects.length = 0;
      const tree = RowHighlight({ rest: { borderTopLeftRadius: 16, borderTopRightRadius: 16, borderBottomLeftRadius: 4, borderBottomRightRadius: 4 },
        expressive, hovered: false, pressed: false, selected: false, ...props });
      const styles = React.Children.toArray(tree.props.children).map(child => Style.from(flatten(child.props.style)));
      styles.forEach(style => style.__attach());
      attached.forEach(style => style.__detach());
      attached = styles;
      effects.forEach(effect => effect());
      return styles.map(style => flatten(style.__getValue()));
    },
    standalone(active) { cursor = 0; effects.length = 0; const value = useStateVisibility(active); effects.forEach(effect => effect()); return value; },
  };
}

for (const platform of ["android", "ios", "web"]) {
  test(`${platform}: repeated Expressive row feedback never promotes the JS corner graph`, () => {
    const row = harness(platform);
    row.render();
    for (let i = 0; i < 3; i++) {
      row.render({ hovered: true });
      row.render({ hovered: true, pressed: true, selected: true });
      row.render({ selected: true });
      row.render();
    }
    assert.ok(row.animations.length > 0);
    assert.ok(row.animations.every(config => config.useNativeDriver === false));
  });

  test(`${platform}: mode switches and reduced motion retain safe row drivers`, () => {
    const row = harness(platform);
    row.render({}, { expressive: false });
    row.render({ selected: true });
    row.render({ selected: true, pressed: true }, { expressive: true });
    const before = row.animations.length;
    const styles = row.render({ selected: false }, { reducedMotion: true });
    assert.equal(row.animations.length, before);
    assert.equal(styles[1].opacity, 0);
    assert.equal(styles[2].opacity, 0);
    assert.equal(styles[0].borderBottomLeftRadius, 4);
    row.render({ hovered: true, selected: true }, { reducedMotion: false });
    row.render({}, { expressive: false });
    assert.ok(row.animations.every(config => config.useNativeDriver === false));
  });

  test(`${platform}: standalone opacity keeps its platform driver`, () => {
    const control = harness(platform);
    control.standalone(false); control.standalone(true);
    assert.equal(control.animations.at(-1).useNativeDriver, platform !== "web");
  });
}
