#!/usr/bin/env node
/** Shared paint/animation ownership regressions; no native runtime required.
 * node --test apps/mobile/scripts/test-control-motion.mjs
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";
import ts from "typescript";

function loadSource(path, imports = {}) {
  const filename = new URL(path, import.meta.url);
  const { outputText } = ts.transpileModule(readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React },
  });
  const module = { exports: {} };
  vm.runInThisContext(`(function(require,module,exports){${outputText}\n})`, { filename: filename.pathname })(
    name => {
      assert.ok(Object.hasOwn(imports, name), `Unexpected import: ${name}`);
      return imports[name];
    }, module, module.exports,
  );
  return module.exports;
}

function surface() {
  let cursor = 0;
  const cells = [], animatedStyles = new WeakSet();
  const react = {
    createElement: (type, props, ...children) => ({ type, props: { ...props,
      children: children.length === 0 ? props?.children : children.length === 1 ? children[0] : children } }),
    useState(initial) {
      const index = cursor++;
      if (!(index in cells)) cells[index] = initial;
      return [cells[index], next => { cells[index] = next; }];
    },
    useRef(initial) { return cells[cursor++] ??= { current: initial }; },
    // Hold the UI-thread animation at its existing value while React commits
    // new props. Native commits must not independently replace that geometry.
    useEffect() {}, useLayoutEffect() {},
  };
  react.default = react;
  const flatten = style => Array.isArray(style) ? Object.assign({}, ...style.map(flatten)) : style ?? {};
  const motion = { reducedMotion: false, fast: {}, effects: { fast: {} } };
  const { PressableScale } = loadSource("../src/components/ui/PressableScale.tsx", {
    react,
    "react-native": { Platform: { OS: "android" }, Pressable: "Pressable", View: "View", StyleSheet: { flatten } },
    "react-native-reanimated": {
      default: { createAnimatedComponent: () => "AnimatedPressable", View: "AnimatedView" },
      useSharedValue: value => react.useRef({ value }).current,
      useAnimatedStyle: fn => { const style = fn(); animatedStyles.add(style); return style; },
      withSpring: value => value,
    },
    "react-native-gesture-handler": { Pressable: "GesturePressable" },
    "../../theme/ThemeProvider": { useTheme: () => ({ palette: { onSurface: "#ffffff" } }) },
    "../../theme/material-motion": { useMaterialMotion: () => motion, materialMotion: motion },
    "./ButtonGroup": { useButtonGroupInteraction: () => null },
    "./StateLayer": {},
    "../../theme/state-layer": loadSource("../src/theme/state-layer.ts"),
    "./pressable-web": {}, "../../lib/pointer-hover": { nativeHoverEvents: () => ({}) },
  });
  return {
    render(props = {}) {
      cursor = 0;
      let node = PressableScale({ shape: { rest: 20, pressed: 8 }, children: "Label", ...props });
      while (typeof node.type === "function") node = node.type(node.props);
      return node;
    },
    // Reanimated writes these styles separately. This models the static props
    // that React sends to the native view during a selection/theme commit.
    nativePaint: styles => flatten(styles.filter(style => !style || !animatedStyles.has(style))),
    flatten,
  };
}

test("selection cannot overwrite running corner geometry through a native React commit", () => {
  const control = surface();
  const first = control.nativePaint(control.render().props.style);
  const selected = control.nativePaint(control.render({ shape: { rest: 12, pressed: 8 } }).props.style);
  for (const corner of ["borderTopLeftRadius", "borderTopRightRadius", "borderBottomLeftRadius", "borderBottomRightRadius"]) {
    assert.equal(selected[corner], first[corner], `${corner} belongs to the animation, not the selection commit`);
  }
  assert.equal(selected.borderRadius, 0, "shorthand must not compete with animated corners");
});

test("selection commits the container color immediately with its foreground", () => {
  const control = surface();
  control.render({ style: { backgroundColor: "transparent" } });
  const selected = control.render({ style: { backgroundColor: "#b1ccc6" } });
  assert.equal(control.flatten(selected.props.style).backgroundColor, "#b1ccc6");
  const deselected = control.render({ style: { backgroundColor: "transparent" } });
  assert.equal(control.flatten(deselected.props.style).backgroundColor, "transparent");
});

test("hover and press ink paint behind the label rather than tinting it", () => {
  const control = surface();
  const contents = control.render().props.children.props.children;
  assert.equal(contents[0].props.testID, "material-state-layer");
  assert.equal(contents.at(-1), "Label");
});
