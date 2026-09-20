import { ErrorCode, ImportUploadJsonSchema } from "@ordo/shared";
import { AppError } from "../common/errors/app-error.js";

export type ImportUploadFile = {
  buffer?: Buffer;
  size?: number;
  originalname?: string;
};

/**
 * Multipart `file` (web) or JSON `{ filename, text }` (native). Android cannot
 * attach a Downloads `content://` URI through FormData — fetch fails as a
 * network error even when the API is up.
 */
export function importUploadPayload(
  file: ImportUploadFile | undefined,
  body: unknown,
): { name: string; text: string; size: number } {
  if (file?.buffer) {
    const text = file.buffer.toString("utf8").replace(/^\uFEFF/, "");
    return { name: file.originalname ?? "import", text, size: file.size ?? file.buffer.length };
  }
  const parsed = ImportUploadJsonSchema.safeParse(body);
  if (!parsed.success) {
    throw new AppError(ErrorCode.VALIDATION_ERROR, "Choose a file to import.");
  }
  const text = parsed.data.text.replace(/^\uFEFF/, "");
  return { name: parsed.data.filename, text, size: Buffer.byteLength(text, "utf8") };
}
