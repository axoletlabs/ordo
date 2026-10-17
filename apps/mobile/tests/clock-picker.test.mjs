import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { test } from "node:test";
import { transformSync } from "@babel/core";
import React from "react";

const require = createRequire(import.meta.url);
const root = resolve(import.meta.dirname, "../src");

/** Execute the real clock handlers; native gesture/announcement rendering still
 * requires a device. The browser matrix independently tests actual pointer input. */
function harness(os, initial = {}) {
  const slots = [], cache = new Map(), changes = [];
  let cursor = 0, props = { hour: 13, minute: 17, hour12: true, disabled: false, ...initial };
  const hooks = { ...React,
    useRef: initial => slots[cursor++] ??= { current: initial },
    useState: initial => { const index = cursor++; slots[index] ??= { value: initial };
      return [slots[index].value, value => { slots[index].value = typeof value === "function" ? value(slots[index].value) : value; }]; },
    useMemo: (callback, deps) => { const index = cursor++, old = slots[index];
      if (!old || !deps.every((value, i) => Object.is(value, old.deps[i]))) slots[index] = { value: callback(), deps };
      return slots[index].value; },
  };
  const load = filename => {
    if (cache.has(filename)) return cache.get(filename).exports;
    const module = { exports: {} }; cache.set(filename, module);
    const code = transformSync(readFileSync(filename, "utf8"), { filename, babelrc: false, configFile: false, presets: ["babel-preset-expo"] }).code;
    const localRequire = id => {
      if (id === "react") return hooks;
      if (id === "react-native") return { Platform: { OS: os }, View: "View", StyleSheet: { create: value => value }, PanResponder: { create: panHandlers => ({ panHandlers }) } };
      if (id === "react-native-svg") return { __esModule: true, default: "Svg", Circle: "Circle", Line: "Line", Text: "SvgText" };
      if (id.endsWith("/ThemeProvider")) return { useTheme: () => ({ palette: {} }) };
      if (id.endsWith("/tokens")) return { radius: { sm: 8 }, spacing: { 8: 8, 16: 16 }, resolveFont: () => "Roboto" };
      if (id.endsWith("/haptics")) return { haptics: { selection() {} } };
      if (["./PressableScale", "./Segmented", "./Text"].includes(id)) return { [id.slice(2)]: id.slice(2) };
      if (id.startsWith(".")) {
        const base = resolve(dirname(filename), id);
        for (const extension of [".ts", ".tsx"]) { try { readFileSync(base + extension); } catch { continue; } return load(base + extension); }
      }
      return require(id);
    };
    new Function("require", "module", "exports", code)(localRequire, module, module.exports);
    return module.exports;
  };
  const { ClockTimePicker } = load(resolve(root, "components/ui/ClockTimePicker.tsx"));
  const { clockPoint } = load(resolve(root, "lib/clock-dial.ts"));
  let tree;
  const find = (node, predicate) => {
    if (!React.isValidElement(node)) return null;
    if (predicate(node.props)) return node;
    for (const child of React.Children.toArray(node.props.children)) { const found = find(child, predicate); if (found) return found; }
    return null;
  };
  const render = (next = {}) => { props = { ...props, ...next }; cursor = 0;
    tree = ClockTimePicker({ ...props, onChange: (hour, minute) => { changes.push({ hour, minute }); props = { ...props, hour, minute }; } });
    return find(tree, p => p.testID === "reminder-clock").props; };
  render();
  return { render, changes,
    select(field) { find(tree, p => p.accessibilityLabel === `Select ${field}`).props.onPress(); return render(); },
    event(hour, inner = false) { const point = clockPoint(hour % 12, 12, inner);
      return { nativeEvent: { locationX: point.x, locationY: point.y, pageX: point.x + 50, pageY: point.y + 70 } }; },
  };
}

for (const os of ["android", "ios", "web"]) {
  test(`${os}: adjustable hour/minute actions preserve period and exact minutes, and lock while busy`, () => {
    const h = harness(os);
    h.render().onAccessibilityAction({ nativeEvent: { actionName: "increment" } });
    assert.deepEqual(h.changes.at(-1), { hour: 14, minute: 17 });
    assert.equal(h.render().accessibilityValue.text, "2 PM");
    h.select("minute").onAccessibilityAction({ nativeEvent: { actionName: "decrement" } });
    assert.deepEqual(h.changes.at(-1), { hour: 14, minute: 16 });
    const count = h.changes.length;
    h.render({ disabled: true }).onAccessibilityAction({ nativeEvent: { actionName: "increment" } });
    assert.equal(h.changes.length, count);
  });

  test(`${os}: 24h drag uses stable page coordinates and advances only on release`, () => {
    const h = harness(os, { hour12: false });
    const original = h.render().onPanResponderGrant;
    h.render().onPanResponderGrant(h.event(0, true));
    assert.deepEqual(h.changes.at(-1), { hour: 0, minute: 17 });
    const during = h.render();
    assert.equal(during.onPanResponderGrant, original);
    during.onPanResponderMove({ nativeEvent: { ...h.event(23, true).nativeEvent, locationX: -900, locationY: -900 } });
    assert.deepEqual(h.changes.at(-1), { hour: 23, minute: 17 });
    assert.equal(h.render().accessibilityLabel, "Reminder hour");
    h.render().onPanResponderRelease();
    assert.equal(h.render().accessibilityLabel, "Reminder minute");
  });

  test(`${os}: cancellation or a mid-gesture busy transition cannot advance or change the dial`, () => {
    const h = harness(os);
    h.render().onPanResponderGrant(h.event(9));
    h.render().onPanResponderTerminate();
    assert.equal(h.render().accessibilityLabel, "Reminder hour");
    h.render().onPanResponderGrant(h.event(10));
    const count = h.changes.length;
    const busy = h.render({ disabled: true });
    busy.onPanResponderMove(h.event(11)); busy.onPanResponderRelease();
    assert.equal(h.changes.length, count);
    assert.equal(h.render().accessibilityLabel, "Reminder hour");
  });

  test(`${os}: minute drag refines a five-minute tap to an exact minute`, () => {
    const h = harness(os);
    h.select("minute").onPanResponderGrant(h.event(6));
    assert.equal(h.changes.at(-1).minute, 30);
    h.render().onPanResponderMove(h.event(6.2));
    assert.equal(h.changes.at(-1).minute, 31);
    h.render().onPanResponderRelease();
    assert.equal(h.render().accessibilityLabel, "Reminder minute");
    assert.equal(h.render().accessibilityValue.text, "31 minutes");
  });
}
