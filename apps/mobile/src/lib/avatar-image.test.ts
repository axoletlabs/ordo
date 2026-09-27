import assert from "node:assert/strict";
import { test } from "node:test";
import {
  bytesToBase64,
  imageDataUri,
  mimeFromContentType,
  namedImageFile,
} from "./avatar-image.ts";

test("base64 matches the platform encoder, including photos larger than one chunk", () => {
  const bytes = new Uint8Array(20_000);
  for (let i = 0; i < bytes.length; i++) bytes[i] = i % 256;
  assert.equal(bytesToBase64(bytes), Buffer.from(bytes).toString("base64"));
});

test("data URIs keep only the image media type", () => {
  const bytes = Uint8Array.from([0xff, 0xd8, 0xff, 0x00]);
  assert.equal(mimeFromContentType("image/webp; charset=utf-8"), "image/webp");
  assert.equal(mimeFromContentType("text/plain"), "image/webp");
  assert.equal(mimeFromContentType(null), "image/webp");
  assert.equal(
    imageDataUri(bytes, "Image/JPEG; charset=utf-8"),
    `data:image/jpeg;base64,${Buffer.from(bytes).toString("base64")}`,
  );
});

test("empty pictures are not turned into a blank image", () => {
  assert.throws(() => imageDataUri(new Uint8Array(), "image/webp"), /Empty profile picture/);
});

test("web uploads are a named jpeg file, not a uri descriptor", () => {
  const blob = new Blob([Uint8Array.from([1, 2, 3, 4])], { type: "image/jpeg" });
  const file = namedImageFile(blob);
  assert.equal(file.name, "avatar.jpg");
  assert.equal(file.type, "image/jpeg");
  assert.equal(file.size, 4);
  const form = new FormData();
  form.append("file", file);
  const sent = form.get("file");
  assert.ok(sent instanceof File);
  assert.equal(sent.name, "avatar.jpg");
  assert.equal(sent.size, 4);
});
