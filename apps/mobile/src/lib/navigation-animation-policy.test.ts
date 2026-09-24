import assert from "node:assert/strict";
import { test } from "node:test";
import {
  isTabNavigatorFocused,
  resolveAppliedNavigationAnimation,
  resolveStackNavigationAnimation,
  shouldDetachInactiveTabScenes,
} from "./navigation-animation-policy.ts";

test("stack details are not the tab navigator", () => {
  assert.equal(isTabNavigatorFocused(["(app)", "settings", "appearance"]), false);
  assert.equal(isTabNavigatorFocused(["(app)", "folder", "id"]), false);
  assert.equal(isTabNavigatorFocused(["(app)", "(tabs)", "settings"]), true);
  assert.equal(isTabNavigatorFocused(["(app)", "(tabs)"]), true);
});

test("the stack trip back uses the animation you just picked", () => {
  assert.equal(resolveStackNavigationAnimation("fade"), "fade");
  assert.equal(resolveStackNavigationAnimation("instant"), "instant");
  assert.equal(resolveStackNavigationAnimation("slide"), "slide");
});

test("tab scenes wait to switch until the tabs are focused again", () => {
  assert.equal(resolveAppliedNavigationAnimation("fade", false, "slide"), "slide");
  assert.equal(resolveAppliedNavigationAnimation("instant", false, "slide"), "slide");
  assert.equal(resolveAppliedNavigationAnimation("fade", true, "slide"), "fade");
  assert.equal(resolveAppliedNavigationAnimation("instant", true, "slide"), "instant");
});

test("inactive tab scenes detach for instant and while flushing a type change", () => {
  assert.equal(shouldDetachInactiveTabScenes("slide", false), false);
  assert.equal(shouldDetachInactiveTabScenes("fade", false), false);
  assert.equal(shouldDetachInactiveTabScenes("fade", true), true);
  assert.equal(shouldDetachInactiveTabScenes("instant", false), true);
});
