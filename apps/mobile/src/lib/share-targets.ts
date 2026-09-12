/**
 * Sidecar files that the Android share activities read/write.
 * Enabling the Quick Bookmark target happens on MainActivity pause so the
 * share sheet is updated before the user leaves ordo.
 */
import { Platform } from "react-native";
import * as FileSystem from "expo-file-system";
import { QUICK_SHARE_ENABLED_FILE, QUICK_SHARE_FLAG_FILE } from "./share-intake";

function androidFile(directory: string | null, name: string): string | null {
  if (Platform.OS !== "android" || !directory) return null;
  return `${directory}${name}`;
}

export async function syncQuickShareTargetEnabled(enabled: boolean): Promise<void> {
  const path = androidFile(FileSystem.documentDirectory, QUICK_SHARE_ENABLED_FILE);
  if (!path) return;
  try {
    if (enabled) await FileSystem.writeAsStringAsync(path, "1");
    else await FileSystem.deleteAsync(path, { idempotent: true });
  } catch {
    /* ignore — best effort */
  }
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
