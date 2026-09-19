import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { FoldersController } from "./folders.controller.js";
import { FoldersService } from "./folders.service.js";
import { BookmarksController } from "./bookmarks.controller.js";
import { BookmarksService } from "./bookmarks.service.js";
import { ExtractionService } from "./extraction.service.js";
import { ReaderService } from "./reader.service.js";
import { FolderTokenService } from "./folder-token.service.js";
import { FolderAccessService } from "./folder-access.service.js";
import { TagsController } from "./tags.controller.js";
import { TagsService } from "./tags.service.js";
import { TagSuggestionService } from "./tag-suggestion.service.js";
import { HighlightsService } from "./highlights.service.js";
import { APP_INTERCEPTOR } from "@nestjs/core";
import { LibraryCryptoInterceptor } from "../crypto/library-crypto.interceptor.js";

@Module({
  imports: [AuthModule],
  controllers: [FoldersController, BookmarksController, TagsController],
  providers: [
    FoldersService,
    BookmarksService,
    ExtractionService,
    ReaderService,
    FolderTokenService,
    FolderAccessService,
    TagsService,
    TagSuggestionService,
    HighlightsService,
    { provide: APP_INTERCEPTOR, useClass: LibraryCryptoInterceptor },
  ],
  exports: [ExtractionService, TagSuggestionService],
})
export class BookmarksModule {}
