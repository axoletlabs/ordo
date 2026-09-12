import assert from "node:assert/strict";
import { test } from "node:test";
import type { FolderDto } from "@ordo/shared";
import { DEFAULT_FOLDER_ICON } from "@ordo/shared";
import { sortFoldersBy } from "./list-sort.ts";

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
