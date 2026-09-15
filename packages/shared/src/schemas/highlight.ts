import { z } from "zod";
import {
  HIGHLIGHT_CONTEXT_MAX_LENGTH,
  HIGHLIGHT_QUOTE_MAX_LENGTH,
} from "../constants.js";

const href = z
  .string()
  .trim()
  .max(2048)
  .url({ message: "Enter a valid URL." })
  .nullable()
  .optional();

function collapseQuote(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function collapseContext(value: string): string {
  return value.replace(/\s+/g, " ");
}

const exact = z
  .string()
  .transform(collapseQuote)
  .pipe(
    z
      .string()
      .min(1, { message: "Select some text to highlight." })
      .max(HIGHLIGHT_QUOTE_MAX_LENGTH, {
        message: `Highlights can be at most ${HIGHLIGHT_QUOTE_MAX_LENGTH} characters.`,
      }),
  );

const context = z
  .string()
  .max(HIGHLIGHT_CONTEXT_MAX_LENGTH)
  .default("")
  .transform(collapseContext);

export const CreateHighlightSchema = z.object({
  exact,
  prefix: context,
  suffix: context,
  href,
});
export type CreateHighlightInput = z.infer<typeof CreateHighlightSchema>;

export const UpdateHighlightSchema = CreateHighlightSchema;
export type UpdateHighlightInput = CreateHighlightInput;
