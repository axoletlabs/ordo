#!/usr/bin/env node
/** Gesture/measurement regressions without a native runtime:
 * node --test apps/mobile/scripts/test-menu-interaction.mjs
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

const { createMenuAnchorPress } = loadSource("../src/lib/menu-anchor-press.ts");
const rect = { x: 80, y: 24, width: 48, height: 48 };
test("async native measurement keeps a fallback point after its event is recycled", () => {
  const { measureAnchor } = loadSource("../src/lib/menu-anchor.ts");
  let report;
  const event = { nativeEvent: { pageX: 100, pageY: 24 } }, anchors = [];
  measureAnchor({ measureInWindow: callback => { report = callback; } }, anchor => anchors.push(anchor), event);
  event.nativeEvent = null;
  report(0, 0, 0, 0);
  assert.deepEqual(anchors, [{ x: 100, y: 24, width: 1, height: 1 }]);
});

function gesture() {
  const measurements = [], opened = [];
  const press = createMenuAnchorPress((done, event) => measurements.push({ done, event }));
  return { press, measurements, opened, open: anchor => opened.push(anchor) };
}

test("press-in overlaps native measurement with the gesture; activation consumes it once", () => {
  const { press, measurements, opened, open } = gesture();
  press.prepare("down");
  measurements[0].done(rect);
  assert.deepEqual(opened, []);
  press.activate("up", open);
  assert.deepEqual(opened, [rect]);
  assert.equal(measurements.length, 1, "release must not issue a second native measurement");
  measurements[0].done(rect);
  assert.equal(opened.length, 1);
});

test("a fast tap waits for its in-flight measurement without measuring again", async () => {
  const { press, measurements, opened, open } = gesture();
  press.prepare("down");
  press.release();
  press.activate("up", open);
  await Promise.resolve();
  assert.deepEqual(opened, []);
  measurements[0].done(rect);
  assert.deepEqual(opened, [rect]);
  assert.equal(measurements.length, 1);
});

test("keyboard/accessibility activation measures without requiring press-in", () => {
  const { press, measurements, opened, open } = gesture();
  press.activate("keyboard", open);
  assert.equal(measurements[0].event, "keyboard");
  measurements[0].done(rect);
  assert.deepEqual(opened, [rect]);
});

test("a cancelled drag cannot supply an old anchor to the next activation", async () => {
  const { press, measurements, opened, open } = gesture();
  press.prepare("drag");
  press.release();
  await Promise.resolve();
  measurements[0].done(rect);
  press.activate("keyboard", open);
  assert.equal(measurements.length, 2);
  const moved = { ...rect, y: 200 };
  measurements[1].done(moved);
  assert.deepEqual(opened, [moved]);
});

test("long-press/unmount cancellation invalidates even an activated async request", () => {
  const { press, measurements, opened, open } = gesture();
  press.prepare("down");
  press.activate("up", open);
  press.cancel();
  measurements[0].done(rect);
  assert.deepEqual(opened, []);
});

test("a superseded measurement cannot open or reposition a newer gesture", async () => {
  const { press, measurements, opened, open } = gesture();
  press.prepare("old");
  press.release();
  press.prepare("new");
  await Promise.resolve();
  press.activate("up", open);
  measurements[0].done(rect);
  assert.deepEqual(opened, []);
  const moved = { ...rect, x: 300 };
  measurements[1].done(moved);
  assert.deepEqual(opened, [moved]);
});

test("synchronous web measurement and action-only activation retain event semantics", () => {
  const events = [], opened = [];
  const press = createMenuAnchorPress((done, event) => { events.push(event); done(rect); });
  press.prepare("pointerdown");
  press.release();
  press.activate("click", anchor => opened.push(anchor));
  press.activate("accessibility", anchor => opened.push(anchor));
  assert.deepEqual(events, ["pointerdown", "accessibility"]);
  assert.deepEqual(opened, [rect, rect]);
});

/** Exercise the actual shaped Pressable's handlers with native Pressability's
 * delayed press-out ordering. Only hooks/platform paint are substituted. */
test("native activation releases the pressed shape before running overlay work", () => {
  let cursor = 0;
  const cells = [], group = [], frames = new Map();
  const react = {
    createElement: (type, props, ...children) => ({ type, props: { ...props,
      children: children.length === 0 ? props?.children : children.length === 1 ? children[0] : children } }),
    useState(initial) {
      const index = cursor++;
      if (!(index in cells)) cells[index] = typeof initial === "function" ? initial() : initial;
      return [cells[index], next => { cells[index] = typeof next === "function" ? next(cells[index]) : next; }];
    },
    useRef(initial) {
      const index = cursor++;
      return cells[index] ??= { current: initial };
    },
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
      useAnimatedStyle: fn => fn(), withSpring: value => value,
    },
    "react-native-gesture-handler": { Pressable: "GesturePressable" },
    "../../theme/ThemeProvider": { useTheme: () => ({ palette: { onSurface: "#ffffff" } }) },
    "../../theme/material-motion": { useMaterialMotion: () => motion, materialMotion: motion },
    "./ButtonGroup": { useButtonGroupInteraction: () => down => group.push(down) },
    "./StateLayer": {},
    "../../theme/state-layer": loadSource("../src/theme/state-layer.ts"),
    "./pressable-web": {}, "../../lib/pointer-hover": { nativeHoverEvents: () => ({}) },
  });
  const render = () => {
    cursor = 0;
    let node = PressableScale({ shape: { rest: 20, pressed: 8 }, children: ({ pressed }) => pressed,
      onPress: () => {
        assert.equal(render().props.children.props.children[0], false, "overlay work must see a released trigger");
        assert.equal(group.at(-1), false);
      } });
    while (typeof node.type === "function") node = node.type(node.props);
    return node;
  };
  const oldRequest = globalThis.requestAnimationFrame, oldCancel = globalThis.cancelAnimationFrame;
  globalThis.requestAnimationFrame = callback => { const id = frames.size + 1; frames.set(id, callback); return id; };
  globalThis.cancelAnimationFrame = id => frames.delete(id);
  try {
    render().props.onPressIn({});
    assert.equal(render().props.children.props.children[0], true);
    render().props.onPress({}); // Native's onPressOut has not fired yet.
    assert.equal(render().props.children.props.children[0], false);
    render().props.onPressOut({});
    for (const callback of frames.values()) callback();
    frames.clear();
    assert.equal(render().props.children.props.children[0], false);

    render().props.onPressIn({});
    render().props.onPressOut({}); // Ordinary press-out-before-press ordering.
    render().props.onPress({});
    assert.equal(frames.size, 0, "activation cancels a queued release frame");
  } finally {
    globalThis.requestAnimationFrame = oldRequest;
    globalThis.cancelAnimationFrame = oldCancel;
  }
});
