/**
 * Export URI / cancel helpers. Keep this file free of react-native so node tests
 * can import it.
 *
 * Expo's IntentLauncher puts the result Intent's string form in `data`, so we
 * extract `dat=` (the content URI). Newer Expo versions may already return the URI.
 */
export const EXPORT_NATIVE_CANCELED = "ERR_EXPORT_CANCELED";
export const EXPORT_SAVE_CANCELED_CODE = "export_save_canceled";

export function isExportSaveCanceledCode(code: string | undefined): boolean {
  return code === EXPORT_SAVE_CANCELED_CODE || code === EXPORT_NATIVE_CANCELED;
}

export function contentUriFromActivityResult(data: string | undefined): string | undefined {
  if (!data) return undefined;
  const trimmed = data.trim();
  if (isFileOrContentUri(trimmed)) return trimmed;
  const match = trimmed.match(/\bdat=([^\s}]+)/);
  const uri = match?.[1];
  if (uri && isFileOrContentUri(uri)) return uri;
  return undefined;
}

function isFileOrContentUri(value: string): boolean {
  return value.startsWith("content://") || value.startsWith("file://");
}
