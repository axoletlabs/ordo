import { Platform, Share } from "react-native";
import * as FileSystem from "expo-file-system";
import { APP_NAME } from "@ordo/shared";

const FILENAME = "ordo-backup-codes.txt";

export function formatBackupCodesFile(codes: string[]): string {
  return [
    `${APP_NAME} backup codes`,
    "Each code signs you in once. Keep this file somewhere safe.",
    "",
    ...codes,
    "",
  ].join("\n");
}

export async function downloadBackupCodes(codes: string[]): Promise<void> {
  const body = formatBackupCodesFile(codes);
  if (Platform.OS === "web") {
    downloadOnWeb(body);
    return;
  }
  const dir = FileSystem.cacheDirectory;
  if (!dir) {
    await Share.share({ message: body, title: `${APP_NAME} backup codes` });
    return;
  }
  const path = `${dir}${FILENAME}`;
  await FileSystem.writeAsStringAsync(path, body);
  try {
    if (Platform.OS === "android") {
      const contentUri = await FileSystem.getContentUriAsync(path);
      await Share.share({ title: `${APP_NAME} backup codes`, message: body, url: contentUri });
      return;
    }
    await Share.share({ title: `${APP_NAME} backup codes`, url: path });
  } catch {
    await Share.share({ title: `${APP_NAME} backup codes`, message: body });
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
