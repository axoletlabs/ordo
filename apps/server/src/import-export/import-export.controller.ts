/**
 * Import / export endpoints.
 *
 * Import is a staged job: POST the file (multipart), poll GET until the
 * preview is ready, then POST commit with a duplicate policy. Export streams
 * a file download. Folder tokens arrive via x-folder-token (one folder)
 * and x-folder-tokens (comma-separated, library or multi-folder exports).
 */
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Req,
  Res,
  StreamableFile,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import type { Request, Response } from "express";
import {
  CommitImportSchema,
  ErrorCode,
  ExportRequestSchema,
  IMPORT_EXPORT,
  type CommitImportInput,
  type ExportRequestInput,
  type ImportJobDto,
} from "@ordo/shared";
import { AuthGuard } from "../auth/auth.guard.js";
import { CurrentUser, type AuthContext } from "../common/decorators/current-user.decorator.js";
import { getPresentedFolderTokens } from "../common/utils/folder-tokens.js";
import { AppError } from "../common/errors/app-error.js";
import { RateLimit } from "../common/rate-limit/rate-limit.decorator.js";
import { ImportService } from "./import.service.js";
import { ExportService } from "./export.service.js";

/** Multer cap sits above the contract limit so we control the error shape. */
const IMPORT_UPLOAD = FileInterceptor("file", {
  limits: { fileSize: IMPORT_EXPORT.MAX_FILE_BYTES + 1024 * 1024, files: 1 },
});

@UseGuards(AuthGuard)
@Controller("api/import-export")
export class ImportExportController {
  constructor(
    private readonly imports: ImportService,
    private readonly exports: ExportService,
  ) {}

  @Post("import")
  @UseInterceptors(IMPORT_UPLOAD)
  @RateLimit("import-upload")
  async upload(
    @CurrentUser() user: AuthContext,
    @UploadedFile() file: { buffer?: Buffer; size?: number; originalname?: string } | undefined,
  ): Promise<{ jobId: string }> {
    if (!file?.buffer) {
      throw new AppError(ErrorCode.VALIDATION_ERROR, "Choose a file to import.");
    }
    if ((file.size ?? file.buffer.length) > IMPORT_EXPORT.MAX_FILE_BYTES) {
      throw new AppError(
        ErrorCode.IMPORT_FILE_TOO_LARGE,
        `Import files can be at most ${Math.floor(IMPORT_EXPORT.MAX_FILE_BYTES / 1024 / 1024)} MB.`,
      );
    }
    const text = file.buffer.toString("utf8").replace(/^\uFEFF/, "");
    return this.imports.createJob(user.userId, file.originalname ?? "import", text);
  }

  @Get("import/:id")
  async status(
    @CurrentUser() user: AuthContext,
    @Param("id") id: string,
  ): Promise<ImportJobDto> {
    return this.imports.getJob(user.userId, id);
  }

  @Post("import/:id/commit")
  async commit(
    @CurrentUser() user: AuthContext,
    @Param("id") id: string,
    @Body({ schema: CommitImportSchema }) body: CommitImportInput,
    @Req() req: Request,
  ): Promise<ImportJobDto> {
    return this.imports.commit(user.userId, id, body, getPresentedFolderTokens(req));
  }

  @Delete("import/:id")
  @HttpCode(200)
  async cancel(
    @CurrentUser() user: AuthContext,
    @Param("id") id: string,
  ): Promise<{ success: true }> {
    await this.imports.cancel(user.userId, id);
    return { success: true };
  }

  @Post("export")
  @RateLimit("export")
  async export(
    @CurrentUser() user: AuthContext,
    @Body({ schema: ExportRequestSchema }) body: ExportRequestInput,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const file = await this.exports.export(user.userId, body, getPresentedFolderTokens(req));
    res.setHeader("content-type", file.contentType);
    res.setHeader("content-disposition", `attachment; filename="${file.filename}"`);
    return new StreamableFile(file.stream);
  }
}
