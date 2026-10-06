import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_READER_PREFERENCES, normalizeReaderPreferences, ReaderFontFamilySchema, ReaderLineSpacingSchema, ReaderThemeSchema, UpdateReaderPreferencesSchema } from "./schemas/reader.ts";

test("reader offers only System, Light and Dark and maps legacy Sepia to System", () => {
  for (const theme of ["system", "light", "dark"]) assert.equal(ReaderThemeSchema.parse(theme), theme);
  assert.equal(ReaderThemeSchema.parse("sepia"), "system");
  assert.deepEqual(UpdateReaderPreferencesSchema.parse({ theme: "sepia" }), { theme: "system" });
  assert.equal(ReaderThemeSchema.safeParse("unknown").success, false);
});

test("legacy stored preferences retain typography and AMOLED while dropping Sepia", () => {
  const legacy = { fontFamily: "mono", fontSize: "xlarge", theme: "sepia", amoled: true };
  for (const value of [legacy, JSON.stringify(legacy)]) {
    assert.deepEqual(
      normalizeReaderPreferences(value),
      { ...legacy, fontFamily: "sans", theme: "system", lineSpacing: "default" },
    );
  }
  assert.deepEqual(normalizeReaderPreferences("broken json"), DEFAULT_READER_PREFERENCES);
});

test("reader offers the reading typefaces and maps legacy values", () => {
  for (const family of ["sans", "serif", "garamond", "bitter", "jost"]) {
    assert.equal(ReaderFontFamilySchema.parse(family), family);
  }
  assert.equal(ReaderFontFamilySchema.parse("mono"), "sans");
  assert.equal(ReaderFontFamilySchema.safeParse("bogus").success, false);
  assert.equal(ReaderLineSpacingSchema.parse("relaxed"), "relaxed");
  assert.equal(ReaderLineSpacingSchema.safeParse("huge").success, false);
});
