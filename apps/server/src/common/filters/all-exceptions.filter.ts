import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from "@nestjs/common";
import type { Request, Response } from "express";
import { AppError, type AppErrorPayload } from "../errors/app-error.js";
import { ErrorCode, IMPORT_EXPORT, type ApiError } from "@ordo/shared";

/** Global filter — every response uses the `{ error: ApiError }` envelope. */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger("Exception");

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request>();
    const path = req.method + " " + req.url;

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let payload: ApiError;

    if (exception instanceof AppError) {
      const body = exception.getResponse() as AppErrorPayload;
      status = exception.getStatus();
      payload = {
        code: body.code,
        message: body.message,
        ...(body.details !== undefined ? { details: body.details } : {}),
      };
    } else if (isMulterTooLarge(exception)) {
      const isImport = req.path.startsWith("/api/import-export/");
      status = HttpStatus.PAYLOAD_TOO_LARGE;
      payload = isImport
        ? {
            code: ErrorCode.IMPORT_FILE_TOO_LARGE,
            message: `Import files can be at most ${Math.floor(IMPORT_EXPORT.MAX_FILE_BYTES / 1024 / 1024)} MB.`,
          }
        : {
            code: ErrorCode.AVATAR_TOO_LARGE,
            message: "That image is too large.",
          };
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      const body = exception.getResponse();
      payload = this.fromHttpException(body, status);
    } else {
      this.logger.error(`Unhandled error at ${path}`, (exception as Error)?.stack ?? exception);
      payload = {
        code: ErrorCode.INTERNAL_ERROR,
        message: "Something went wrong on the server.",
      };
    }

    if (status >= 500) {
      this.logger.error(`${payload.code} ${status} at ${path}: ${payload.message}`);
    } else {
      this.logger.warn(`${payload.code} ${status} at ${path}: ${payload.message}`);
    }

    const retryAfter = retryAfterSecondsOf(payload.details);
    if (status === HttpStatus.TOO_MANY_REQUESTS && retryAfter !== null) {
      res.setHeader("Retry-After", String(retryAfter));
    }

    res.status(status).json({ error: payload });
  }

  private fromHttpException(body: unknown, status: HttpStatus): ApiError {
    if (typeof body === "string") {
      if (status === HttpStatus.NOT_FOUND || isExpressMissingRoute(body)) {
        return { code: ErrorCode.NOT_FOUND, message: "That item wasn't found." };
      }
      return { code: ErrorCode.INTERNAL_ERROR, message: body };
    }
    const obj = (body ?? {}) as Record<string, unknown>;

    // class-validator / express default validation errors
    if (Array.isArray(obj.message)) {
      const messages = (obj.message as Array<{ message?: string; property?: string }>).map(
        (m) => (typeof m === "object" && m?.message) || "Invalid input",
      );
      return {
        code: ErrorCode.VALIDATION_ERROR,
        message: messages[0] ?? "Invalid input",
        details: messages,
      };
    }

    const message =
      typeof obj.message === "string"
        ? obj.message
        : typeof obj.message === "object"
          ? "Invalid input"
          : HttpStatus[status] ?? "Error";

    if (status === HttpStatus.NOT_FOUND || isExpressMissingRoute(message)) {
      return { code: ErrorCode.NOT_FOUND, message: "That item wasn't found." };
    }

    return {
      code: ErrorCode.INTERNAL_ERROR,
      message,
    };
  }
}

function isExpressMissingRoute(message: string): boolean {
  return /^Cannot (GET|POST|PUT|PATCH|DELETE) /i.test(message);
}

function retryAfterSecondsOf(details: unknown): number | null {
  if (!details || typeof details !== "object") return null;
  const n = (details as { retryAfterSeconds?: unknown }).retryAfterSeconds;
  if (typeof n !== "number" || !Number.isFinite(n) || n <= 0) return null;
  return Math.ceil(n);
}

function isMulterTooLarge(exception: unknown): boolean {
  return (
    typeof exception === "object" &&
    exception !== null &&
    "code" in exception &&
    (exception as { code?: string }).code === "LIMIT_FILE_SIZE"
  );
}
