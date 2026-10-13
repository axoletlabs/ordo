import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";
import { transformSync } from "@babel/core";
import React from "react";

const require = createRequire(import.meta.url);

// Render the actual wrapper with a simulated bridge. Android's SwipeRefreshLayout
// intercepts the pull and cancels JS touches, so native feedback must not depend
// on the touch-driven HUD (which is still used on web).
const filename = new URL("../src/components/ui/ThemedScrollView.tsx", import.meta.url).pathname;
const code = transformSync(readFileSync(filename, "utf8"), {
  filename, babelrc: false, configFile: false, presets: ["babel-preset-expo"],
}).code;

function render(platform, props = {}) {
  let refreshArgs;
  const palette = { primary: "primary-role", surfaceContainerHigh: "container-role" };
  const module = { exports: {} };
  const mocks = {
    react: { ...React, useMemo: fn => fn() },
    "react-native": {
      FlatList: "FlatList", ScrollView: "ScrollView", View: "View", RefreshControl: "RefreshControl",
      Platform: { OS: platform }, StyleSheet: { create: styles => styles },
    },
    "react-native-reanimated": { default: { FlatList: "AnimatedFlatList" },
      LinearTransition: { springify: () => ({ mass() { return this; }, stiffness() { return this; }, damping() { return this; } }) } },
    "../../theme/ThemeProvider": { useTheme: () => ({ palette }) },
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
      return { dy: 0 };
    } },
  };
  new Function("require", "module", "exports", code)(id => {
    if (id.startsWith("@babel/runtime/") || id === "react/jsx-runtime") return require(id);
    assert.ok(id in mocks, `Unexpected module: ${id}`);
    return mocks[id];
  }, module, module.exports);
  const tree = module.exports.ThemedFlatList.render({ data: [], ...props }, null);
  const children = React.Children.toArray(tree.props.children);
  return { list: children[0], hud: children.find(child => child.type === "RefreshHud"), refreshArgs, palette };
}

for (const platform of ["android", "ios"]) {
  test(`${platform}: native refresh stays visible when native scrolling cancels JS touches`, () => {
    let requests = 0;
    const onRefresh = () => requests++;
    const { list, hud, refreshArgs, palette } = render(platform, { refreshing: true, onRefresh });
    const control = list.props.refreshControl;
    assert.equal(control.type, "RefreshControl");
    assert.equal(control.props.refreshing, true);
    assert.equal(control.props.tintColor, palette.primary);
    assert.deepEqual(control.props.colors, [palette.primary]);
    assert.equal(control.props.progressBackgroundColor, palette.surfaceContainerHigh);
    assert.ok(control.props.progressViewOffset == null || control.props.progressViewOffset >= 0);
    assert.equal(hud, undefined, "one indicator, not a second touch-driven overlay");
    assert.equal(refreshArgs[2], false, "JS does not compete with native refresh");
    control.props.onRefresh();
    assert.equal(requests, 1);
  });

  test(`${platform}: selection dragging disables native refresh along with scrolling`, () => {
    const { list } = render(platform, { onRefresh() {}, scrollEnabled: false });
    assert.equal(list.props.refreshControl.props.enabled, false);
  });
}

test("web: retain the shared Material pull indicator and release handler", () => {
  const onRefresh = () => {};
  const { list, hud, refreshArgs } = render("web", { refreshing: true, onRefresh });
  assert.equal(list.props.refreshControl, undefined);
  assert.equal(hud.props.refreshing, true);
  assert.deepEqual(refreshArgs, [true, onRefresh, true, true]);
});

test("explicit refresh controls are preserved without a competing HUD", () => {
  const control = React.createElement("CustomRefreshControl");
  for (const platform of ["android", "ios", "web"]) {
    const { list, hud, refreshArgs } = render(platform, { onRefresh() {}, refreshControl: control });
    assert.equal(list.props.refreshControl, control);
    assert.equal(hud, undefined);
    assert.equal(refreshArgs[2], false);
  }
});
