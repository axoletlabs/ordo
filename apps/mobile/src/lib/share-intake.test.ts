import assert from "node:assert/strict";
import { test } from "node:test";
import {
  QUICK_SHARE_BOOKMARK_FILE,
  QUICK_SHARE_ENABLED_FILE,
  QUICK_SHARE_FLAG_FILE,
  QUICK_SHARE_SESSION_FILE,
  QUICK_SHARE_SESSION_PREFS,
  parseQuickShareSession,
  shareIntakeIsQuickDefault,
  shareIntakeMode,
  shareSavedToast,
  shouldAbandonShareIntake,
  shouldAdoptQuickShareSession,
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

test("quick bookmark without a second target is the native default-save path", () => {
  assert.equal(
    shareIntakeIsQuickDefault({ quickBookmark: true, showAlongside: false }),
    true,
  );
  assert.equal(
    shareIntakeIsQuickDefault({ quickBookmark: true, showAlongside: true }),
    false,
  );
});

test("leaving the app abandons an in-progress save sheet", () => {
  assert.equal(shouldAbandonShareIntake(true, "background"), true);
  assert.equal(shouldAbandonShareIntake(true, "inactive"), true);
  assert.equal(shouldAbandonShareIntake(true, "active"), false);
  assert.equal(shouldAbandonShareIntake(false, "background"), false);
  assert.equal(shouldAbandonShareIntake(false, "active"), false);
});

test("share-target save toasts name the destination", () => {
  assert.equal(shareSavedToast("Bookmarks"), "Saved to Bookmarks");
  assert.equal(shareSavedToast("Recipes"), "Saved to Recipes");
  assert.equal(shareSavedToast("  "), "Saved to Bookmarks");
  assert.equal(shareSavedToast(null), "Saved to Bookmarks");
});

test("sidecar file names stay short and stable for the Android activities", () => {
  assert.equal(QUICK_SHARE_ENABLED_FILE, "ordo-quick-share-enabled");
  assert.equal(QUICK_SHARE_FLAG_FILE, "ordo-quick-share");
  assert.equal(QUICK_SHARE_BOOKMARK_FILE, "ordo-quick-share-bookmark");
  assert.equal(QUICK_SHARE_SESSION_FILE, "ordo-quick-share-session");
  assert.equal(QUICK_SHARE_SESSION_PREFS, "ordo_quick_share_session");
});

test("native session JSON requires tokens, a server, and a newer updatedAt to adopt", () => {
  const sidecar = parseQuickShareSession({
    serverUrl: "https://ordo.example///",
    accessToken: "a",
    refreshToken: "r",
    accessExpiresAt: 9,
    updatedAt: 20,
  });
  assert.deepEqual(sidecar, {
    serverUrl: "https://ordo.example",
    accessToken: "a",
    refreshToken: "r",
    accessExpiresAt: 9,
    updatedAt: 20,
  });
  assert.equal(shouldAdoptQuickShareSession(10, sidecar), true);
  assert.equal(shouldAdoptQuickShareSession(20, sidecar), false);
  assert.equal(shouldAdoptQuickShareSession(null, null), false);
});
