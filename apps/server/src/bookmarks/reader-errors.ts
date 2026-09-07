import type { ReaderRejectionReason } from "./reader-classify.js";

/** Typed rejection: the bookmark is stored as `unsupported` with this reason. */
export class UnsupportedContentError extends Error {
  constructor(
    readonly reason: ReaderRejectionReason,
    message?: string,
  ) {
    super(message ?? reason);
    this.name = "UnsupportedContentError";
  }
}

export interface SerializedExtractError {
  name: string;
  message: string;
  reason?: ReaderRejectionReason;
}

export function serializeExtractError(err: unknown): SerializedExtractError {
  if (err instanceof UnsupportedContentError) {
    return { name: err.name, message: err.message, reason: err.reason };
  }
  return { name: (err as Error).name ?? "Error", message: (err as Error).message ?? String(err) };
}

export function reviveExtractError(payload: SerializedExtractError): Error {
  if (payload.name === "UnsupportedContentError" && payload.reason) {
    return new UnsupportedContentError(payload.reason, payload.message);
  }
  const err = new Error(payload.message);
  err.name = payload.name || "Error";
  return err;
}
