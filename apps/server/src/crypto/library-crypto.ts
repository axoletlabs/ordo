import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  hkdfSync,
  randomBytes,
  scrypt as scryptCallback,
} from "node:crypto";

export const LIBRARY_CIPHER_PREFIX = "enc1.";
export const RECOVERY_KEY_PREFIX = "rk1.";
export const DATA_ENCRYPTION_VERSION = 1;

const IV_LEN = 12;
const TAG_LEN = 16;
const DEK_LEN = 32;
const SALT_LEN = 16;
const SCRYPT_KEYLEN = 32;
const SCRYPT_R = 8;
const SCRYPT_P = 1;

const WRAP_AAD = {
  password: "ordo:dek:password:v1",
  recovery: "ordo:dek:recovery:v1",
  access: "ordo:dek:session-access:v1",
  refresh: "ordo:dek:session-refresh:v1",
  mfa: "ordo:dek:mfa:v1",
} as const;

export type LibraryFieldKind = "bookmark" | "folder" | "tag" | "highlight" | "import";

export function isLibraryCiphertext(value: string | null | undefined): boolean {
  return typeof value === "string" && value.startsWith(LIBRARY_CIPHER_PREFIX);
}

export function generateDek(): Buffer {
  return randomBytes(DEK_LEN);
}

export function generateRecoveryKey(): string {
  return `${RECOVERY_KEY_PREFIX}${randomBytes(DEK_LEN).toString("base64url")}`;
}

export function normalizeRecoveryKey(value: string): string {
  return value.trim().replace(/\s+/g, "");
}

export function generateKdfSalt(): string {
  return randomBytes(SALT_LEN).toString("base64url");
}

export function fieldAad(kind: LibraryFieldKind, userId: string, id: string, field: string): string {
  return `ordo:field:v1:${kind}:${userId}:${id}:${field}`;
}

export function encryptText(dek: Buffer, plaintext: string, aad: string): string {
  return packCipher(dek, Buffer.from(plaintext, "utf8"), aad);
}

/**
 * Plaintext (no `enc1.` prefix) passes through so tests and pre-migration rows
 * keep working. Ciphertext without a DEK throws rather than leaking blobs to
 * the client.
 */
export function decryptText(dek: Buffer | null, value: string, aad: string): string {
  if (!isLibraryCiphertext(value)) return value;
  if (!dek) {
    throw new Error("Encrypted library data cannot be read without the account key.");
  }
  return unpackCipher(dek, value, aad).toString("utf8");
}

export function decryptOptional(
  dek: Buffer | null,
  value: string | null | undefined,
  aad: string,
): string | null {
  if (value == null) return value ?? null;
  return decryptText(dek, value, aad);
}

export async function wrapDekWithPassword(dek: Buffer, password: string, salt: string): Promise<string> {
  const key = await kdfPassword(password, salt);
  return packCipher(key, dek, WRAP_AAD.password);
}

export async function unwrapDekWithPassword(
  wrapped: string,
  password: string,
  salt: string,
): Promise<Buffer> {
  const key = await kdfPassword(password, salt);
  return unpackDek(key, wrapped, WRAP_AAD.password);
}

export async function wrapDekWithRecoveryKey(dek: Buffer, recoveryKey: string): Promise<string> {
  const salt = randomBytes(SALT_LEN);
  const key = await kdfRecovery(recoveryKey, salt);
  const packed = packCipher(key, dek, WRAP_AAD.recovery);
  return `${LIBRARY_CIPHER_PREFIX}${Buffer.concat([
    salt,
    Buffer.from(packed.slice(LIBRARY_CIPHER_PREFIX.length), "base64url"),
  ]).toString("base64url")}`;
}

export async function unwrapDekWithRecoveryKey(wrapped: string, recoveryKey: string): Promise<Buffer> {
  const raw = decodePrefixed(wrapped);
  if (raw.length < SALT_LEN + IV_LEN + TAG_LEN + DEK_LEN) {
    throw new Error("recovery wrap too short");
  }
  const salt = raw.subarray(0, SALT_LEN);
  const body = `${LIBRARY_CIPHER_PREFIX}${raw.subarray(SALT_LEN).toString("base64url")}`;
  const key = await kdfRecovery(recoveryKey, salt);
  return unpackDek(key, body, WRAP_AAD.recovery);
}

export function wrapDekWithToken(dek: Buffer, token: string, purpose: "access" | "refresh" | "mfa"): string {
  const key = tokenKey(token, purpose);
  const aad = purpose === "access" ? WRAP_AAD.access : purpose === "refresh" ? WRAP_AAD.refresh : WRAP_AAD.mfa;
  return packCipher(key, dek, aad);
}

export function unwrapDekWithToken(
  wrapped: string,
  token: string,
  purpose: "access" | "refresh" | "mfa",
): Buffer {
  const key = tokenKey(token, purpose);
  const aad = purpose === "access" ? WRAP_AAD.access : purpose === "refresh" ? WRAP_AAD.refresh : WRAP_AAD.mfa;
  return unpackDek(key, wrapped, aad);
}

export function tagBlindIndex(dek: Buffer, userId: string, normalizedName: string): string {
  const macKey = Buffer.from(hkdfSync("sha256", dek, "ordo", "ordo:tag-mac:v1", 32));
  return createHmac("sha256", macKey).update(`ordo:tag:${userId}:${normalizedName}`).digest("hex");
}

export interface MfaDekStash {
  dek: Buffer;
  recoveryKey?: string;
}

export function wrapMfaDekStash(challengeToken: string, stash: MfaDekStash): string {
  const payload = JSON.stringify({
    dek: stash.dek.toString("base64url"),
    recoveryKey: stash.recoveryKey,
  });
  return encryptText(tokenKey(challengeToken, "mfa"), payload, WRAP_AAD.mfa);
}

export function unwrapMfaDekStash(challengeToken: string, packed: string): MfaDekStash {
  const json = decryptText(tokenKey(challengeToken, "mfa"), packed, WRAP_AAD.mfa);
  const parsed = JSON.parse(json) as { dek?: string; recoveryKey?: string };
  if (typeof parsed.dek !== "string") throw new Error("mfa dek stash missing");
  return {
    dek: Buffer.from(parsed.dek, "base64url"),
    recoveryKey: typeof parsed.recoveryKey === "string" ? parsed.recoveryKey : undefined,
  };
}

function scryptParams() {
  const test = process.env.NODE_ENV === "test";
  return {
    N: test ? 16 : 16_384,
    r: SCRYPT_R,
    p: SCRYPT_P,
    maxmem: test ? 32 * 1024 * 1024 : 64 * 1024 * 1024,
  };
}

async function kdfPassword(password: string, salt: string): Promise<Buffer> {
  return deriveKey(password, Buffer.from(salt, "base64url"));
}

async function kdfRecovery(recoveryKey: string, salt: Buffer): Promise<Buffer> {
  return deriveKey(normalizeRecoveryKey(recoveryKey), salt);
}

function deriveKey(secret: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCallback(secret, salt, SCRYPT_KEYLEN, scryptParams(), (err, derived) => {
      if (err) reject(err);
      else resolve(derived as Buffer);
    });
  });
}

function tokenKey(token: string, purpose: "access" | "refresh" | "mfa"): Buffer {
  const info =
    purpose === "access"
      ? "ordo:dek:session-access:v1"
      : purpose === "refresh"
        ? "ordo:dek:session-refresh:v1"
        : "ordo:dek:mfa:v1";
  return Buffer.from(hkdfSync("sha256", token, "ordo", info, 32));
}

function packCipher(key: Buffer, plaintext: Buffer, aad: string): string {
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(aad, "utf8"));
  const enc = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${LIBRARY_CIPHER_PREFIX}${Buffer.concat([iv, tag, enc]).toString("base64url")}`;
}

function unpackCipher(key: Buffer, packed: string, aad: string): Buffer {
  const buf = decodePrefixed(packed);
  if (buf.length < IV_LEN + TAG_LEN) throw new Error("ciphertext too short");
  const iv = buf.subarray(0, IV_LEN);
  const tag = buf.subarray(IV_LEN, IV_LEN + TAG_LEN);
  const enc = buf.subarray(IV_LEN + TAG_LEN);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAAD(Buffer.from(aad, "utf8"));
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(enc), decipher.final()]);
}

function unpackDek(key: Buffer, packed: string, aad: string): Buffer {
  const dek = unpackCipher(key, packed, aad);
  if (dek.length !== DEK_LEN) throw new Error("invalid data-encryption key");
  return dek;
}

function decodePrefixed(packed: string): Buffer {
  if (!isLibraryCiphertext(packed)) throw new Error("not library ciphertext");
  return Buffer.from(packed.slice(LIBRARY_CIPHER_PREFIX.length), "base64url");
}
