import assert from "node:assert/strict";
import { test } from "node:test";
import {
  apkFileIsComplete,
  downloadPercentLabel,
  downloadProgressLabel,
  downloadTrackPercent,
  formatTransferSize,
  nativeDownloadRatio,
} from "./native-download-progress.ts";

const APK = 67_896_165;

test("uses the reported length when the socket provides one", () => {
  assert.equal(nativeDownloadRatio(APK / 2, APK, APK), 0.5);
});

test("falls back to the GitHub asset size when Content-Length is missing", () => {
  const ratio = nativeDownloadRatio(1_048_576, -1, APK);
  assert.ok(ratio > 0 && ratio < 0.02);
  assert.equal(nativeDownloadRatio(APK, 0, APK), 1);
});

test("stays at 0 until the first byte and never passes 1", () => {
  assert.equal(nativeDownloadRatio(0, APK, APK), 0);
  assert.equal(nativeDownloadRatio(-1, APK, APK), 0);
  assert.equal(nativeDownloadRatio(APK + 10, APK, 1), 1);
});

test("labels sub-percent progress in kilobytes instead of 0%", () => {
  assert.equal(downloadProgressLabel(0, APK), "Starting");
  assert.equal(downloadProgressLabel(8 * 1024, APK), "8 KB of 64.8 MB");
  assert.equal(downloadPercentLabel(0), "");
  assert.equal(downloadPercentLabel(8 * 1024 / APK), "<1%");
  assert.equal(downloadPercentLabel(0.126), "13%");
  assert.equal(formatTransferSize(APK), "64.8 MB");
});

test("draws a visible sliver before the first whole percent", () => {
  assert.equal(downloadTrackPercent(0, 0), 0);
  assert.equal(downloadTrackPercent(8 * 1024 / APK, 8 * 1024), 2);
  assert.equal(downloadTrackPercent(0.5, APK / 2), 50);
});

test("a short file is not a finished package when the asset size is unknown", () => {
  assert.equal(apkFileIsComplete(0, APK), false);
  assert.equal(apkFileIsComplete(APK, APK), true);
  assert.equal(apkFileIsComplete(APK - 1, APK), false);
  assert.equal(apkFileIsComplete(2048, 0), false);
  assert.equal(apkFileIsComplete(2_000_000, 0), true);
});
