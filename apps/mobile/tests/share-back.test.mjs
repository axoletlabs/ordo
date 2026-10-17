import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { test } from "node:test";
import { transformSync } from "@babel/core";
import React from "react";

const require = createRequire(import.meta.url);
const root = resolve(import.meta.dirname, "../src");
const compiled = new Map();

/** Run the real sheet, panel and Android Back hook; mock only native/UI services. */
function harness({ pending = false, expressive = false, reducedMotion = false, width = 390, height = 844 } = {}) {
  const instances = new Map(), listeners = [], cache = new Map();
  let keyboard = false;
  let slots, cursor, effects, dismissals = 0, keyboardDismissals = 0;
  const depsEqual = (a, b) => a && b && a.length === b.length && a.every((value, index) => Object.is(value, b[index]));
  const effect = (callback, deps) => {
    const index = cursor++, old = slots[index];
    if (old && depsEqual(old.deps, deps)) return;
    const currentSlots = slots;
    effects.push(() => {
      old?.cleanup?.();
      currentSlots[index] = { deps, cleanup: callback() };
    });
  };
  const hooks = {
    ...React,
    useId: () => "panel-title",
    useRef: value => slots[cursor++] ??= { current: value },
    useState: initial => {
      const index = cursor++, currentSlots = slots;
      currentSlots[index] ??= { value: initial };
      return [currentSlots[index].value, value => {
        currentSlots[index].value = typeof value === "function" ? value(currentSlots[index].value) : value;
      }];
    },
    useCallback: callback => callback,
    useEffect: effect,
    useLayoutEffect: effect,
  };
  const dismissKeyboard = () => { keyboard = false; keyboardDismissals++; };
  const native = {
    Platform: { OS: "android" },
    StyleSheet: { create: value => value, absoluteFill: {} },
    View: "View", Pressable: "Pressable",
    useWindowDimensions: () => ({ width, height }),
    Keyboard: { metrics: () => null, addListener: () => ({ remove() {} }) },
    AppState: { addEventListener: () => ({ remove() {} }) },
    BackHandler: { addEventListener: (name, callback) => {
      assert.equal(name, "hardwareBackPress");
      listeners.push(callback);
      return { remove: () => listeners.splice(listeners.indexOf(callback), 1) };
    } },
  };
  const motion = { reducedMotion, spatial: {} };
  const pan = new Proxy({}, { get: () => () => pan });
  const services = {
    "react-native-gesture-handler": { Gesture: { Pan: () => pan }, GestureDetector: "GestureDetector" },
    "@ordo/shared": { isSupportedUrl: () => true },
    "expo-clipboard": {},
    "icon-glyph": { iconGlyphStyle: () => ({}) },
    "react-native-safe-area-context": { useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) },
    ThemeProvider: { useTheme: () => ({ palette: {}, expressive }) },
    "material-motion": { useMaterialMotion: () => motion },
    "use-keyboard-visible": { dismissKeyboard, keyboardIsOpen: () => keyboard },
    "use-overlay-focus": { useOverlayFocus: () => ({ current: null }) },
    "use-bookmarks": { useCreateBookmark: () => ({ isPending: pending }) },
    queries: { useFolders: () => ({ data: [] }) },
    "use-tags": { useTags: () => ({ data: [] }) },
    tokens: { spacing: new Proxy({}, { get: (_, key) => Number(key) }), radius: {}, layout: { overlayMaxWidth: 560, overlayPadding: 24 } },
    "panel-title": { PanelTitleContext: { Provider: "PanelTitleProvider" } },
    "input-surface": { InputSurfaceContext: { Provider: "InputSurfaceProvider" } },
    "panel-keyboard-layout": { panelKeyboardLift: () => 0 },
  };
  function load(file) {
    if (cache.has(file)) return cache.get(file);
    const filename = resolve(root, file);
    if (!compiled.has(file)) compiled.set(file, transformSync(readFileSync(filename, "utf8"), {
      filename, babelrc: false, configFile: false, presets: ["babel-preset-expo"],
    }).code);
    const module = { exports: {} };
    const localRequire = id => {
      if (id === "react") return hooks;
      if (id === "react-native") return native;
      if (id === "react-native-reanimated") return {
        default: { View: "AnimatedView" }, __esModule: true,
        useSharedValue: value => hooks.useRef({ value }).current,
        useAnimatedStyle: callback => callback(),
        cancelAnimation() {}, runOnJS: callback => callback,
        withTiming: target => target, withSpring: target => target,
        Easing: { quad: value => value, inOut: fn => fn, bezier: () => value => value },
      };
      if (id.endsWith("/FloatingPanel")) return load("components/ui/FloatingPanel.tsx");
      if (id.endsWith("/use-overlay-presence")) return load("hooks/use-overlay-presence.ts");
      const name = id.split("/").at(-1);
      if (services[id] || services[name]) return services[id] ?? services[name];
      if (id.startsWith(".")) return new Proxy({}, { get: (_, key) => key });
      return require(id);
    };
    new Function("require", "module", "exports", compiled.get(file))(localRequire, module, module.exports);
    cache.set(file, module.exports);
    return module.exports;
  }
  const { AddBookmarkSheet } = load("components/bookmarks/AddBookmarkSheet.tsx");
  function render(key, callback, runEffects = false) {
    slots = instances.get(key) ?? [];
    instances.set(key, slots);
    cursor = 0; effects = [];
    const result = callback();
    if (runEffects) effects.forEach(callback => callback());
    return result;
  }
  function sheet(props = {}) {
    return render("sheet", () => AddBookmarkSheet({
      visible: true, folderId: null, initialUrl: "https://example.com", shareIntake: true,
      onDismiss: () => { dismissals++; }, ...props,
    }));
  }
  function panel(tree) {
    const element = tree.props.children[0];
    const surface = render("panel", () => element.type(element.props));
    return render("surface", () => surface.type(surface.props), true);
  }
  return {
    sheet, panel,
    openKeyboard: () => { keyboard = true; },
    back: () => [...listeners].reverse().some(callback => callback()),
    get dismissals() { return dismissals; },
    get keyboardDismissals() { return keyboardDismissals; },
  };
}

function find(tree, predicate) {
  if (!React.isValidElement(tree)) return undefined;
  if (predicate(tree)) return tree;
  for (const child of React.Children.toArray(tree.props.children)) {
    const match = find(child, predicate);
    if (match) return match;
  }
}

test("Android Back cancels share intake through the same callback as Cancel", () => {
  const h = harness();
  const sheet = h.sheet();
  h.panel(sheet);
  assert.equal(h.back(), true);
  assert.equal(h.dismissals, 1);
  find(sheet, node => node.type === "PanelActions").props.onCancel();
  assert.equal(h.dismissals, 2);
});

test("share intake still ignores outside taps, while regular add-bookmark allows them", () => {
  for (const shareIntake of [true, false]) {
    const h = harness();
    const panel = h.panel(h.sheet({ shareIntake }));
    const scrim = find(panel, node => node.props.accessibilityLabel === "Dismiss");
    assert.equal(typeof scrim.props.onPress, shareIntake ? "undefined" : "function");
    assert.equal(typeof scrim.props.onPressIn, shareIntake ? "undefined" : "function");
    scrim.props.onPress?.();
    assert.equal(h.dismissals, shareIntake ? 0 : 1);
  }
});

test("Back is consumed without cancelling while a save is pending", () => {
  const h = harness({ pending: true });
  const panel = h.panel(h.sheet());
  assert.equal(h.back(), true);
  assert.equal(h.dismissals, 0);
  assert.equal(find(panel, node => node.props.accessibilityLabel === "Dismiss").props.onPress, undefined);
});

test("Back dismisses the editing keyboard first, then cancels the share", () => {
  const h = harness();
  h.panel(h.sheet());
  h.openKeyboard();
  const before = h.keyboardDismissals;
  assert.equal(h.back(), true);
  assert.equal(h.keyboardDismissals, before + 1);
  assert.equal(h.dismissals, 0);
  assert.equal(h.back(), true);
  assert.equal(h.dismissals, 1);
});

test("parent share panel does not intercept Back while a picker owns the surface", () => {
  for (const label of ["Folder", "Tags"]) {
    const h = harness();
    const sheet = h.sheet({ allowFolderSelection: true });
    h.panel(sheet);
    find(sheet, node => node.type === "PickerField" && node.props.label === label).props.onPress({});
    const withPicker = h.sheet({ allowFolderSelection: true });
    h.panel(withPicker);
    assert.equal(h.back(), false);
    assert.equal(h.dismissals, 0);
    const picker = find(withPicker, node => node.type === (label === "Folder" ? "FolderPickerMenu" : "ContextMenu"));
    picker.props.onDismiss();
    h.panel(h.sheet({ allowFolderSelection: true }));
    assert.equal(h.back(), true);
    assert.equal(h.dismissals, 1);
  }
});

test("closed share panel releases its Back listener", () => {
  const h = harness({ reducedMotion: true });
  h.panel(h.sheet());
  h.panel(h.sheet({ visible: false }));
  assert.equal(h.back(), false);
  assert.equal(h.dismissals, 0);
});

test("Back cancellation is independent of layout, design mode and reduced motion", () => {
  for (const [width, height] of [[390, 844], [1280, 800]]) {
    for (const expressive of [false, true]) for (const reducedMotion of [false, true]) {
      const h = harness({ width, height, expressive, reducedMotion });
      h.panel(h.sheet());
      assert.equal(h.back(), true);
      assert.equal(h.dismissals, 1);
    }
  }
});
