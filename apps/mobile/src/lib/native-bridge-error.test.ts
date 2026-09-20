import assert from "node:assert/strict";
import { test } from "node:test";
import { looksLikeNativeBridgeError } from "./native-bridge-error.ts";

test("flags Expo FileSystem write failures", () => {
  assert.equal(
    looksLikeNativeBridgeError(
      "Call to function 'ExponentFileSystem.writeAsStringAsync' has been rejected.\n" +
        "→ Caused by: java.io.IOException: Location 'content://com.android.providers.downloads.documents/document/msf:48' isn't writable.",
    ),
    true,
  );
});

test("leaves ordinary messages alone", () => {
  assert.equal(looksLikeNativeBridgeError("Couldn't open a save location."), false);
  assert.equal(looksLikeNativeBridgeError("The export failed."), false);
});
