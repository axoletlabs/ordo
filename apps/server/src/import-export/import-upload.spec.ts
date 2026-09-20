import { AppError } from "../common/errors/app-error.js";
import { importUploadPayload } from "./import-upload.js";

describe("importUploadPayload", () => {
  it("reads a multipart file buffer, stripping a BOM", () => {
    const payload = importUploadPayload(
      { buffer: Buffer.from("\uFEFF<html></html>"), size: 16, originalname: "bookmarks.html" },
      {},
    );
    expect(payload).toEqual({
      name: "bookmarks.html",
      text: "<html></html>",
      size: 16,
    });
  });

  it("reads a JSON body from native clients", () => {
    const payload = importUploadPayload(undefined, {
      filename: "ordo-export.json",
      text: '{"format":"ordo-export"}',
    });
    expect(payload.name).toBe("ordo-export.json");
    expect(payload.text).toBe('{"format":"ordo-export"}');
    expect(payload.size).toBe(Buffer.byteLength(payload.text, "utf8"));
  });

  it("prefers the multipart file when both a file and a JSON body are present", () => {
    const payload = importUploadPayload(
      { buffer: Buffer.from("file-bytes"), originalname: "from-file.html" },
      { filename: "from-json.json", text: "json-bytes" },
    );
    expect(payload.name).toBe("from-file.html");
    expect(payload.text).toBe("file-bytes");
  });

  it("rejects an empty request", () => {
    expect(() => importUploadPayload(undefined, {})).toThrow(AppError);
    expect(() => importUploadPayload(undefined, {})).toThrow(/Choose a file to import/);
  });
});
