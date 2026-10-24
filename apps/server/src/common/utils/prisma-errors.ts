import { Prisma } from "../../prisma/client.js";

/**
 * True when a write failed because its target row vanished between the
 * caller's existence check and the write (e.g. a replayed delete raced a
 * slower client). Maps to a clean 404 instead of a 500.
 */
export function isRecordNotFound(cause: unknown): boolean {
  return cause instanceof Prisma.PrismaClientKnownRequestError && cause.code === "P2025";
}

/**
 * SQLite's driver adapter does not identify the violated column. Callers
 * that write several relations must recheck them to classify this error.
 */
export function isForeignKeyViolation(cause: unknown): boolean {
  return cause instanceof Prisma.PrismaClientKnownRequestError && cause.code === "P2003";
}
