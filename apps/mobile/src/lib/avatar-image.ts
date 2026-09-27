/**
 * Turn avatar bytes into a data URI <Image> can show.
 *
 * A single `String.fromCharCode(...bytes)` blows the stack once the photo is
 * larger than a few kilobytes (Hermes, and the 32 KB chunk this used to use).
 */

const BASE64_CHUNK = 0x800;

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += BASE64_CHUNK) {
    const end = Math.min(i + BASE64_CHUNK, bytes.length);
    const codes = new Array<number>(end - i);
    for (let j = i; j < end; j++) codes[j - i] = bytes[j]!;
    binary += String.fromCharCode.apply(null, codes);
  }
  return btoa(binary);
}

/** `image/webp; charset=utf-8` is not a valid data-URI media type. */
export function mimeFromContentType(contentType: string | null | undefined): string {
  const mime = contentType?.split(";")[0]?.trim().toLowerCase() || "";
  return mime.startsWith("image/") ? mime : "image/webp";
}

export function imageDataUri(bytes: Uint8Array, contentType: string | null | undefined): string {
  if (bytes.byteLength === 0) throw new Error("Empty profile picture");
  return `data:${mimeFromContentType(contentType)};base64,${bytesToBase64(bytes)}`;
}

/** Browser upload part. Native uses an expo-file-system File instead. */
export function namedImageFile(blob: Blob): File {
  const type = blob.type.startsWith("image/") ? blob.type : "image/jpeg";
  return new File([blob], "avatar.jpg", { type });
}
