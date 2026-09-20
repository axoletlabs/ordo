/**
 * Import / export API endpoints.
 */
import { Platform } from "react-native";
import { File } from "expo-file-system";
import * as FileSystem from "expo-file-system/legacy";
import {
  FOLDER_TOKENS_HEADER,
  IMPORT_EXPORT,
  ImportExportRoutes,
  buildPath,
  type CommitImportInput,
  type ExportFormat,
  type ImportJobDto,
  type ImportUploadJsonInput,
} from "@ordo/shared";
import { api } from "./client";
import { normalizeFileUri } from "../import-export-uri";

/** A file chosen with the document picker: {uri} on native, {file} on web. */
export interface PickedImportFile {
  uri?: string;
  file?: Blob;
  name: string;
  size?: number;
}

/** Long budgets for large transfers; polling stays on the default timeout. */
const UPLOAD_TIMEOUT_MS = 90_000;
const EXPORT_TIMEOUT_MS = 120_000;

export const importExportApi = {
  uploadImport: async (picked: PickedImportFile) => {
    if (Platform.OS === "web" && picked.file) {
      const form = new FormData();
      form.append("file", picked.file, picked.name);
      return api.post<typeof ImportExportRoutes.uploadImport.response>(
        ImportExportRoutes.uploadImport.path,
        undefined,
        { formData: form, timeoutMs: UPLOAD_TIMEOUT_MS },
      );
    }
    const text = await readPickedImportText(picked);
    const bytes = new TextEncoder().encode(text).length;
    if (bytes > IMPORT_EXPORT.MAX_FILE_BYTES) {
      throw new Error("That file is larger than 50 MB.");
    }
    const body: ImportUploadJsonInput = {
      filename: picked.name || "import",
      text,
    };
    return api.post<typeof ImportExportRoutes.uploadImport.response>(
      ImportExportRoutes.uploadImport.path,
      body,
      { timeoutMs: UPLOAD_TIMEOUT_MS },
    );
  },

  getImport: (id: string) =>
    api.get<ImportJobDto>(buildPath(ImportExportRoutes.getImport.path, { id })),

  commitImport: (id: string, body: CommitImportInput, folderTokens: string[]) =>
    api.post<ImportJobDto>(buildPath(ImportExportRoutes.commitImport.path, { id }), body, {
      headers: folderTokens.length > 0 ? { [FOLDER_TOKENS_HEADER]: folderTokens.join(",") } : undefined,
    }),

  cancelImport: (id: string) =>
    api.delete<{ success: true }>(buildPath(ImportExportRoutes.cancelImport.path, { id })),

  /** Returns the raw Response; the filename comes from content-disposition. */
  requestExport: (format: ExportFormat, folderIds: string[], folderTokens: string[]) =>
    api.postBlob(
      ImportExportRoutes.export.path,
      { format, ...(folderIds.length > 0 ? { folderIds } : {}) },
      {
        headers: folderTokens.length > 0 ? { [FOLDER_TOKENS_HEADER]: folderTokens.join(",") } : undefined,
        timeoutMs: EXPORT_TIMEOUT_MS,
      },
    ),
};

async function readPickedImportText(picked: PickedImportFile): Promise<string> {
  if (picked.uri) {
    try {
      return await readUriText(picked.uri);
    } catch (err) {
      if (!picked.file || typeof picked.file.text !== "function") throw err;
    }
  }
  if (picked.file && typeof picked.file.text === "function") {
    try {
      return await picked.file.text();
    } catch {
      throw new Error("Couldn't read that file.");
    }
  }
  throw new Error("Couldn't read that file.");
}

async function readUriText(uri: string): Promise<string> {
  const fileUri = normalizeFileUri(uri);
  if (fileUri.startsWith("file:")) {
    try {
      return await FileSystem.readAsStringAsync(fileUri, { encoding: "utf8" });
    } catch {
      /* fall through to a cache copy / content resolver */
    }
  }
  const dest = `${FileSystem.cacheDirectory ?? ""}ordo-import-${Date.now()}`;
  if (FileSystem.cacheDirectory) {
    try {
      await FileSystem.copyAsync({ from: uri, to: dest });
      return await FileSystem.readAsStringAsync(dest, { encoding: "utf8" });
    } catch {
      /* Downloads content:// URIs often need the content resolver */
    }
  }
  try {
    return await new File(uri).text();
  } catch {
    throw new Error("Couldn't read that file.");
  }
}
