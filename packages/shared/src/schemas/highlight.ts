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

export const CreateHighlightSchema = z.object({
  exact: z
    .string()
    .trim()
    .min(1, { message: "Select some text to highlight." })
    .max(HIGHLIGHT_QUOTE_MAX_LENGTH, {
      message: `Highlights can be at most ${HIGHLIGHT_QUOTE_MAX_LENGTH} characters.`,
    }),
  prefix: z.string().max(HIGHLIGHT_CONTEXT_MAX_LENGTH).default(""),
  suffix: z.string().max(HIGHLIGHT_CONTEXT_MAX_LENGTH).default(""),
  href,
});
export type CreateHighlightInput = z.infer<typeof CreateHighlightSchema>;
