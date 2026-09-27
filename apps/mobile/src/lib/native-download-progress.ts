/**
 * Download progress for a GitHub APK.
 *
 * The socket often omits Content-Length (redirect, HTTP/2, or gzip), and the
 * first percent of a ~65 MB package is hundreds of kilobytes. Both used to
 * leave the dialog sitting on 0% after the transfer had already started.
 */

export function nativeDownloadRatio(
  bytesWritten: number,
  reportedTotal: number,
  apkSize: number,
): number {
  const written = Number.isFinite(bytesWritten) ? bytesWritten : 0;
  const reported = Number.isFinite(reportedTotal) ? reportedTotal : -1;
  const expected = reported > 0 ? reported : apkSize;
  if (written <= 0 || expected <= 0) return 0;
  return Math.min(1, written / expected);
}

export function formatTransferSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 KB";
  if (bytes < 1024 * 1024) {
    return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  }
  const mb = bytes / (1024 * 1024);
  if (mb < 100) return `${(Math.round(mb * 10) / 10).toFixed(1)} MB`;
  return `${Math.round(mb)} MB`;
}

/** Left-hand status. "Starting" until the first byte, then a moving size. */
export function downloadProgressLabel(receivedBytes: number, apkSize: number): string {
  if (!(receivedBytes > 0)) return "Starting";
  const received = formatTransferSize(receivedBytes);
  if (apkSize > 0) return `${received} of ${formatTransferSize(apkSize)}`;
  return received;
}

export function downloadPercentLabel(ratio: number): string {
  if (!(ratio > 0)) return "";
  if (ratio < 0.005) return "<1%";
  return `${Math.min(100, Math.round(ratio * 100))}%`;
}

/** Bar width 0–100. A short sliver once bytes exist, so sub-1% is visible. */
export function downloadTrackPercent(ratio: number, receivedBytes: number): number {
  if (!(receivedBytes > 0) || !(ratio > 0)) return 0;
  return Math.min(100, Math.max(ratio * 100, 2));
}

/**
 * A finished package matches the GitHub asset size. An unknown size still has
 * to be a real APK, not an HTML error body saved under the same name.
 */
export function apkFileIsComplete(fileSize: number, apkSize: number): boolean {
  if (!Number.isFinite(fileSize) || fileSize <= 0) return false;
  if (apkSize > 0) return fileSize === apkSize;
  return fileSize >= 1_000_000;
}
