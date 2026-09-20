import assert from "node:assert/strict";
import { test } from "node:test";
import { contentUriFromActivityResult, isExportSaveCanceledCode } from "./import-export-uri.ts";

test("returns a bare content URI", () => {
  const uri = "content://com.android.providers.downloads.documents/document/msf%3A48";
  assert.equal(contentUriFromActivityResult(uri), uri);
});

test("returns a bare file URI", () => {
  const uri = "file:///storage/emulated/0/Download/ordo.json";
  assert.equal(contentUriFromActivityResult(uri), uri);
});

test("extracts dat= from an Intent dump, including Downloads", () => {
  const uri =
    "content://com.android.providers.downloads.documents/document/raw%3A%2Fstorage%2Femulated%2F0%2FDownload%2Fordo-export.json";
  assert.equal(
    contentUriFromActivityResult(
      `Intent { act=android.intent.action.CREATE_DOCUMENT dat=${uri} flg=0x43 }`,
    ),
    uri,
  );
});

test("extracts an externalstorage document URI from an Intent dump", () => {
  const uri = "content://com.android.externalstorage.documents/document/primary%3ADownload%2Fordo.json";
  assert.equal(
    contentUriFromActivityResult(`Intent { dat=${uri} typ=application/json flg=0x3 }`),
    uri,
  );
});

test("ignores missing or unrelated activity data", () => {
  assert.equal(contentUriFromActivityResult(undefined), undefined);
  assert.equal(contentUriFromActivityResult(""), undefined);
  assert.equal(contentUriFromActivityResult("Intent { flg=0x0 }"), undefined);
});

test("treats the native Save As cancel code as canceled", () => {
  assert.equal(isExportSaveCanceledCode("ERR_EXPORT_CANCELED"), true);
  assert.equal(isExportSaveCanceledCode("export_save_canceled"), true);
  assert.equal(isExportSaveCanceledCode("ERR_EXPORT"), false);
  assert.equal(isExportSaveCanceledCode(undefined), false);
});
