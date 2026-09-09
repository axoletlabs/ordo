/**
 * App foreground/background: pause network work while hidden, then refresh
 * the session before queries resume so a rotation race cannot log the user out.
 *
 * React Native has no window focus events; TanStack Query stays "focused"
 * unless we wire `focusManager` to AppState. Without that, refetchInterval
 * keeps polling in the background on Android and never refetches on resume.
 */
import { AppState, Platform } from "react-native";
import type { AppStateStatus } from "react-native";
import { focusManager } from "@tanstack/react-query";
import { cancelProactiveRefresh, ensureFreshAccessToken } from "./api/client";

let started = false;
let lastState: AppStateStatus = AppState.currentState;

function setNativeFocused(focused: boolean) {
  if (Platform.OS === "web") return;
  focusManager.setFocused(focused);
}

async function onBecameActive() {
  try {
    await ensureFreshAccessToken();
  } catch {
    /* ensureFresh already swallows refresh failures into a result union */
  }
  if (lastState === "active") setNativeFocused(true);
}

function onLeftActive() {
  setNativeFocused(false);
  cancelProactiveRefresh();
}

function onAppStateChange(state: AppStateStatus) {
  const wasActive = lastState === "active";
  lastState = state;
  if (state === "active") {
    void onBecameActive();
    return;
  }
  if (wasActive) onLeftActive();
}

export function initAppLifecycle() {
  if (started) return;
  started = true;
  lastState = AppState.currentState;
  if (lastState === "active") setNativeFocused(true);
  else onLeftActive();
  AppState.addEventListener("change", onAppStateChange);
}
