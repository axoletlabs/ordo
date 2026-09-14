import { StandardSchemaValidationPipe } from "@nestjs/common";
import { ErrorCode } from "@ordo/shared";
import { AppError } from "../errors/app-error.js";

function issuePath(issue: { path?: readonly unknown[] }): string {
  return (issue.path ?? [])
    .map((segment) => {
      if (typeof segment === "object" && segment !== null && "key" in segment) {
        return String((segment as { key: unknown }).key);
      }
      return String(segment);
    })
    .join(".");
}

/** Keeps the `{ error: { code, message, details } }` envelope after Nest 12's Standard Schema pipe. */
export function createStandardSchemaPipe(): StandardSchemaValidationPipe {
  return new StandardSchemaValidationPipe({
    transform: true,
    exceptionFactory: (issues) => {
      const details = issues.map((issue) => ({
        path: issuePath(issue),
        message: issue.message,
      }));
      const message =
        details.map((d) => (d.path ? `${d.path}: ${d.message}` : d.message))[0] ?? "Invalid input";
      return new AppError(ErrorCode.VALIDATION_ERROR, message, details);
    },
  });
}
