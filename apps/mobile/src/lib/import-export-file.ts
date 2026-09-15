/**
 * Save an export as a real file via the system picker — not as share-sheet text.
 *
 * Android opens the Save As / Files document UI. iOS writes a file then presents
 * the share sheet so "Save to Files" can pick a location. Web triggers a download.
 */
import { Platform, Share } from "react-native";
import * as FileSystem from "expo-file-system/legacy";
import * as IntentLauncher from "expo-intent-launcher";
import { EXPORT_MIME, type ExportFormat } from "@ordo/shared";

export const EXPORT_SAVE_CANCELED = "export_save_canceled";

export class ExportSaveCanceled extends Error {
  readonly code = EXPORT_SAVE_CANCELED;
  constructor() {
    super("Export canceled");
    this.name = "ExportSaveCanceled";
  }
}

export function isExportSaveCanceled(err: unknown): boolean {
  return (
    err instanceof ExportSaveCanceled ||
    (typeof err === "object" &&
      err !== null &&
      (err as { code?: string }).code === EXPORT_SAVE_CANCELED)
  );
}

export function mimeForExportFormat(format: ExportFormat): string {
  return EXPORT_MIME[format];
}

export async function downloadExportFile(
  body: string,
  filename: string,
  mimeType: string,
): Promise<void> {
  if (Platform.OS === "web") {
    saveOnWeb(body, filename, mimeType);
    return;
  }
  if (Platform.OS === "android") {
    await saveOnAndroid(body, filename, mimeType);
    return;
  }
  await saveOnIos(body, filename);
}

/** Parse the filename out of a content-disposition header (fallback provided). */
export function filenameFromDisposition(header: string | null, fallbackExt: string): string {
  const match = header?.match(/filename="?([^";]+)"?/i)?.[1];
  if (match) return match;
  const date = new Date().toISOString().slice(0, 10);
  return `ordo-export-${date}.${fallbackExt}`;
}

function saveOnWeb(body: string, filename: string, mimeType: string): void {
  const blob = new Blob([body], { type: `${mimeType};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

/**
 * Android Save As: ACTION_CREATE_DOCUMENT returns a writable content URI.
 * If that intent isn't available, fall back to picking a folder with SAF.
 *
 * Expo's IntentLauncher puts the result Intent's string form in `data`, so we
 * extract `dat=` (the content URI). Newer Expo versions may already return the URI.
 */
async function saveOnAndroid(body: string, filename: string, mimeType: string): Promise<void> {
  let launched = false;
  try {
    const result = await IntentLauncher.startActivityAsync("android.intent.action.CREATE_DOCUMENT", {
      type: mimeType,
      category: "android.intent.category.OPENABLE",
      extra: { "android.intent.extra.TITLE": filename },
    });
    launched = true;
    if (result.resultCode === IntentLauncher.ResultCode.Canceled) {
      throw new ExportSaveCanceled();
    }
    const uri = contentUriFromActivityResult(result.data);
    if (!uri) throw new Error("Couldn't open a save location.");
    await FileSystem.StorageAccessFramework.writeAsStringAsync(uri, body, { encoding: "utf8" });
    return;
  } catch (err) {
    if (isExportSaveCanceled(err)) throw err;
    if (launched) throw err;
  }

  await saveViaDirectoryPicker(body, filename, mimeType);
}

/** Pull a content/file URI out of IntentLauncher's activity result. */
export function contentUriFromActivityResult(data: string | undefined): string | undefined {
  if (!data) return undefined;
  const trimmed = data.trim();
  if (trimmed.startsWith("content://") || trimmed.startsWith("file://")) return trimmed;
  const match = trimmed.match(/\bdat=([^\s}]+)/);
  const uri = match?.[1];
  if (uri?.startsWith("content://") || uri?.startsWith("file://")) return uri;
  return undefined;
}

async function saveViaDirectoryPicker(
  body: string,
  filename: string,
  mimeType: string,
): Promise<void> {
  const permissions = await FileSystem.StorageAccessFramework.requestDirectoryPermissionsAsync();
  if (!permissions.granted) throw new ExportSaveCanceled();
  const created = await FileSystem.StorageAccessFramework.createFileAsync(
    permissions.directoryUri,
    basenameWithoutExt(filename),
    mimeType,
  );
  await FileSystem.StorageAccessFramework.writeAsStringAsync(created, body, {
    encoding: "utf8",
  });
}

/** iOS has no Save As API; "Save to Files" on the file share sheet is the picker. */
async function saveOnIos(body: string, filename: string): Promise<void> {
  const dir = FileSystem.cacheDirectory;
  if (!dir) throw new Error("Couldn't write the export file.");
  const path = `${dir}${filename}`;
  await FileSystem.writeAsStringAsync(path, body, { encoding: "utf8" });
  try {
    const result = await Share.share({ url: path, title: filename });
    if (result.action === Share.dismissedAction) throw new ExportSaveCanceled();
  } catch (err) {
    if (isExportSaveCanceled(err) || isShareCanceled(err)) throw new ExportSaveCanceled();
    throw err;
  }
}

function basenameWithoutExt(filename: string): string {
  return filename.replace(/\.[^.]+$/, "") || filename;
}

function isShareCanceled(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return /did not share|cancel/i.test(message);
}
