import { z } from "zod";
import {
  BATCH_ITEM_LIMIT,
  FOLDER_DELETE_KEEP_LIMIT,
  FOLDER_ICONS,
  FOLDER_PIN_LENGTHS,
} from "../constants.js";
import type { FolderLockType } from "../types.js";

/** One alternative per allowed PIN length (4 or 6 digits). */
const PIN_PATTERN = new RegExp(`^(?:${FOLDER_PIN_LENGTHS.map((n) => `\\d{${n}}`).join("|")})$`);

const name = z
  .string()
  .trim()
  .min(1, { message: "Enter a folder name." })
  .max(100, { message: "Name is too long." });

/** Valid folder icons (curated Ionicons outline names). */
export const FolderIconSchema = z.enum(FOLDER_ICONS);

export const CreateFolderSchema = z.object({
  name,
  icon: FolderIconSchema.optional(),
});
export type CreateFolderInput = z.infer<typeof CreateFolderSchema>;

export const UpdateFolderSchema = z
  .object({
    name: name.optional(),
    icon: FolderIconSchema.optional(),
    pinned: z.boolean().optional(),
  })
  .refine((data) => data.name !== undefined || data.icon !== undefined || data.pinned !== undefined, {
    message: "Provide at least one field to update.",
  });
export type UpdateFolderInput = z.infer<typeof UpdateFolderSchema>;

export const FolderLockTypeSchema = z.enum(["device", "pattern", "pin", "password"]);

export const SetFolderPasswordSchema = z
  .object({
    password: z.string().min(1).max(256),
    lockType: FolderLockTypeSchema.default("password"),
  })
  .superRefine(({ password, lockType }, context) => {
    if (lockType === "pin" && !PIN_PATTERN.test(password)) {
      context.addIssue({ code: "custom", path: ["password"], message: "Use a 4 or 6 digit PIN." });
    } else if (lockType === "pattern") {
      const nodes = password.split("-");
      if (nodes.length < 4 || new Set(nodes).size !== nodes.length || nodes.some((node) => !/^[0-8]$/.test(node))) {
        context.addIssue({ code: "custom", path: ["password"], message: "Connect at least 4 different dots." });
      }
    } else if (lockType === "password" && password.length < 4) {
      context.addIssue({ code: "custom", path: ["password"], message: "Use at least 4 characters." });
    } else if (lockType === "device" && password.length < 32) {
      context.addIssue({ code: "custom", path: ["password"], message: "The device credential is invalid." });
    }
  });
export type SetFolderPasswordInput = z.infer<typeof SetFolderPasswordSchema>;

export type { FolderLockType };

export const UnlockFolderSchema = z.object({
  password: z.string().min(1, { message: "Enter the folder password." }),
});
export type UnlockFolderInput = z.infer<typeof UnlockFolderSchema>;

/** Remove a folder lock with either the folder password or the account password. */
export const RemoveFolderPasswordSchema = z
  .object({
    folderPassword: z.string().min(1, { message: "Enter the folder password." }).max(256).optional(),
    accountPassword: z.string().min(1, { message: "Enter your account password." }).max(256).optional(),
  })
  .refine((data) => Boolean(data.folderPassword) !== Boolean(data.accountPassword), {
    message: "Enter the folder password or your account password.",
  });
export type RemoveFolderPasswordInput = z.infer<typeof RemoveFolderPasswordSchema>;

/**
 * Delete a folder while atomically preserving selected bookmarks: the server
 * moves the listed bookmarks to unfiled and deletes the folder (and its
 * remaining bookmarks) in one transaction. `keepIds` that are no longer in
 * this folder — moved elsewhere, already deleted, or never owned — are
 * untouched no-ops and never block the request.
 *
 * Strict and required: this is a destructive endpoint, so a typo'd payload
 * (`{}`, `{keepBookmarks: [...]}`) must fail validation instead of silently
 * cascading every bookmark. An explicit `{"keepIds": []}` deletes the folder
 * and everything in it, on purpose.
 */
export const DeleteFolderWithKeepsSchema = z
  .object({
    keepIds: z
      .array(z.string().min(1))
      .max(FOLDER_DELETE_KEEP_LIMIT, {
        message: `Select at most ${FOLDER_DELETE_KEEP_LIMIT} bookmarks to keep.`,
      }),
  })
  .strict();
export type DeleteFolderWithKeepsInput = z.infer<typeof DeleteFolderWithKeepsSchema>;

const batchFolderIds = z
  .array(z.string().min(1))
  .min(1, { message: "Select at least one folder." })
  .max(BATCH_ITEM_LIMIT, { message: `Select at most ${BATCH_ITEM_LIMIT} folders.` });

export const BatchFoldersSchema = z.discriminatedUnion("action", [
  // Strict: a misrouted `keepIds` must fail loudly instead of being stripped
  // and cascading the very bookmarks the caller meant to preserve.
  z
    .object({ action: z.literal("delete"), ids: batchFolderIds })
    .strict(),
  z.object({ action: z.literal("pin"), ids: batchFolderIds, pinned: z.boolean() }),
]);
export type BatchFoldersInput = z.infer<typeof BatchFoldersSchema>;
