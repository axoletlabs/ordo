/**
 * Sidecar files that the Android share activities read/write.
 * Enabling the Quick Bookmark target publishes a sharing shortcut so it can
 * appear next to ordo — Android 11+ stacks same-app SEND activities into one tile.
 *
 * The session snapshot is app-private (filesDir / cacheDir) so the translucent
 * Quick Save activity can POST without launching React. Deleted on logout.
 */
import { Platform } from "react-native";
import * as FileSystem from "expo-file-system";
import {
  QUICK_SHARE_BOOKMARK_FILE,
  QUICK_SHARE_ENABLED_FILE,
  QUICK_SHARE_FLAG_FILE,
  QUICK_SHARE_SESSION_FILE,
  parseQuickShareSession,
  type QuickShareSession,
} from "./share-intake";

function androidFile(directory: string | null, name: string): string | null {
  if (Platform.OS !== "android" || !directory) return null;
  return `${directory}${name}`;
}

function sidecarPaths(name: string): string[] {
  return [
    androidFile(FileSystem.documentDirectory, name),
    androidFile(FileSystem.cacheDirectory, name),
  ].filter((path): path is string => !!path);
}

async function syncSidecarFile(name: string, contents: string | null): Promise<void> {
  await Promise.all(
    sidecarPaths(name).map(async (path) => {
      try {
        if (contents == null) await FileSystem.deleteAsync(path, { idempotent: true });
        else await FileSystem.writeAsStringAsync(path, contents);
      } catch {
        /* ignore — best effort */
      }
    }),
  );
}

export async function syncQuickShareFlags(opts: {
  quickBookmark: boolean;
  showAlongside: boolean;
}): Promise<void> {
  await Promise.all([
    syncSidecarFile(QUICK_SHARE_ENABLED_FILE, opts.showAlongside ? "1" : null),
    syncSidecarFile(QUICK_SHARE_BOOKMARK_FILE, opts.quickBookmark ? "1" : null),
  ]);
}

export async function syncQuickShareSession(session: QuickShareSession | null): Promise<void> {
  await syncSidecarFile(QUICK_SHARE_SESSION_FILE, session ? JSON.stringify(session) : null);
}

export async function readQuickShareSession(): Promise<QuickShareSession | null> {
  for (const path of sidecarPaths(QUICK_SHARE_SESSION_FILE)) {
    try {
      const info = await FileSystem.getInfoAsync(path);
      if (!info.exists) continue;
      const raw = await FileSystem.readAsStringAsync(path);
      const parsed = parseQuickShareSession(raw);
      if (parsed) return parsed;
    } catch {
      /* try the other path */
    }
  }
  return null;
}

export async function patchQuickShareSessionServerUrl(serverUrl: string): Promise<void> {
  const current = await readQuickShareSession();
  if (!current) return;
  await syncQuickShareSession({
    ...current,
    serverUrl: serverUrl.replace(/\/+$/, ""),
  });
}

export async function consumeQuickShareFlag(): Promise<boolean> {
  const path = androidFile(FileSystem.cacheDirectory, QUICK_SHARE_FLAG_FILE);
  if (!path) return false;
  try {
    const info = await FileSystem.getInfoAsync(path);
    if (!info.exists) return false;
    await FileSystem.deleteAsync(path, { idempotent: true });
    return true;
  } catch {
    return false;
  }
}
