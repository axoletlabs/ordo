/** Private staging, explicit system handoff, generation checks at every await. */
import { NativeModules, Platform, Share } from "react-native";
import * as FileSystem from "expo-file-system/legacy";
import { getDiagnosticReportEpoch, registerDiagnosticCancellation } from "../local-diagnostics";
import { utf8Bytes } from "./schema";
import { isExportSaveCanceledCode } from "../import-export-uri";

const directory = `${FileSystem.cacheDirectory ?? ""}ordo-diagnostics-export/`;
let activePath: string | null = null;
let epoch = 0;
let busy = false;
let cleanupTimer: ReturnType<typeof setTimeout> | undefined;
const remove = (path: string) => FileSystem.deleteAsync(path, { idempotent: true }).catch(() => {});

export function cancelDiagnosticExport() {
  epoch++; clearTimeout(cleanupTimer); cleanupTimer = undefined;
  const path = activePath; activePath = null;
  if (path && Platform.OS !== "web") void remove(path);
}
registerDiagnosticCancellation(cancelDiagnosticExport);

/** Call at startup too: OS process death can skip JS cleanup. */
export async function cleanupDiagnosticExports() {
  if (Platform.OS === "web" || !FileSystem.cacheDirectory) return;
  try {
    const info = await FileSystem.getInfoAsync(directory);
    if (!info.exists) return;
    const files = await FileSystem.readDirectoryAsync(directory);
    for (const name of files) {
      const path = directory + name;
      if (path === activePath) continue;
      // A new process cannot continue the old share job. Remove all orphaned
      // staging files, including ones younger than the normal share TTL.
      await remove(path);
    }
  } catch { /* Cache cleanup must not interfere with startup. */ }
}

export async function downloadDiagnosticReport(text: string, id: string, generation: number): Promise<boolean> {
  if (busy || utf8Bytes(text) > 512 * 1024 || !/^[a-z0-9]{1,16}$/.test(id)) return false;
  busy = true;
  const token = epoch;
  const valid = () => token === epoch && getDiagnosticReportEpoch() === generation;
  try {
    if (!valid()) return false;
    const filename = `ordo-diagnostics-${id}.json`;
    if (Platform.OS === "web") {
      const url = URL.createObjectURL(new Blob([text], { type: "application/json;charset=utf-8" }));
      try { const anchor = document.createElement("a"); anchor.href = url; anchor.download = filename; anchor.click(); }
      finally { URL.revokeObjectURL(url); }
      return true;
    }
    if (!FileSystem.cacheDirectory) throw new Error("Export cache unavailable");
    clearTimeout(cleanupTimer); cleanupTimer = undefined;
    if (activePath) await remove(activePath);
    if (!valid()) return false;
    await FileSystem.makeDirectoryAsync(directory, { intermediates: true });
    if (!valid()) return false;
    const path = directory + filename; activePath = path;
    await FileSystem.writeAsStringAsync(path, text, { encoding: "utf8" });
    if (!valid()) { await remove(path); return false; }
    const native = Platform.OS === "android" ? NativeModules.OrdoExportFile as { saveDocument?(filename: string, mime: string, source: string): Promise<void> } | undefined : undefined;
    if (native?.saveDocument) {
      try { await native.saveDocument(filename, "application/json", path); }
      finally { await remove(path); if (activePath === path) activePath = null; }
      return valid();
    }
    const uri = Platform.OS === "android" ? await FileSystem.getContentUriAsync(path) : path;
    if (!valid()) { await remove(path); return false; }
    const result = await Share.share({ title: filename, url: uri });
    if (result.action === Share.dismissedAction || !valid()) { await remove(path); if (activePath === path) activePath = null; return false; }
    // Recipients may open a shared URI after Share.share resolves. Retain just
    // this one file briefly; startup cleanup covers process death.
    cleanupTimer = setTimeout(() => { if (activePath === path) activePath = null; void remove(path); }, 15 * 60 * 1000);
    return true;
  } catch (error) {
    if (activePath) { await remove(activePath); activePath = null; }
    if (typeof error === "object" && error !== null && "code" in error && typeof error.code === "string" && isExportSaveCanceledCode(error.code)) return false;
    throw error;
  } finally { busy = false; }
}
