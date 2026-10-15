/**
 * The icon font ships only referenced glyphs. Fails when an icon is added
 * without regenerating it (node --experimental-strip-types scripts/build-icon-font.mjs).
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { candidateIconNames, MATERIAL_GLYPHS, MOBILE_ROOT, requiredGlyphs } from "../scripts/icon-font-scan.mjs";
import { MATERIAL_ICON_GLYPHS } from "../src/theme/material-icon-glyphs.ts";
import { resolveMaterialIconName } from "../src/theme/material-icon-names.ts";

/** Codepoints mapped by a TrueType font's cmap (formats 4 and 12). */
function cmapCodepoints(file) {
  const font = readFileSync(file);
  const tables = font.readUInt16BE(4);
  let cmap = -1;
  for (let i = 0; i < tables; i++) {
    const record = 12 + i * 16;
    if (font.toString("latin1", record, record + 4) === "cmap") cmap = font.readUInt32BE(record + 8);
  }
  assert.ok(cmap >= 0, "font has no cmap");
  const codepoints = new Set();
  const subtables = font.readUInt16BE(cmap + 2);
  for (let i = 0; i < subtables; i++) {
    const offset = cmap + font.readUInt32BE(cmap + 4 + i * 8 + 4);
    const format = font.readUInt16BE(offset);
    if (format === 4) {
      const segments = font.readUInt16BE(offset + 6) / 2;
      const ends = offset + 14;
      const starts = ends + segments * 2 + 2;
      const deltas = starts + segments * 2;
      const ranges = deltas + segments * 2;
      for (let s = 0; s < segments; s++) {
        const end = font.readUInt16BE(ends + s * 2);
        const start = font.readUInt16BE(starts + s * 2);
        const delta = font.readInt16BE(deltas + s * 2);
        const range = font.readUInt16BE(ranges + s * 2);
        for (let code = start; code <= end && code !== 0xffff; code++) {
          let glyph;
          if (range === 0) glyph = (code + delta) & 0xffff;
          else {
            const at = ranges + s * 2 + range + (code - start) * 2;
            glyph = font.readUInt16BE(at);
            if (glyph !== 0) glyph = (glyph + delta) & 0xffff;
          }
          if (glyph !== 0) codepoints.add(code);
        }
      }
    } else if (format === 12) {
      const groups = font.readUInt32BE(offset + 12);
      for (let g = 0; g < groups; g++) {
        const group = offset + 16 + g * 12;
        for (let code = font.readUInt32BE(group); code <= font.readUInt32BE(group + 4); code++) codepoints.add(code);
      }
    }
  }
  return codepoints;
}

test("every icon the app references is in the generated glyph table", () => {
  const missing = [...requiredGlyphs()].filter(([name, code]) => MATERIAL_ICON_GLYPHS[name] !== code).map(([name]) => name);
  assert.deepEqual(missing, [], "run scripts/build-icon-font.mjs to add these icons");
});

test("icons resolve to the same glyph as with the full Material font", () => {
  const full = (material) => material in MATERIAL_GLYPHS;
  const subset = (material) => material in MATERIAL_ICON_GLYPHS;
  for (const name of candidateIconNames()) {
    assert.equal(resolveMaterialIconName(name, subset), resolveMaterialIconName(name, full), name);
  }
});

test("the subset font contains every glyph in the table", () => {
  const codepoints = cmapCodepoints(path.join(MOBILE_ROOT, "assets/fonts/MaterialIcons-Ordo.ttf"));
  for (const [name, code] of Object.entries(MATERIAL_ICON_GLYPHS)) {
    assert.ok(codepoints.has(code), `${name} (U+${code.toString(16)}) is missing from MaterialIcons-Ordo.ttf`);
    assert.equal(MATERIAL_GLYPHS[name], code, `${name} codepoint drifted from @expo/vector-icons`);
  }
});
