import { z } from "zod";
import { BATCH_ITEM_LIMIT, MAX_TAGS_PER_BOOKMARK } from "../constants.js";

const url = z
  .string()
  .trim()
  .min(1, { message: "Enter a URL." })
  .url({ message: "Enter a valid URL." })
  .max(2048);

/**
 * Target folder for a bookmark. Omitted or `null` means the bookmark is
 * "unfiled" (it lives outside every folder).
 */
const folderId = z.string().min(1, { message: "Choose a folder." }).nullish();

export const CreateBookmarkSchema = z.object({
  url,
  folderId,
  tagIds: z.array(z.string().min(1)).max(MAX_TAGS_PER_BOOKMARK).optional(),
});
export type CreateBookmarkInput = z.infer<typeof CreateBookmarkSchema>;

export const PrefetchBookmarkSchema = z.object({ url });
export type PrefetchBookmarkInput = z.infer<typeof PrefetchBookmarkSchema>;

export const UpdateBookmarkSchema = z
  .object({
    /** Passing `null` moves the bookmark to unfiled. */
    folderId: folderId.optional(),
    isRead: z.boolean().optional(),
    /** Reading position within the article, 0..1 (>= 0.98 completes it). */
    readProgress: z
      .number()
      .min(0, { message: "Reading progress must be between 0 and 1." })
      .max(1, { message: "Reading progress must be between 0 and 1." })
      .optional(),
    /** `article` / `web` forces presentation; `null` clears the override. */
    contentKindOverride: z.enum(["article", "web"]).nullable().optional(),
  })
  .refine(
    (v) =>
      v.folderId !== undefined ||
      v.isRead !== undefined ||
      v.readProgress !== undefined ||
      v.contentKindOverride !== undefined,
    {
      message: "Provide at least one field to update.",
    },
  );
export type UpdateBookmarkInput = z.infer<typeof UpdateBookmarkSchema>;

/** Dedicated classify payload — required so an empty PATCH cannot silently strip it. */
export const SetBookmarkContentKindSchema = z.object({
  contentKindOverride: z.enum(["article", "web"]),
});
export type SetBookmarkContentKindInput = z.infer<typeof SetBookmarkContentKindSchema>;

/** Without a `folderId` (or with `null`), only unfiled bookmarks are marked read. */
export const MarkAllReadSchema = z.object({
  folderId,
});
export type MarkAllReadInput = z.infer<typeof MarkAllReadSchema>;

const batchIds = z
  .array(z.string().min(1))
  .min(1, { message: "Select at least one bookmark." })
  .max(BATCH_ITEM_LIMIT, { message: `Select at most ${BATCH_ITEM_LIMIT} bookmarks.` });

/** Destination folder for a batch move. `null` files the bookmarks as unfiled. */
const batchFolderId = z.string().min(1, { message: "Choose a folder." }).nullable();

export const BatchBookmarksSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("delete"), ids: batchIds }),
  z.object({ action: z.literal("markRead"), ids: batchIds }),
  z.object({ action: z.literal("markUnread"), ids: batchIds }),
  z.object({ action: z.literal("move"), ids: batchIds, folderId: batchFolderId }),
  z.object({
    action: z.literal("addTags"),
    ids: batchIds,
    tagIds: z.array(z.string().min(1)).min(1).max(MAX_TAGS_PER_BOOKMARK),
  }),
]);
export type BatchBookmarksInput = z.infer<typeof BatchBookmarksSchema>;

export const BatchResultSchema = z.object({
  updated: z.number().int().nonnegative(),
});
export type BatchResult = z.infer<typeof BatchResultSchema>;
