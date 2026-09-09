/**
 * Haptic vocabulary and same-turn merging. Notification feedback is a
 * two-tick buzz on both iOS and Android, so every outcome maps to a single
 * quieter impact instead.
 */
export type HapticKind =
  | "selection"
  | "soft"
  | "light"
  | "medium"
  | "success"
  | "warning"
  | "error";

export type HapticPlay =
  | { type: "selection" }
  | { type: "impact"; style: "soft" | "light" };

/** Higher wins when two haptics fire in the same turn. */
export const HAPTIC_PRIORITY: Record<HapticKind, number> = {
  selection: 1,
  soft: 2,
  light: 3,
  success: 4,
  warning: 5,
  medium: 6,
  error: 7,
};

/** Drop follow-up impacts that would read as a second buzz on the same gesture. */
export const HAPTIC_REFRACTORY_MS = 80;

export function mergeHaptic(current: HapticKind | null, next: HapticKind): HapticKind {
  if (current == null) return next;
  return HAPTIC_PRIORITY[next] >= HAPTIC_PRIORITY[current] ? next : current;
}

export function shouldPlayHaptic(
  kind: HapticKind,
  lastKind: HapticKind | null,
  elapsedMs: number,
): boolean {
  if (lastKind == null) return true;
  if (kind === "selection") return true;
  return elapsedMs >= HAPTIC_REFRACTORY_MS;
}

export function hapticPlayFor(kind: HapticKind): HapticPlay {
  switch (kind) {
    case "selection":
      return { type: "selection" };
    case "soft":
    case "light":
      return { type: "impact", style: "soft" };
    case "success":
    case "warning":
    case "medium":
    case "error":
      return { type: "impact", style: "light" };
  }
}
