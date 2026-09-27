/**
 * Multipart body for POST /api/auth/avatar.
 *
 * Expo's fetch throws on the React Native `{ uri, name, type }` descriptor.
 * The browser's FormData turns that same object into the string "[object Object]",
 * so the server never sees a file. Web sends a real File. Native sends an
 * expo-file-system File, which exposes `bytes()` — the shape Expo's fetch accepts.
 */
import { Platform } from "react-native";
import { File as ExpoFile } from "expo-file-system";
import { namedImageFile } from "./avatar-image";
import { normalizeFileUri } from "./import-export-uri";

export interface ProfilePicturePart {
  body: Blob;
  size: number;
}

export async function profilePicturePart(uri: string): Promise<ProfilePicturePart> {
  if (Platform.OS === "web") {
    const res = await fetch(uri);
    if (!res.ok) throw new Error("Couldn't read that image.");
    const file = namedImageFile(await res.blob());
    if (file.size <= 0) throw new Error("Couldn't read that image.");
    return { body: file, size: file.size };
  }

  const file = new ExpoFile(normalizeFileUri(uri));
  if (!file.exists || file.size <= 0) throw new Error("Couldn't read that image.");
  return { body: file as unknown as Blob, size: file.size };
}
