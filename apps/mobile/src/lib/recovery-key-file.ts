import { Platform, Share } from "react-native";
import * as FileSystem from "expo-file-system/legacy";
import { APP_NAME } from "@ordo/shared";

const FILENAME = "ordo-recovery-key.txt";

export function formatRecoveryKeyFile(key: string): string {
  return [
    `${APP_NAME} library recovery key`,
    "You need this key if you forget your password. Keep this file somewhere safe.",
    "",
    key,
    "",
  ].join("\n");
}

export async function downloadRecoveryKey(key: string): Promise<void> {
  const body = formatRecoveryKeyFile(key);
  if (Platform.OS === "web") {
    downloadOnWeb(body);
    return;
  }
  const dir = FileSystem.cacheDirectory;
  if (!dir) {
    await Share.share({ message: body, title: `${APP_NAME} recovery key` });
    return;
  }
  const path = `${dir}${FILENAME}`;
  await FileSystem.writeAsStringAsync(path, body);
  try {
    if (Platform.OS === "android") {
      const contentUri = await FileSystem.getContentUriAsync(path);
      await Share.share({ title: `${APP_NAME} recovery key`, message: body, url: contentUri });
      return;
    }
    await Share.share({ title: `${APP_NAME} recovery key`, url: path });
  } catch {
    await Share.share({ title: `${APP_NAME} recovery key`, message: body });
  }
}

function downloadOnWeb(body: string): void {
  const blob = new Blob([body], { type: "text/plain" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = FILENAME;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
