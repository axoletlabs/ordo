import assert from "node:assert/strict";
import { test } from "node:test";
import {
  QUICK_SHARE_ENABLED_FILE,
  QUICK_SHARE_FLAG_FILE,
  shareIntakeMode,
} from "./share-intake.ts";

test("default share opens the save sheet", () => {
  assert.equal(
    shareIntakeMode({ quickBookmark: false, showAlongside: false, fromQuickTarget: false }),
    "sheet",
  );
});

test("quick bookmark without a second target saves immediately", () => {
  assert.equal(
    shareIntakeMode({ quickBookmark: true, showAlongside: false, fromQuickTarget: false }),
    "quick",
  );
});

test("alongside keeps the main ordo target on the save sheet", () => {
  assert.equal(
    shareIntakeMode({ quickBookmark: true, showAlongside: true, fromQuickTarget: false }),
    "sheet",
  );
});

test("the quick share target always saves immediately", () => {
  assert.equal(
    shareIntakeMode({ quickBookmark: true, showAlongside: true, fromQuickTarget: true }),
    "quick",
  );
  assert.equal(
    shareIntakeMode({ quickBookmark: false, showAlongside: false, fromQuickTarget: true }),
    "quick",
  );
});

test("sidecar file names stay short and stable for the Android activities", () => {
  assert.equal(QUICK_SHARE_ENABLED_FILE, "ordo-quick-share-enabled");
  assert.equal(QUICK_SHARE_FLAG_FILE, "ordo-quick-share");
});
