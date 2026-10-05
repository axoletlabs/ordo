import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_READER_PREFERENCES, normalizeReaderPreferences, ReaderThemeSchema, UpdateReaderPreferencesSchema } from "./schemas/reader.ts";

test("reader offers only System, Light and Dark and maps legacy Sepia to System", () => {
  for (const theme of ["system", "light", "dark"]) assert.equal(ReaderThemeSchema.parse(theme), theme);
  assert.equal(ReaderThemeSchema.parse("sepia"), "system");
  assert.deepEqual(UpdateReaderPreferencesSchema.parse({ theme: "sepia" }), { theme: "system" });
  assert.equal(ReaderThemeSchema.safeParse("unknown").success, false);
});

test("legacy stored preferences retain typography and AMOLED while dropping Sepia", () => {
  const legacy = { fontFamily: "mono", fontSize: "xlarge", theme: "sepia", amoled: true };
  for (const value of [legacy, JSON.stringify(legacy)]) {
    assert.deepEqual(normalizeReaderPreferences(value), { ...legacy, theme: "system" });
  }
  assert.deepEqual(normalizeReaderPreferences("broken json"), DEFAULT_READER_PREFERENCES);
});
