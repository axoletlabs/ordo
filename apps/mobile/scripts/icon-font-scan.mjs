/**
 * Finds every Material glyph the app can draw. Icon props are typed as
 * Ionicons names and resolved through LEGACY_ICON_NAMES, so any string
 * literal in the app that is an Ionicons (or mapped) name is a candidate.
 * Persisted folder icons come from the closed FOLDER_ICONS list.
 *
 * Shared by scripts/build-icon-font.mjs and tests/icon-font.test.mjs.
 * Run under `node --experimental-strip-types` (it imports a .ts module).
 */
import { readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { LEGACY_ICON_NAMES, resolveMaterialIconName } from "../src/theme/material-icon-names.ts";

const require = createRequire(import.meta.url);
export const MOBILE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const GLYPHMAPS = path.join(
  path.dirname(require.resolve("@expo/vector-icons/package.json")),
  "build/vendor/react-native-vector-icons",
);
export const MATERIAL_ICONS_TTF = path.join(GLYPHMAPS, "Fonts/MaterialIcons.ttf");
export const MATERIAL_GLYPHS = JSON.parse(readFileSync(path.join(GLYPHMAPS, "glyphmaps/MaterialIcons.json"), "utf8"));
const IONICONS = new Set(Object.keys(JSON.parse(readFileSync(path.join(GLYPHMAPS, "glyphmaps/Ionicons.json"), "utf8"))));

const SOURCE_DIRS = ["app", "src"].map((dir) => path.join(MOBILE_ROOT, dir));
const SHARED_CONSTANTS = path.join(MOBILE_ROOT, "../../packages/shared/src/constants.ts");
const LITERAL = /["'`]([a-z0-9]+(?:-[a-z0-9]+)*)["'`]/g;

function sourceFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(file);
    return /\.(ts|tsx)$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [file] : [];
  });
}

/** Every icon name string the app may pass to MaterialIcon. */
export function candidateIconNames() {
  const names = new Set(Object.keys(LEGACY_ICON_NAMES));
  const files = [...SOURCE_DIRS.flatMap(sourceFiles), SHARED_CONSTANTS];
  for (const file of files) {
    for (const [, literal] of readFileSync(file, "utf8").matchAll(LITERAL)) {
      if (IONICONS.has(literal) || literal in LEGACY_ICON_NAMES) names.add(literal);
    }
  }
  return names;
}

/** Material glyph name → codepoint for everything the app can render. */
export function requiredGlyphs() {
  const has = (material) => material in MATERIAL_GLYPHS;
  const glyphs = new Map([["folder", MATERIAL_GLYPHS.folder]]);
  for (const name of candidateIconNames()) {
    const material = resolveMaterialIconName(name, has);
    glyphs.set(material, MATERIAL_GLYPHS[material]);
  }
  return new Map([...glyphs].sort(([a], [b]) => a.localeCompare(b)));
}
