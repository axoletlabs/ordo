/**
 * Haptic helpers. Never throw (expo-haptics is missing on web), honour the
 * settings toggle, and collapse stacked calls in the same turn into one pulse.
 */
import { Platform } from "react-native";
import * as Haptics from "expo-haptics";
import { hapticPlayFor, mergeHaptic, shouldPlayHaptic, type HapticKind } from "./haptic-policy";

let enabled = true;
let pending: HapticKind | null = null;
let flushScheduled = false;
let lastKind: HapticKind | null = null;
let lastAt = 0;

export function setHapticsEnabled(on: boolean) {
  const was = enabled;
  enabled = on;
  if (on && !was) enqueue("selection");
}

function enqueue(kind: HapticKind) {
  if (Platform.OS === "web") return;
  if (!enabled && pending == null) return;
  pending = mergeHaptic(pending, kind);
  if (flushScheduled) return;
  flushScheduled = true;
  queueMicrotask(flush);
}

function flush() {
  flushScheduled = false;
  const kind = pending;
  pending = null;
  if (kind == null) return;
  const now = Date.now();
  if (!shouldPlayHaptic(kind, lastKind, now - lastAt)) return;
  lastKind = kind;
  lastAt = now;
  const play = hapticPlayFor(kind);
  try {
    const task =
      play.type === "selection"
        ? Haptics.selectionAsync()
        : Haptics.impactAsync(
            play.style === "soft" ? Haptics.ImpactFeedbackStyle.Soft : Haptics.ImpactFeedbackStyle.Light,
          );
    void Promise.resolve(task).catch(() => {});
  } catch {
    /* ignore */
  }
}

export const haptics = {
  light: () => enqueue("light"),
  medium: () => enqueue("medium"),
  soft: () => enqueue("soft"),
  selection: () => enqueue("selection"),
  success: () => enqueue("success"),
  warning: () => enqueue("warning"),
  error: () => enqueue("error"),
};
