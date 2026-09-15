import assert from "node:assert/strict";
import { test } from "node:test";
import {
  RESTART_COVER_MAX_AGE_MS,
  SPLASH_LOGO_HEIGHT,
  SPLASH_LOGO_WIDTH,
  buildReloadScreenOptions,
  parseRestartCover,
  serializeRestartCover,
} from "./runtime-restart.ts";

test("reload screen uses the themed cover instead of Expo's white spinner", () => {
  const options = buildReloadScreenOptions("#1A1A16", "file:///logo-mark.png");
  assert.equal(options.backgroundColor, "#1A1A16");
  assert.equal(options.fade, false);
  assert.equal(options.spinner.enabled, false);
  assert.equal(options.spinner.color, "#1A1A16");
  assert.equal(options.image?.width, SPLASH_LOGO_WIDTH);
  assert.equal(options.image?.height, SPLASH_LOGO_HEIGHT);
  assert.equal(options.image?.scale, 1);
  assert.ok(options.image && options.image.width < 200);
});

test("reload screen stays a solid cover when the mark URI is missing", () => {
  const options = buildReloadScreenOptions("#EFE7D2");
  assert.equal(options.image, undefined);
  assert.equal(options.spinner.enabled, false);
  assert.equal(options.backgroundColor, "#EFE7D2");
});

test("restart cover round-trips and expires", () => {
  const at = 1_000_000;
  const raw = serializeRestartCover({ background: "#000000", mode: "dark" }, at);
  assert.deepEqual(parseRestartCover(raw, at + 1_000), {
    background: "#000000",
    mode: "dark",
    at,
  });
  assert.equal(parseRestartCover(raw, at + RESTART_COVER_MAX_AGE_MS + 1), null);
  assert.equal(parseRestartCover("not-json", at), null);
  assert.equal(parseRestartCover(null, at), null);
});
