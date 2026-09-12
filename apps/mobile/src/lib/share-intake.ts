/**
 * Decide whether an incoming share opens the save sheet or saves unfiled.
 *
 * File names are shared with the Android share-target activities
 * (`ShareIntake.kt` in the Android build plugin). "Show alongside Save"
 * publishes a sharing shortcut because Android 11+ stacks same-app SEND
 * activities into one share-sheet tile.
 */
export const QUICK_SHARE_ENABLED_FILE = "ordo-quick-share-enabled";
export const QUICK_SHARE_FLAG_FILE = "ordo-quick-share";

export type ShareIntakeMode = "sheet" | "quick";

export function shareIntakeMode(opts: {
  quickBookmark: boolean;
  showAlongside: boolean;
  fromQuickTarget: boolean;
}): ShareIntakeMode {
  if (opts.fromQuickTarget) return "quick";
  if (opts.quickBookmark && !opts.showAlongside) return "quick";
  return "sheet";
}
