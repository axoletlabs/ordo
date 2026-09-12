import {
  clampLimit,
  decodeCursor,
  decodeTitleCursor,
  encodeCursor,
  encodeTitleCursor,
} from "./utils/cursor.js";

describe("cursor pagination", () => {
  it("round-trips a cursor", () => {
    const c = { createdAt: "2026-01-01T00:00:00.000Z", id: "abc123" };
    const encoded = encodeCursor(c);
    expect(encoded).not.toContain("|");
    expect(decodeCursor(encoded)).toEqual(c);
  });

  it("returns null for invalid cursors", () => {
    expect(decodeCursor(null)).toBeNull();
    expect(decodeCursor("")).toBeNull();
    expect(decodeCursor("!!!not-base64!!!")).toBeNull();
    expect(decodeCursor(Buffer.from("onlyonepart").toString("base64url"))).toBeNull();
    expect(decodeCursor(Buffer.from("not-a-date|abc").toString("base64url"))).toBeNull();
  });

  it("round-trips a title cursor including pipes in the title", () => {
    const c = { title: "A | B", id: "abc123" };
    const encoded = encodeTitleCursor(c);
    expect(decodeTitleCursor(encoded)).toEqual(c);
    expect(decodeCursor(encoded)).toBeNull();
  });

  it("returns null for invalid title cursors", () => {
    expect(decodeTitleCursor(null)).toBeNull();
    expect(decodeTitleCursor(encodeCursor({ createdAt: "2026-01-01T00:00:00.000Z", id: "x" }))).toBeNull();
  });

  it("clamps limit to bounds", () => {
    expect(clampLimit(undefined, 20, 100)).toBe(20);
    expect(clampLimit("5", 20, 100)).toBe(5);
    expect(clampLimit(500, 20, 100)).toBe(100);
    expect(clampLimit(0, 20, 100)).toBe(20);
    expect(clampLimit(-3, 20, 100)).toBe(20);
    expect(clampLimit("abc", 20, 100)).toBe(20);
  });
});
