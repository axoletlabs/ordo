import { z } from "zod";
import type { ReaderPreferences } from "../types.js";

export const ReaderFontFamilySchema = z.enum(["sans", "serif", "mono"]);
export const ReaderFontSizeSchema = z.enum(["small", "medium", "large", "xlarge"]);
// Preserve existing accounts/older clients without retaining a Sepia palette.
export const ReaderThemeSchema = z.preprocess(
  (value) => value === "sepia" ? "system" : value,
  z.enum(["system", "light", "dark"]),
);

export const ReaderPreferencesSchema = z.object({
  fontFamily: ReaderFontFamilySchema,
  fontSize: ReaderFontSizeSchema,
  theme: ReaderThemeSchema,
  amoled: z.boolean(),
});
export type ReaderPreferencesInput = z.infer<typeof ReaderPreferencesSchema>;

export const DEFAULT_READER_PREFERENCES: ReaderPreferences = {
  fontFamily: "serif",
  fontSize: "medium",
  theme: "system",
  amoled: false,
};

/** Partial patch: only the provided fields are updated. */
export const UpdateReaderPreferencesSchema = ReaderPreferencesSchema.partial()
  .refine((value) => Object.keys(value).length > 0, {
    message: "Provide at least one preference to update.",
  });
export type UpdateReaderPreferencesInput = z.infer<typeof UpdateReaderPreferencesSchema>;

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
  return {
    fontFamily: ReaderFontFamilySchema.catch(DEFAULT_READER_PREFERENCES.fontFamily).parse(
      obj.fontFamily,
    ),
    fontSize: ReaderFontSizeSchema.catch(DEFAULT_READER_PREFERENCES.fontSize).parse(
      obj.fontSize,
    ),
    theme: ReaderThemeSchema.catch(DEFAULT_READER_PREFERENCES.theme).parse(obj.theme),
    amoled: z.boolean().catch(DEFAULT_READER_PREFERENCES.amoled).parse(obj.amoled),
  };
}
