/**
 * Folders API endpoints.
 */
import {
  FolderRoutes,
  buildPath,
  normalizeFolderIcon,
  type BatchFoldersInput,
  type CreateFolderInput,
  type DeleteFolderWithKeepsInput,
  type RemoveFolderPasswordInput,
  type SetFolderPasswordInput,
  type UpdateFolderInput,
} from "@ordo/shared";
import { api } from "./client";

/** Fetch + normalize the folder list. Single source for the hook and the launch prefetch. */
export async function fetchFoldersNormalized() {
  const folders = await foldersApi.list();
  return folders.map((folder) => ({
    ...folder,
    icon: normalizeFolderIcon(folder.icon),
    pinned: folder.pinned ?? false,
  }));
}

export const foldersApi = {
  list: () => api.get<typeof FolderRoutes.list.response>(FolderRoutes.list.path),

  create: (input: CreateFolderInput) =>
    api.post<typeof FolderRoutes.create.response>(FolderRoutes.create.path, input),

  update: (id: string, input: UpdateFolderInput) =>
    api.patch<typeof FolderRoutes.update.response>(buildPath(FolderRoutes.update.path, { id }), input),

  remove: (id: string) =>
    api.delete<typeof FolderRoutes.remove.response>(buildPath(FolderRoutes.remove.path, { id }), {
      folderId: id,
    }),

  /**
   * Delete a folder while atomically moving the listed bookmarks to the
   * unfiled root. `keptIds` in the response is the exact preserved set: a
   * keep that another client already moved elsewhere is untouched and absent.
   * OLD SERVERS have no route here — they answer 404 without the app error
   * envelope, which callers must treat as "endpoint missing", never as
   * "folder already deleted".
   */
  deleteWithKeeps: (id: string, keepIds: readonly string[]) =>
    api.post<typeof FolderRoutes.deleteWithKeeps.response>(
      buildPath(FolderRoutes.deleteWithKeeps.path, { id }),
      { keepIds: [...keepIds] } satisfies DeleteFolderWithKeepsInput,
      { folderId: id },
    ),

  setPassword: (id: string, input: SetFolderPasswordInput) =>
    api.post<typeof FolderRoutes.setPassword.response>(
      buildPath(FolderRoutes.setPassword.path, { id }),
      input,
      { folderId: id },
    ),

  removePassword: (id: string, body: RemoveFolderPasswordInput) =>
    api.post<typeof FolderRoutes.removePassword.response>(
      buildPath(FolderRoutes.removePassword.path, { id }),
      body,
    ),

  unlock: (id: string, password: string) =>
    api.post<typeof FolderRoutes.unlock.response>(buildPath(FolderRoutes.unlock.path, { id }), {
      password,
    }),

  batch: (body: BatchFoldersInput) =>
    api.post<typeof FolderRoutes.batch.response>(FolderRoutes.batch.path, body),
};
