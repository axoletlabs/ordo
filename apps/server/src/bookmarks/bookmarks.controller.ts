import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import type { Request } from "express";
import {
  CreateBookmarkSchema,
  PrefetchBookmarkSchema,
  MarkAllReadSchema,
  BatchBookmarksSchema,
  UpdateBookmarkSchema,
  UpdateBookmarkTagsSchema,
  SetBookmarkContentKindSchema,
  parseBookmarkListSort,
  type BatchBookmarksInput,
  type BookmarkDto,
  type CursorPage,
  type ExtractionProgressDto,
} from "@ordo/shared";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe.js";
import { AuthGuard } from "../auth/auth.guard.js";
import {
  CurrentUser,
  type AuthContext,
} from "../common/decorators/current-user.decorator.js";
import { getPresentedFolderTokens } from "../common/utils/folder-tokens.js";
import { BookmarksService } from "./bookmarks.service.js";
import { ExtractionService } from "./extraction.service.js";
import { FolderAccessService } from "./folder-access.service.js";
import { RateLimit } from "../common/rate-limit/rate-limit.decorator.js";

@UseGuards(AuthGuard)
@Controller("api/bookmarks")
export class BookmarksController {
  constructor(
    private readonly bookmarks: BookmarksService,
    private readonly extraction: ExtractionService,
    private readonly access: FolderAccessService,
  ) {}

  @Post()
  @RateLimit("bookmark-create")
  async create(
    @CurrentUser() user: AuthContext,
    @Body(new ZodValidationPipe(CreateBookmarkSchema)) body: { url: string; folderId?: string | null; tagIds?: string[] },
    @Req() req: Request,
  ): Promise<BookmarkDto> {
    // A missing/null folderId stores the bookmark as unfiled.
    const folder = body.folderId
      ? await this.access.requireFolder(body.folderId, user.userId, getPresentedFolderTokens(req))
      : null;
    return this.bookmarks.create(user.userId, folder, body.url, body.tagIds);
  }

  @Get()
  async list(
    @CurrentUser() user: AuthContext,
    @Query("folderId") folderId: string | undefined,
    @Query("cursor") cursor: string | undefined,
    @Query("limit") limit: string | undefined,
    @Query("scope") scope: string | undefined,
    @Query("tagIds") rawTagIds: string | undefined,
    @Query("sort") sort: string | undefined,
    @Req() req: Request,
  ): Promise<CursorPage<BookmarkDto>> {
    // Without a folderId only the user's unfiled bookmarks are listed.
    const tokens = getPresentedFolderTokens(req);
    const folder = folderId
      ? await this.access.requireFolder(folderId, user.userId, tokens)
      : null;
    return this.bookmarks.list(user.userId, folder, {
      cursor,
      limit: limit ? parseInt(limit, 10) : undefined,
      scopeAll: scope === "all",
      tagIds: this.parseTagIds(rawTagIds),
      folderTokens: tokens,
      sort: parseBookmarkListSort(sort),
    });
  }

  @Get("search")
  async search(
    @CurrentUser() user: AuthContext,
    @Query("q") q: string,
    @Query("cursor") cursor: string | undefined,
    @Query("limit") limit: string | undefined,
    @Query("tagIds") rawTagIds: string | undefined,
    @Query("folderIds") rawFolderIds: string | undefined,
    @Query("unfiled") unfiled: string | undefined,
    @Query("fuzzy") fuzzy: string | undefined,
    @Query("unread") unread: string | undefined,
    @Req() req: Request,
  ): Promise<CursorPage<BookmarkDto>> {
    return this.bookmarks.search(user.userId, q ?? "", {
      cursor,
      limit: limit ? parseInt(limit, 10) : undefined,
      tagIds: this.parseTagIds(rawTagIds),
      folderIds: this.parseTagIds(rawFolderIds),
      unfiled: unfiled === "1" || unfiled === "true",
      fuzzy: fuzzy === "1" || fuzzy === "true",
      unread: unread === "1" || unread === "true" ? true : unread === "0" || unread === "false" ? false : undefined,
      folderTokens: getPresentedFolderTokens(req),
    });
  }

  @Get("extraction-progress")
  async extractionProgress(@CurrentUser() user: AuthContext): Promise<ExtractionProgressDto> {
    return this.extraction.progress(user.userId);
  }

  @Post("prefetch")
  @HttpCode(204)
  @RateLimit("bookmark-prefetch")
  async prefetch(
    @Body(new ZodValidationPipe(PrefetchBookmarkSchema)) body: { url: string },
  ): Promise<void> {
    this.extraction.prefetch(body.url);
  }

  @Get(":id")
  async detail(
    @CurrentUser() user: AuthContext,
    @Param("id") id: string,
    @Req() req: Request,
  ): Promise<BookmarkDto & { contentHtml: string | null }> {
    return this.bookmarks.detail(user.userId, id, getPresentedFolderTokens(req));
  }

  @Patch(":id")
  async update(
    @CurrentUser() user: AuthContext,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(UpdateBookmarkSchema)) body: {
      folderId?: string | null;
      isRead?: boolean;
      readProgress?: number;
      contentKindOverride?: "article" | "web" | null;
    },
    @Req() req: Request,
  ): Promise<BookmarkDto> {
    return this.bookmarks.update(user.userId, id, body, getPresentedFolderTokens(req));
  }

  @Put(":id/content-kind")
  async setContentKind(
    @CurrentUser() user: AuthContext,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(SetBookmarkContentKindSchema)) body: {
      contentKindOverride: "article" | "web";
    },
    @Req() req: Request,
  ): Promise<BookmarkDto> {
    return this.bookmarks.update(user.userId, id, body, getPresentedFolderTokens(req));
  }

  @Delete(":id")
  @HttpCode(200)
  async remove(
    @CurrentUser() user: AuthContext,
    @Param("id") id: string,
    @Req() req: Request,
  ): Promise<{ success: true }> {
    await this.bookmarks.remove(user.userId, id, getPresentedFolderTokens(req));
    return { success: true };
  }

  @Put(":id/tags")
  async updateTags(
    @CurrentUser() user: AuthContext,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(UpdateBookmarkTagsSchema)) body: {
      tagIds: string[];
      dismissedSuggestionIds: string[];
    },
    @Req() req: Request,
  ): Promise<BookmarkDto> {
    return this.bookmarks.updateTags(
      user.userId,
      id,
      body.tagIds,
      body.dismissedSuggestionIds,
      getPresentedFolderTokens(req),
    );
  }

  @Post("mark-all-read")
  @HttpCode(200)
  async markAllRead(
    @CurrentUser() user: AuthContext,
    @Body(new ZodValidationPipe(MarkAllReadSchema)) body: { folderId?: string | null },
    @Req() req: Request,
  ): Promise<{ updated: number }> {
    // Without a folderId (or with null) only unfiled bookmarks are targeted.
    const folder = body.folderId
      ? await this.access.requireFolder(body.folderId, user.userId, getPresentedFolderTokens(req))
      : null;
    const updated = await this.bookmarks.markAllRead(user.userId, folder);
    return { updated };
  }

  @Post("batch")
  @HttpCode(200)
  async batch(
    @CurrentUser() user: AuthContext,
    @Body(new ZodValidationPipe(BatchBookmarksSchema)) body: BatchBookmarksInput,
    @Req() req: Request,
  ): Promise<{ updated: number }> {
    return this.bookmarks.batch(user.userId, body, getPresentedFolderTokens(req));
  }

  private parseTagIds(value: string | undefined): string[] {
    return value
      ? [...new Set(value.split(",").map((id) => id.trim()).filter(Boolean))]
      : [];
  }
}
