/**
 * Folders API endpoints.
 */
import {
  FolderRoutes,
  buildPath,
  type BatchFoldersInput,
  type CreateFolderInput,
  type RemoveFolderPasswordInput,
  type SetFolderPasswordInput,
  type UpdateFolderInput,
} from "@ordo/shared";
import { api } from "./client";

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
    api.post<{ token: string; expiresIn: number }>(buildPath(FolderRoutes.unlock.path, { id }), {
      password,
    }),

  batch: (body: BatchFoldersInput) =>
    api.post<typeof FolderRoutes.batch.response>(FolderRoutes.batch.path, body, { folderTokens: true }),
};
