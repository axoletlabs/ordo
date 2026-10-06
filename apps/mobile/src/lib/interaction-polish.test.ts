import assert from "node:assert/strict";
import { test } from "node:test";
import { stateLayerCorners, stateLayerOpacity, alphaTint } from "../theme/state-layer.ts";
import { appBarLayout } from "../theme/app-bar-layout.ts";
import { selectionActionLayout } from "./selection-action-layout.ts";
import { commitSelection, createSelectionState, toggleSelection } from "./selection-state.ts";
import { rowOwnsHover } from "./row-hover.ts";
import { webSelectionKeys } from "../components/ui/pressable-web.ts";
import { nativeHoverEvents } from "./pointer-hover.ts";
import type { PointerEvent } from "react-native";

test("state layers preserve circular, grouped and field corner shapes", () => {
  assert.deepEqual(stateLayerCorners({ borderRadius: 24 }), {
    borderTopLeftRadius: 24, borderTopRightRadius: 24, borderBottomLeftRadius: 24, borderBottomRightRadius: 24,
  });
  assert.deepEqual(stateLayerCorners({ borderRadius: 4, borderBottomLeftRadius: 20, borderBottomRightRadius: 20 }), {
    borderTopLeftRadius: 4, borderTopRightRadius: 4, borderBottomLeftRadius: 20, borderBottomRightRadius: 20,
  });
  assert.equal(stateLayerCorners({ borderTopLeftRadius: 4 }).borderBottomLeftRadius, 0);
  assert.equal(stateLayerCorners({ borderRadius: 20, borderBottomLeftRadius: 0 }).borderBottomLeftRadius, 0);
});
test("state feedback alpha is baked into the color, never a resting opacity", () => {
  assert.equal(alphaTint("#dde4e1", 0.08), "#dde4e114");
  assert.equal(alphaTint("#dde4e1", 0.1), "#dde4e11a");
  assert.equal(alphaTint("#dde4e1", 0), "#dde4e100");
  assert.equal(alphaTint("#dde4e1", 1), "#dde4e1ff");
  assert.equal(alphaTint("#dde4e161", 0.08), "#dde4e114");
  assert.equal(alphaTint("transparent", 0.08), "transparent");
  assert.equal(alphaTint("rgb(1, 2, 3)", 0.08), "rgb(1, 2, 3)");
});
test("disabled controls never show a state layer and states do not stack", () => {
  assert.equal(stateLayerOpacity({ disabled: true, pressed: true, focused: true, hovered: true }), 0);
  assert.equal(stateLayerOpacity({ pressed: true, focused: true, hovered: true }), 0.1);
  assert.equal(stateLayerOpacity({ hovered: true }), 0.08);
  assert.equal(stateLayerOpacity({}), 0);
});
test("nested controls, not their parent row, own their hover feedback", () => {
  const row = {}, nested = {};
  assert.equal(rowOwnsHover({ target: { closest: () => nested }, currentTarget: row }), false);
  assert.equal(rowOwnsHover({ target: { closest: () => null }, currentTarget: row }), true);
  assert.equal(rowOwnsHover({ target: { closest: () => row }, currentTarget: row }), true);
});
test("native pointer hover ignores touches, forwards handlers and respects disabled controls", () => {
  const states: boolean[] = [];
  let enters = 0, leaves = 0, hovers = 0;
  const props = { onPointerEnter: () => { enters++; }, onPointerLeave: () => { leaves++; }, onHoverIn: () => { hovers++; } };
  const events = nativeHoverEvents(props, hovered => states.push(hovered));
  const pointer = (pointerType: string) => ({ nativeEvent: { pointerType } }) as PointerEvent;
  events.onPointerEnter(pointer("touch")); events.onPointerLeave(pointer("touch"));
  assert.deepEqual(states, []);
  for (const type of ["mouse", "pen"]) { events.onPointerEnter(pointer(type)); events.onPointerLeave(pointer(type)); }
  assert.deepEqual(states, [true, false, true, false]);
  assert.equal(hovers, 2); assert.equal(enters, 3); assert.equal(leaves, 3);
  nativeHoverEvents({ ...props, disabled: true }, hovered => states.push(hovered)).onPointerEnter(pointer("mouse"));
  assert.equal(hovers, 2); assert.equal(states.length, 4);
});
test("normal and search app bars share a 64dp footprint with exactly one safe inset", () => {
  for (const tonal of [false, true]) for (const topInset of [0, 24, 48]) {
    const layout = appBarLayout({ topInset, tonal });
    assert.equal(layout.paddingTop + layout.minHeight + layout.paddingBottom, 64 + topInset);
    const embedded = appBarLayout({ topInset, tonal, safeTop: false });
    assert.equal(embedded.paddingTop + embedded.minHeight + embedded.paddingBottom, 64);
  }
  const compact = appBarLayout({ topInset: 24, compact: true, tonal: true });
  assert.equal(compact.paddingTop + compact.minHeight + compact.paddingBottom, 80);
});
test("delete retains its right anchor for every selection type and pressed action", () => {
  for (const width of [272, 342, 752]) for (const keys of [["delete"], ["pin", "delete"], ["read", "move", "tags", "copy", "delete"]]) {
    for (const pressed of [null, ...keys]) {
      const positions = selectionActionLayout(keys, width, pressed, true);
      assert.equal(positions.delete!.right, 0);
      const first = positions[keys[0]!]!;
      assert.ok(Math.abs(first.right + first.width - width) < 0.001);
      assert.ok(Object.values(positions).every(position => position.width > 0));
    }
  }
});
test("toolbar interpolation conserves the delete anchor throughout a resize", () => {
  const from = selectionActionLayout(["delete"], 342).delete!;
  const to = selectionActionLayout(["read", "move", "tags", "copy", "delete"], 342).delete!;
  for (const progress of [-0.02, 0, 0.1, 0.5, 0.9, 1, 1.02]) {
    assert.equal(from.right + (to.right - from.right) * progress, 0);
  }
});
test("rapid synchronous toggles do not lose newer choices or leak between screens", () => {
  const store = createSelectionState(), other = createSelectionState();
  toggleSelection(store, "bookmark:a"); toggleSelection(store, "bookmark:b"); toggleSelection(store, "bookmark:a");
  assert.deepEqual([...store.getState().ids], ["bookmark:b"]);
  assert.equal(store.getState().revision, 3);
  assert.equal(other.getState().ids.size, 0);
  commitSelection(store, new Set(), false);
  assert.equal(store.getState().active, false);
});
test("only the changed row's selected snapshot changes in a 1,000-row library", () => {
  const store = createSelectionState();
  commitSelection(store, new Set(), true);
  const before = Array.from({ length: 1000 }, (_, i) => store.getState().ids.has(`bookmark:${i}`));
  toggleSelection(store, "bookmark:512");
  const changed = before.filter((value, i) => value !== store.getState().ids.has(`bookmark:${i}`)).length;
  assert.equal(changed, 1);
});
test("Space activates selection roles once without scrolling or activating a nested child", () => {
  for (const role of ["checkbox", "radio", "switch"] as const) {
    let presses = 0, prevented = 0;
    const node = {};
    const event = { key: " ", target: node, currentTarget: node, preventDefault: () => { prevented++; } };
    const handler = webSelectionKeys({ accessibilityRole: role, onPress: () => { presses++; } });
    handler.onKeyDown(event);
    handler.onKeyDown({ ...event, repeat: true });
    handler.onKeyDown({ ...event, target: {} });
    assert.equal(presses, 1); assert.equal(prevented, 2);
    webSelectionKeys({ accessibilityRole: role, disabled: true, onPress: () => { presses++; } }).onKeyDown(event);
    assert.equal(presses, 1);
  }
});
