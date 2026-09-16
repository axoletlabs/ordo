/**
 * Sidecar files that the Android share activities read/write.
 * Enabling the Quick Bookmark target publishes a sharing shortcut so it can
 * appear next to ordo — Android 11+ stacks same-app SEND activities into one tile.
 *
 * Access/refresh tokens stay in SecureStore. Android Quick Save also keeps an
 * EncryptedSharedPreferences copy so the translucent activity can POST without
 * React. Older builds wrote that JSON to filesDir/cacheDir; those leftovers
 * are deleted after the encrypted write. Deleted on logout.
 */
import { NativeModules, Platform } from "react-native";
import * as FileSystem from "expo-file-system/legacy";
import {
  QUICK_SHARE_BOOKMARK_FILE,
  QUICK_SHARE_ENABLED_FILE,
  QUICK_SHARE_FLAG_FILE,
  QUICK_SHARE_SESSION_FILE,
  parseQuickShareSession,
  type QuickShareSession,
} from "./share-intake";

interface ShareSessionNative {
  get(): Promise<string | null>;
  set(json: string): Promise<void>;
  clear(): Promise<void>;
  moveTaskToBack?: () => Promise<void>;
}

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

function shareSessionNative(): ShareSessionNative | null {
  if (Platform.OS !== "android") return null;
  const mod = NativeModules.OrdoShareSession as ShareSessionNative | undefined;
  if (!mod || typeof mod.get !== "function" || typeof mod.set !== "function" || typeof mod.clear !== "function") {
    return null;
  }
  return mod;
}

export async function syncQuickShareFlags(opts: {
  quickBookmark: boolean;
  showAlongside: boolean;
}): Promise<void> {
  // Bookmark first so a FileObserver on the alongside file sees both flags.
  await syncSidecarFile(QUICK_SHARE_BOOKMARK_FILE, opts.quickBookmark ? "1" : null);
  await syncSidecarFile(QUICK_SHARE_ENABLED_FILE, opts.showAlongside ? "1" : null);
}

export async function syncQuickShareSession(session: QuickShareSession | null): Promise<void> {
  const native = shareSessionNative();
  if (native) {
    try {
      if (session) await native.set(JSON.stringify(session));
      else await native.clear();
    } catch {
      /* ignore — best effort */
    }
    await syncSidecarFile(QUICK_SHARE_SESSION_FILE, null);
    return;
  }
  await syncSidecarFile(QUICK_SHARE_SESSION_FILE, session ? JSON.stringify(session) : null);
}

export async function readQuickShareSession(): Promise<QuickShareSession | null> {
  const native = shareSessionNative();
  if (native) {
    try {
      const parsed = parseQuickShareSession(await native.get());
      if (parsed) return parsed;
    } catch {
      /* fall through to leftover files from an older APK */
    }
  }
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

/** Send Ordo behind the sender without synthesizing a back press the overlay can eat. */
export function moveAppToBackground(): boolean {
  const native = shareSessionNative();
  if (!native || typeof native.moveTaskToBack !== "function") return false;
  void native.moveTaskToBack();
  return true;
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
