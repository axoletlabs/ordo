import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/** Generate a URL-safe opaque token of the given entropy (bytes). */
export function generateToken(byteLength = 32): string {
  return randomBytes(byteLength).toString("base64url");
}

export function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/** HMAC-SHA256 so a DB dump is not enough to match a leaked raw token. */
export function hmacSha256Hex(value: string, secret: string): string {
  return createHmac("sha256", secret).update(value).digest("hex");
}

/** Unsalted SHA-256. Only for reading session rows minted before HMAC. */
export function hashToken(token: string): string {
  return sha256Hex(token);
}

/** Constant-time comparison of a raw token against its stored hash. */
export function verifyToken(token: string, expectedHash: string): boolean {
  const a = Buffer.from(hashToken(token), "hex");
  const b = Buffer.from(expectedHash, "hex");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/** HMAC-style peppered hash: mixes the app secret so a DB leak alone can't forge tokens. */
export function pepperedHash(token: string, secret: string): string {
  return createHash("sha256").update(`${secret}:${token}`).digest("hex");
}

/** Constant-time equality for stored hex hashes (e.g. peppered OTPs). */
export function equalHex(a: string, b: string): boolean {
  const left = Buffer.from(a, "hex");
  const right = Buffer.from(b, "hex");
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

/** Constant-time equality for CSRF cookies vs the header. */
export function equalUtf8(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

/** Hash a 6-digit email OTP bound to a user so identical codes don't collide. */
export function hashEmailOtp(userId: string, otp: string, secret: string): string {
  return pepperedHash(`${userId}:${otp}`, secret);
}
