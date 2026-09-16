/**
 * Decide whether an incoming share opens the save sheet or saves unfiled.
 *
 * File names are shared with the Android share-target activities
 * (`ShareIntake.kt` / `QuickShareSave.kt` in the Android build plugin).
 * "Show alongside Save" publishes a sharing shortcut because Android 11+
 * stacks same-app SEND activities into one share-sheet tile.
 *
 * Quick Save reads the EncryptedSharedPreferences session sidecar from the
 * translucent receiver so it can POST without launching React. Native refresh
 * writes that copy back; JS adopts it on hydrate / foreground so rotating
 * tokens stay in sync.
 */
export const QUICK_SHARE_ENABLED_FILE = "ordo-quick-share-enabled";
export const QUICK_SHARE_FLAG_FILE = "ordo-quick-share";
export const QUICK_SHARE_BOOKMARK_FILE = "ordo-quick-share-bookmark";
export const QUICK_SHARE_SESSION_FILE = "ordo-quick-share-session";
export const QUICK_SHARE_SESSION_PREFS = "ordo_quick_share_session";

export type ShareIntakeMode = "sheet" | "quick";

export interface QuickShareSession {
  serverUrl: string;
  accessToken: string;
  refreshToken: string;
  accessExpiresAt: number | null;
  updatedAt: number;
}

export function shareIntakeMode(opts: {
  quickBookmark: boolean;
  showAlongside: boolean;
  fromQuickTarget: boolean;
}): ShareIntakeMode {
  if (opts.fromQuickTarget) return "quick";
  if (opts.quickBookmark && !opts.showAlongside) return "quick";
  return "sheet";
}

/** True when Quick Save is the only share target (native save, no sheet). */
export function shareIntakeIsQuickDefault(opts: {
  quickBookmark: boolean;
  showAlongside: boolean;
}): boolean {
  return opts.quickBookmark && !opts.showAlongside;
}

/** Drop an in-progress save sheet when the user leaves Ordo without Save/Cancel. */
export function shouldAbandonShareIntake(wasActive: boolean, nextState: string): boolean {
  return wasActive && nextState !== "active";
}

/** System toast after a share-target save; visible over the sender app. */
export function shareSavedToast(destination?: string | null): string {
  const name = destination?.trim();
  return name ? `Saved to ${name}` : "Saved to Bookmarks";
}

export function parseQuickShareSession(raw: unknown): QuickShareSession | null {
  let value = raw;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value) as unknown;
    } catch {
      return null;
    }
  }
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  if (typeof row.serverUrl !== "string" || !row.serverUrl.trim()) return null;
  if (typeof row.accessToken !== "string" || !row.accessToken) return null;
  if (typeof row.refreshToken !== "string" || !row.refreshToken) return null;
  const accessExpiresAt =
    typeof row.accessExpiresAt === "number" && Number.isFinite(row.accessExpiresAt)
      ? row.accessExpiresAt
      : null;
  const updatedAt =
    typeof row.updatedAt === "number" && Number.isFinite(row.updatedAt) ? row.updatedAt : 0;
  return {
    serverUrl: row.serverUrl.replace(/\/+$/, ""),
    accessToken: row.accessToken,
    refreshToken: row.refreshToken,
    accessExpiresAt,
    updatedAt,
  };
}

/** Adopt the sidecar when native Quick Save rotated tokens more recently. */
export function shouldAdoptQuickShareSession(
  currentUpdatedAt: number | null | undefined,
  sidecar: QuickShareSession | null,
): sidecar is QuickShareSession {
  if (!sidecar) return false;
  return sidecar.updatedAt > (currentUpdatedAt ?? 0);
}
