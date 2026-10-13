import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";
import { transformSync } from "@babel/core";
import React from "react";

const require = createRequire(import.meta.url);

// Render the actual wrapper with a simulated bridge. All platforms must keep
// the shared Material HUD; native gestures must not rely on cancelled JS touches.
const filename = new URL("../src/components/ui/ThemedScrollView.tsx", import.meta.url).pathname;
const code = transformSync(readFileSync(filename, "utf8"), {
  filename, babelrc: false, configFile: false, presets: ["babel-preset-expo"],
}).code;

function render(platform, props = {}) {
  let refreshArgs;
  const gesture = { type: "simultaneous-native-refresh" };
  let jsReleases = 0;
  const module = { exports: {} };
  const mocks = {
    react: { ...React, useMemo: fn => fn() },
    "react-native": {
      FlatList: "FlatList", ScrollView: "ScrollView", View: "View",
      Platform: { OS: platform }, StyleSheet: { create: styles => styles },
    },
    "react-native-reanimated": { default: { FlatList: "AnimatedFlatList" },
      LinearTransition: { springify: () => ({ mass() { return this; }, stiffness() { return this; }, damping() { return this; } }) } },
    "react-native-gesture-handler": { GestureDetector: "GestureDetector" },
    "../../theme/material-motion": { useMaterialMotion: () => ({ fast: {}, reducedMotion: false }) },
    "../../theme/scrollbar": { scrollViewShouldFill: () => true },
    "../../lib/list-pagination": { LIST_END_REACHED_THRESHOLD: 0.25 },
    "./RefreshHud": { RefreshHud: "RefreshHud" },
    "./ScrollBar": {
      useScrollBarInsets: () => ({}), splitScrollLayoutStyle: () => ({}),
      useVerticalScrollBar: () => ({}),
      chainHandlers: (...handlers) => event => handlers.forEach(handler => handler?.(event)),
    },
    "../../hooks/use-material-refresh": { useMaterialRefresh: (...args) => {
      refreshArgs = args;
      return { dy: 0, gesture: platform === "web" ? undefined : gesture,
        onTouchEnd: () => jsReleases++, onScrollEndDrag: () => jsReleases++ };
    } },
  };
  new Function("require", "module", "exports", code)(id => {
    if (id.startsWith("@babel/runtime/") || id === "react/jsx-runtime") return require(id);
    assert.ok(id in mocks, `Unexpected module: ${id}`);
    return mocks[id];
  }, module, module.exports);
  const tree = module.exports.ThemedFlatList.render({ data: [], ...props }, null);
  const children = React.Children.toArray(tree.props.children);
  const frame = children[0].type === "GestureDetector" ? children[0] : undefined;
  return { list: frame ? frame.props.children : children[0], frame,
    hud: children.find(child => child.type === "RefreshHud"), refreshArgs, gesture, jsReleases: () => jsReleases };
}

for (const platform of ["android", "ios"]) {
  test(`${platform}: Material HUD uses the native gesture observer, not an OS spinner`, () => {
    const { list, frame, hud, refreshArgs, gesture, jsReleases } = render(platform, { refreshing: true, onRefresh() {} });
    assert.equal(list.props.refreshControl, undefined, "no platform spinner or intercepting SwipeRefreshLayout");
    assert.equal(frame.props.gesture, gesture);
    assert.equal(hud.props.refreshing, true, "shared Material spinner in both design modes");
    assert.equal(refreshArgs[2], true);
    list.props.onTouchEnd({}); list.props.onScrollEndDrag({});
    assert.equal(jsReleases(), 0, "native scroll/touch handoff cannot commit twice");
  });

  test(`${platform}: selection dragging disables native refresh along with scrolling`, () => {
    const { refreshArgs } = render(platform, { onRefresh() {}, scrollEnabled: false });
    assert.equal(refreshArgs[2], false);
  });
}

test("web: retain the shared Material pull indicator and release handler", () => {
  const onRefresh = () => {};
  const { list, hud, refreshArgs } = render("web", { refreshing: true, onRefresh });
  assert.equal(list.props.refreshControl, undefined);
  assert.equal(hud.props.refreshing, true);
  assert.deepEqual(refreshArgs, [true, onRefresh, true]);
});

test("explicit refresh controls are preserved without a competing HUD", () => {
  const control = React.createElement("CustomRefreshControl");
  for (const platform of ["android", "ios", "web"]) {
    const { list, frame, hud, refreshArgs } = render(platform, { onRefresh() {}, refreshControl: control });
    assert.equal(list.props.refreshControl, control);
    assert.equal(hud, undefined);
    assert.equal(frame, undefined);
    assert.equal(refreshArgs[2], false);
  }
});
