import assert from "node:assert/strict";
import { test } from "node:test";
import type { BookmarkDto } from "@ordo/shared";
import { estimateBookmarkRowSize, FOLDER_ROW_SIZE } from "./bookmark-row-layout.ts";

function bookmark(partial: Partial<BookmarkDto> & Pick<BookmarkDto, "id" | "title">): BookmarkDto {
  return {
    folderId: null,
    url: `https://example.com/${partial.id}`,
    description: null,
    domain: "example.com",
    contentText: null,
    contentMarkdown: null,
    fetchStatus: "unsupported",
    extractionReason: null,
    contentKind: "web",
    contentKindOverride: null,
    extractionVersion: 1,
    author: null,
    publishedAt: null,
    readingTimeMinutes: null,
    readProgress: 0,
    completedAt: null,
    isRead: false,
    tags: [],
    suggestedTags: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...partial,
  };
}

test("compact website rows are shorter than tagged articles", () => {
  const web = bookmark({ id: "w", title: "Docs" });
  const article = bookmark({
    id: "a",
    title: "Essay",
    contentKind: "article",
    fetchStatus: "ok",
    description: "A longer standfirst",
    tags: [{ id: "t", name: "news", color: "slate" }],
  });
  assert.ok(estimateBookmarkRowSize(web) < estimateBookmarkRowSize(article));
  assert.ok(FOLDER_ROW_SIZE <= estimateBookmarkRowSize(web));
});
