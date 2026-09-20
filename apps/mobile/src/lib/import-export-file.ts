/**
 * Save an export as a real file via the system picker — not as share-sheet text.
 *
 * Android opens Save As (native ContentResolver write, because Expo FileSystem
 * refuses Downloads content:// URIs). Older APKs fall back to the share sheet.
 * iOS writes a file then presents the share sheet so "Save to Files" can pick
 * a location. Web triggers a download.
 */
import { NativeModules, Platform, Share } from "react-native";
import * as FileSystem from "expo-file-system/legacy";
import { EXPORT_MIME, type ExportFormat } from "@ordo/shared";
import { isExportSaveCanceledCode } from "./import-export-uri";

export { contentUriFromActivityResult } from "./import-export-uri";

export const EXPORT_SAVE_CANCELED = "export_save_canceled";

export class ExportSaveCanceled extends Error {
  readonly code = EXPORT_SAVE_CANCELED;
  constructor() {
    super("Export canceled");
    this.name = "ExportSaveCanceled";
  }
}

export function isExportSaveCanceled(err: unknown): boolean {
  if (err instanceof ExportSaveCanceled) return true;
  if (typeof err !== "object" || err === null) return false;
  return isExportSaveCanceledCode((err as { code?: string }).code);
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

interface ExportFileNative {
  saveDocument(filename: string, mimeType: string, sourcePath: string): Promise<void>;
}

function exportFileNative(): ExportFileNative | null {
  if (Platform.OS !== "android") return null;
  const mod = NativeModules.OrdoExportFile as ExportFileNative | undefined;
  if (!mod || typeof mod.saveDocument !== "function") return null;
  return mod;
}

async function writeExportCache(body: string): Promise<string> {
  const dir = FileSystem.cacheDirectory;
  if (!dir) throw new Error("Couldn't write the export file.");
  const path = `${dir}ordo-export-${Date.now()}`;
  await FileSystem.writeAsStringAsync(path, body, { encoding: "utf8" });
  return path;
}

async function saveOnAndroid(body: string, filename: string, mimeType: string): Promise<void> {
  const path = await writeExportCache(body);
  const native = exportFileNative();
  if (native) {
    try {
      await native.saveDocument(filename, mimeType, path);
    } catch (err) {
      if (isExportSaveCanceled(err) || isShareCanceled(err)) throw new ExportSaveCanceled();
      throw err;
    } finally {
      await FileSystem.deleteAsync(path, { idempotent: true }).catch(() => undefined);
    }
    return;
  }
  try {
    await shareExportedFile(path, filename);
  } catch (err) {
    if (isExportSaveCanceled(err) || isShareCanceled(err)) throw new ExportSaveCanceled();
    throw err;
  }
}

/** APKs without OrdoExportFile still get the file out through the system share sheet. */
async function shareExportedFile(path: string, filename: string): Promise<void> {
  const contentUri = await FileSystem.getContentUriAsync(path);
  const result = await Share.share({ title: filename, url: contentUri });
  if (result.action === Share.dismissedAction) throw new ExportSaveCanceled();
}

/** iOS has no Save As API; "Save to Files" on the file share sheet is the picker. */
async function saveOnIos(body: string, filename: string): Promise<void> {
  const path = await writeExportCache(body);
  try {
    const result = await Share.share({ url: path, title: filename });
    if (result.action === Share.dismissedAction) throw new ExportSaveCanceled();
  } catch (err) {
    if (isExportSaveCanceled(err) || isShareCanceled(err)) throw new ExportSaveCanceled();
    throw err;
  }
}

function isShareCanceled(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return /did not share|cancel/i.test(message);
}
