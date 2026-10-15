/**
 * Reader preference values and normalization without zod, so clients can
 * restore stored preferences at launch without loading the request schemas.
 * `schemas/reader.ts` builds its validators from these lists.
 */
import type { ReaderPreferences } from "./types.js";

export const READER_FONT_FAMILIES = ["sans", "serif", "garamond", "bitter", "jost"] as const;
export const READER_FONT_SIZES = ["small", "medium", "large", "xlarge"] as const;
export const READER_LINE_SPACINGS = ["compact", "default", "relaxed"] as const;
export const READER_THEMES = ["system", "light", "dark"] as const;

export const DEFAULT_READER_PREFERENCES: ReaderPreferences = {
  fontFamily: "serif",
  fontSize: "medium",
  lineSpacing: "default",
  theme: "system",
  amoled: false,
};

/** "mono" is no longer offered for long-form articles; it reads as Sans. */
export function migrateReaderFontFamily(value: unknown): unknown {
  return value === "mono" ? "sans" : value;
}

/** Sepia was retired; stored Sepia follows the system scheme. */
export function migrateReaderTheme(value: unknown): unknown {
  return value === "sepia" ? "system" : value;
}

function pick<T extends string>(allowed: readonly T[], value: unknown, fallback: T): T {
  return typeof value === "string" && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

function asRecord(value: unknown): Record<string, unknown> {
  let raw: unknown = value;
  if (typeof raw === "string") {
    try {
      raw = JSON.parse(raw);
    } catch {
      return {};
    }
  }
  return raw && typeof raw === "object" && !Array.isArray(raw)
    ? (raw as Record<string, unknown>)
    : {};
}

/**
 * Map any stored value (JSON text, object, or malformed junk) onto valid
 * preferences, falling back per-field to the defaults. Never throws.
 */
export function normalizeReaderPreferences(value: unknown): ReaderPreferences {
  const obj = asRecord(value);
  const defaults = DEFAULT_READER_PREFERENCES;
  return {
    fontFamily: pick(READER_FONT_FAMILIES, migrateReaderFontFamily(obj.fontFamily), defaults.fontFamily),
    fontSize: pick(READER_FONT_SIZES, obj.fontSize, defaults.fontSize),
    lineSpacing: pick(READER_LINE_SPACINGS, obj.lineSpacing, defaults.lineSpacing),
    theme: pick(READER_THEMES, migrateReaderTheme(obj.theme), defaults.theme),
    amoled: typeof obj.amoled === "boolean" ? obj.amoled : defaults.amoled,
  };
}
