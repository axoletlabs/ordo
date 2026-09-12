import assert from "node:assert/strict";
import { test } from "node:test";
import type { BookmarkDto, FolderDto } from "@ordo/shared";
import { DEFAULT_FOLDER_ICON } from "@ordo/shared";
import { sortBookmarksBy, sortFoldersBy } from "./list-sort.ts";

function folder(partial: Partial<FolderDto> & Pick<FolderDto, "id" | "name">): FolderDto {
  return {
    icon: DEFAULT_FOLDER_ICON,
    pinned: false,
    protected: false,
    lockType: null,
    pinLength: null,
    bookmarkCount: 0,
    unreadCount: 0,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...partial,
  };
}

test("sortFoldersBy keeps pinned folders first", () => {
  const recipes = folder({ id: "r", name: "Recipes", createdAt: "2026-03-01T00:00:00.000Z" });
  const inbox = folder({ id: "i", name: "Inbox", pinned: true, createdAt: "2026-02-01T00:00:00.000Z" });
  const later = folder({ id: "l", name: "Later", createdAt: "2026-01-01T00:00:00.000Z" });

  assert.deepEqual(
    sortFoldersBy([recipes, inbox, later], "name").map((item) => item.id),
    ["i", "l", "r"],
  );
  assert.deepEqual(
    sortFoldersBy([recipes, inbox, later], "newest").map((item) => item.id),
    ["i", "r", "l"],
  );
  assert.deepEqual(
    sortFoldersBy([recipes, inbox, later], "oldest").map((item) => item.id),
    ["i", "l", "r"],
  );
});

function bookmark(partial: Pick<BookmarkDto, "id" | "title" | "createdAt">): BookmarkDto {
  return {
    folderId: null,
    url: "https://example.com",
    description: null,
    domain: "example.com",
    contentText: null,
    contentMarkdown: null,
    fetchStatus: "ok",
    extractionReason: null,
    contentKind: "web",
    extractionVersion: 1,
    author: null,
    publishedAt: null,
    readingTimeMinutes: null,
    readProgress: 0,
    completedAt: null,
    isRead: true,
    tags: [],
    suggestedTags: [],
    updatedAt: partial.createdAt,
    ...partial,
  };
}

test("sortBookmarksBy orders titles A–Z regardless of recency", () => {
  const wikimedia = bookmark({ id: "w", title: "Wikimedia", createdAt: "2026-09-12T18:00:00.000Z" });
  const evelogio = bookmark({ id: "e", title: "evelogio.com", createdAt: "2026-09-12T17:00:00.000Z" });
  const dokoplot = bookmark({ id: "d", title: "Dokoplot", createdAt: "2026-09-12T16:00:00.000Z" });
  const pgadmin = bookmark({
    id: "p",
    title: "pgAdmin - PostgreSQL Tools",
    createdAt: "2026-09-12T15:00:00.000Z",
  });
  const loaded = [wikimedia, evelogio, dokoplot, pgadmin];

  assert.deepEqual(
    sortBookmarksBy(loaded, "title").map((item) => item.id),
    ["d", "e", "p", "w"],
  );
  assert.deepEqual(
    sortBookmarksBy(loaded, "titleDesc").map((item) => item.id),
    ["w", "p", "e", "d"],
  );
  assert.deepEqual(
    sortBookmarksBy(loaded, "newest").map((item) => item.id),
    ["w", "e", "d", "p"],
  );
  assert.deepEqual(
    sortBookmarksBy(loaded, "oldest").map((item) => item.id),
    ["p", "d", "e", "w"],
  );
});
