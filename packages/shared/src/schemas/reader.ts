import { z } from "zod";

// Value lists mirror ../reader-preferences.ts (zod-free, used by clients);
// reader.test.ts keeps the two in sync.
// Reader families are reading typefaces. "mono" is no longer offered for
// long-form articles; stored preferences normalize it to Sans.
export const ReaderFontFamilySchema = z.preprocess(
  (value) => value === "mono" ? "sans" : value,
  z.enum(["sans", "serif", "garamond", "bitter", "jost"]),
);
export const ReaderFontSizeSchema = z.enum(["small", "medium", "large", "xlarge"]);
export const ReaderLineSpacingSchema = z.enum(["compact", "default", "relaxed"]);
// Preserve existing accounts/older clients without retaining a Sepia palette.
export const ReaderThemeSchema = z.preprocess(
  (value) => value === "sepia" ? "system" : value,
  z.enum(["system", "light", "dark"]),
);

export const ReaderPreferencesSchema = z.object({
  fontFamily: ReaderFontFamilySchema,
  fontSize: ReaderFontSizeSchema,
  lineSpacing: ReaderLineSpacingSchema,
  theme: ReaderThemeSchema,
  amoled: z.boolean(),
});
export type ReaderPreferencesInput = z.infer<typeof ReaderPreferencesSchema>;

/** Partial patch: only the provided fields are updated. */
export const UpdateReaderPreferencesSchema = ReaderPreferencesSchema.partial()
  .refine((value) => Object.keys(value).length > 0, {
    message: "Provide at least one preference to update.",
  });
export type UpdateReaderPreferencesInput = z.infer<typeof UpdateReaderPreferencesSchema>;
