import {
  generateDek,
  isLibraryCiphertext,
  unwrapDekWithPassword,
  unwrapDekWithServerKek,
  unwrapDekWithToken,
  wrapDekWithPassword,
  wrapDekWithServerKek,
  wrapDekWithToken,
  wrapMfaDekStash,
  unwrapMfaDekStash,
  encryptText,
  decryptText,
  generateKdfSalt,
  tagBlindIndex,
} from "./library-crypto.js";

describe("library-crypto", () => {
  it("round-trips field ciphertext and rejects the wrong AAD", () => {
    const dek = generateDek();
    const packed = encryptText(dek, "hello", "aad-a");
    expect(isLibraryCiphertext(packed)).toBe(true);
    expect(decryptText(dek, packed, "aad-a")).toBe("hello");
    expect(decryptText(dek, encryptText(dek, "", "aad-a"), "aad-a")).toBe("");
    expect(decryptText(null, "hello", "aad-a")).toBe("hello");
    expect(() => decryptText(dek, packed, "aad-b")).toThrow();
    expect(() => decryptText(null, packed, "aad-a")).toThrow(/without the account key/);
  });

  it("wraps the DEK with password, server key, session tokens, and MFA stash", async () => {
    const dek = generateDek();
    const salt = generateKdfSalt();
    const passwordWrap = await wrapDekWithPassword(dek, "password123", salt);
    expect(Buffer.compare(await unwrapDekWithPassword(passwordWrap, "password123", salt), dek)).toBe(0);
    await expect(unwrapDekWithPassword(passwordWrap, "nope", salt)).rejects.toThrow();

    const kek = generateDek();
    const serverWrap = wrapDekWithServerKek(dek, kek);
    expect(Buffer.compare(unwrapDekWithServerKek(serverWrap, kek), dek)).toBe(0);
    expect(() => unwrapDekWithServerKek(serverWrap, generateDek())).toThrow();

    const access = wrapDekWithToken(dek, "access-token", "access");
    expect(Buffer.compare(unwrapDekWithToken(access, "access-token", "access"), dek)).toBe(0);
    expect(() => unwrapDekWithToken(access, "access-token", "refresh")).toThrow();

    const stash = wrapMfaDekStash("challenge", { dek });
    const opened = unwrapMfaDekStash("challenge", stash);
    expect(Buffer.compare(opened.dek, dek)).toBe(0);
  });

  it("blinds tag names so duplicates can be detected without storing plaintext", () => {
    const dek = generateDek();
    const a = tagBlindIndex(dek, "user-1", "reading");
    const b = tagBlindIndex(dek, "user-1", "reading");
    const c = tagBlindIndex(dek, "user-1", "other");
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });
});
