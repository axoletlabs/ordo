/**
 * Folder queries + mutations (optimistic create/rename/delete).
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { foldersApi } from "../lib/api/folders";
import { queryClient } from "../lib/query-client";
import { qk, tagsAnyAccess } from "../lib/api/query-keys";
import { errorMessage, isFolderProtected } from "../lib/error-message";
import { deleteUndoable } from "../lib/undoable-delete";
import { toast } from "../components/ui/toast-store";
import { useFolderTokenStore } from "../store/folder-tokens";
import {
  normalizeFolderIcon,
  type CreateFolderInput,
  type FolderDto,
  type FolderLockType,
  type FolderPinLength,
  type UpdateFolderInput,
} from "@ordo/shared";

function mergeMetadata(
  current: FolderDto,
  updated: FolderDto,
  input: UpdateFolderInput,
): FolderDto {
  return {
    ...current,
    ...updated,
    ...input,
    icon: normalizeFolderIcon(input.icon ?? updated.icon ?? current.icon),
    pinned: input.pinned ?? updated.pinned ?? current.pinned ?? false,
    bookmarkCount: current.bookmarkCount,
    unreadCount: current.unreadCount,
  };
}

function sortFolders(folders: FolderDto[]) {
  return [...folders].sort(
    (a, b) => Number(b.pinned) - Number(a.pinned) || a.createdAt.localeCompare(b.createdAt),
  );
}

export { useFolders } from "./queries";

export function useFolderUnlocked(folderId: string | null | undefined): boolean {
  const revision = useFolderTokenStore((s) => s.accessRevision);
  void revision;
  return Boolean(folderId && useFolderTokenStore.getState().get(folderId));
}

export function useCreateFolder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateFolderInput) => foldersApi.create(input),
    onSuccess: (folder) => {
      qc.setQueryData<FolderDto[]>(qk.folders, (old) =>
        sortFolders([
          ...(old ?? []),
          {
            ...folder,
            icon: normalizeFolderIcon(folder.icon),
            pinned: folder.pinned ?? false,
          },
        ]),
      );
    },
  });
}

export function useRenameFolder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) => foldersApi.update(id, { name }),
    onMutate: ({ id, name }) => {
      const prev = qc.getQueryData<FolderDto[]>(qk.folders);
      qc.setQueryData<FolderDto[]>(qk.folders, (old) =>
        (old ?? []).map((f) => (f.id === id ? { ...f, name } : f)),
      );
      return { prev };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(qk.folders, ctx.prev);
    },
    onSuccess: (folder, { id, name }) => {
      qc.setQueryData<FolderDto[]>(qk.folders, (old) =>
        (old ?? []).map((current) =>
          current.id === id ? mergeMetadata(current, folder, { name }) : current,
        ),
      );
    },
  });
}

export function useUpdateFolder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateFolderInput }) =>
      foldersApi.update(id, input),
    onMutate: ({ id, input }) => {
      const prev = qc.getQueryData<FolderDto[]>(qk.folders);
      qc.setQueryData<FolderDto[]>(qk.folders, (old) =>
        sortFolders((old ?? []).map((folder) => (folder.id === id ? { ...folder, ...input } : folder))),
      );
      return { prev };
    },
    onError: (_error, _variables, context) => {
      if (context?.prev) qc.setQueryData(qk.folders, context.prev);
    },
    onSuccess: (updated, { id, input }) => {
      qc.setQueryData<FolderDto[]>(qk.folders, (old) =>
        sortFolders(
          (old ?? []).map((current) =>
            current.id === id ? mergeMetadata(current, updated, input) : current,
          ),
        ),
      );
    },
  });
}

export function useDeleteFolder() {
  return {
    mutate: (folder: FolderDto, opts?: { onDeleted?: () => void }) =>
      deleteUndoable({ folders: [folder], onDeleted: opts?.onDeleted }),
  };
}

export function useBatchFolders() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { action: "delete" | "pin"; ids: string[]; pinned?: boolean }) =>
      foldersApi.batch(
        input.action === "pin"
          ? { action: "pin", ids: input.ids, pinned: input.pinned ?? true }
          : { action: "delete", ids: input.ids },
      ),
    onMutate: (input) => {
      const prev = qc.getQueryData<FolderDto[]>(qk.folders);
      if (input.action === "delete") {
        const removed = new Set(input.ids);
        qc.setQueryData<FolderDto[]>(qk.folders, (old) => (old ?? []).filter((folder) => !removed.has(folder.id)));
      } else {
        qc.setQueryData<FolderDto[]>(qk.folders, (old) =>
          sortFolders(
            (old ?? []).map((folder) =>
              input.ids.includes(folder.id) ? { ...folder, pinned: input.pinned ?? true } : folder,
            ),
          ),
        );
      }
      return { prev };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(qk.folders, ctx.prev);
    },
    onSuccess: (_data, input) => {
      if (input.action === "delete") {
        for (const id of input.ids) useFolderTokenStore.getState().clear(id);
        void qc.invalidateQueries({ queryKey: ["bookmarks"] });
        void qc.invalidateQueries({ queryKey: tagsAnyAccess });
      }
    },
  });
}

export interface FolderActionResult {
  ok: boolean;
  error?: string;
}

/** Unlock a protected folder and cache the token before any refetch runs. */
export function useUnlockFolder() {
  return useMutation({
    mutationFn: async ({ id, password }: { id: string; password: string }) => {
      const result = await foldersApi.unlock(id, password);
      useFolderTokenStore.getState().set(id, result.token, result.expiresIn);
      return result;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["bookmarks"] });
      void queryClient.invalidateQueries({ queryKey: tagsAnyAccess });
    },
  });
}

export function patchFolderLock(
  id: string,
  lock: { protected: boolean; lockType: FolderLockType | null; pinLength?: FolderPinLength | null },
) {
  queryClient.setQueryData<FolderDto[]>(qk.folders, (old) =>
    (old ?? []).map((folder) =>
      folder.id === id ? { ...folder, pinLength: null, ...lock } : folder,
    ),
  );
}

/** Generic folder mutation runner that surfaces a toast on failure. */
export async function runFolderAction<T>(
  fn: () => Promise<T>,
  successMsg?: string,
): Promise<FolderActionResult & { data?: T }> {
  try {
    const data = await fn();
    if (successMsg) toast.success(successMsg);
    return { ok: true, data };
  } catch (e) {
    if (isFolderProtected(e)) return { ok: false, error: "This folder is locked." };
    return { ok: false, error: errorMessage(e) };
  }
}

/** Invalidate all folder + bookmark caches after structural changes. */
export function invalidateBookmarks() {
  void queryClient.invalidateQueries({ queryKey: ["bookmarks"] });
  void queryClient.invalidateQueries({ queryKey: qk.folders });
}
