import { equalHex, equalUtf8, hashEmailOtp, hmacSha256Hex, pepperedHash, sha256Hex } from "./tokens.js";

describe("token helpers", () => {
  it("peppers hashes so a DB leak of 6-digit codes is not enough", () => {
    const otp = "123456";
    const userId = "user-1";
    const a = hashEmailOtp(userId, otp, "secret-a");
    const b = hashEmailOtp(userId, otp, "secret-b");
    expect(a).not.toBe(b);
    expect(a).not.toBe(otp);
  });

  it("binds the OTP to the user so identical codes do not collide", () => {
    const otp = "123456";
    const secret = "shared-secret";
    expect(hashEmailOtp("user-1", otp, secret)).not.toBe(hashEmailOtp("user-2", otp, secret));
  });

  it("compares stored hashes in constant time", () => {
    const hash = pepperedHash("user-1:123456", "secret");
    expect(equalHex(hash, hash)).toBe(true);
    expect(equalHex(hash, pepperedHash("user-1:000000", "secret"))).toBe(false);
    expect(equalHex(hash, "abcd")).toBe(false);
  });

  it("compares UTF-8 CSRF tokens in constant time", () => {
    expect(equalUtf8("token", "token")).toBe(true);
    expect(equalUtf8("token", "other")).toBe(false);
    expect(equalUtf8("token", "tok")).toBe(false);
  });

  it("HMACs session tokens so a DB dump cannot match a leaked raw token", () => {
    const token = "raw-token";
    const hmac = hmacSha256Hex(token, "secret");
    expect(hmac).not.toBe(sha256Hex(token));
    expect(hmacSha256Hex(token, "secret")).toBe(hmac);
    expect(hmacSha256Hex(token, "other")).not.toBe(hmac);
  });
});
