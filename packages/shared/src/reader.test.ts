import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DEFAULT_READER_PREFERENCES,
  normalizeReaderPreferences,
  READER_FONT_FAMILIES,
  READER_FONT_SIZES,
  READER_LINE_SPACINGS,
  READER_THEMES,
} from "./reader-preferences.ts";
import {
  ReaderFontFamilySchema,
  ReaderFontSizeSchema,
  ReaderLineSpacingSchema,
  ReaderPreferencesSchema,
  ReaderThemeSchema,
  UpdateReaderPreferencesSchema,
} from "./schemas/reader.ts";

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

test("zod-free reader preferences match the request schemas", () => {
  assert.deepEqual(ReaderFontSizeSchema.options, [...READER_FONT_SIZES]);
  assert.deepEqual(ReaderLineSpacingSchema.options, [...READER_LINE_SPACINGS]);
  for (const family of READER_FONT_FAMILIES) assert.equal(ReaderFontFamilySchema.parse(family), family);
  for (const theme of READER_THEMES) assert.equal(ReaderThemeSchema.parse(theme), theme);
  assert.equal(ReaderPreferencesSchema.safeParse(DEFAULT_READER_PREFERENCES).success, true);
  const samples: unknown[] = [
    null, 7, "", "{}", "broken", [], { fontFamily: "mono" }, { fontFamily: "bogus", fontSize: 3 },
    { theme: "sepia", amoled: "yes" }, { lineSpacing: "relaxed", amoled: false, fontSize: "small" },
    JSON.stringify({ fontFamily: "jost", theme: "dark", amoled: true }),
  ];
  const catchAll = (value: unknown) => {
    const obj = typeof value === "string" ? (() => { try { return JSON.parse(value); } catch { return {}; } })() : value;
    const record = obj && typeof obj === "object" && !Array.isArray(obj) ? obj as Record<string, unknown> : {};
    return {
      fontFamily: ReaderFontFamilySchema.catch(DEFAULT_READER_PREFERENCES.fontFamily).parse(record.fontFamily),
      fontSize: ReaderFontSizeSchema.catch(DEFAULT_READER_PREFERENCES.fontSize).parse(record.fontSize),
      lineSpacing: ReaderLineSpacingSchema.catch(DEFAULT_READER_PREFERENCES.lineSpacing).parse(record.lineSpacing),
      theme: ReaderThemeSchema.catch(DEFAULT_READER_PREFERENCES.theme).parse(record.theme),
      amoled: typeof record.amoled === "boolean" ? record.amoled : DEFAULT_READER_PREFERENCES.amoled,
    };
  };
  for (const value of samples) assert.deepEqual(normalizeReaderPreferences(value), catchAll(value));
});
