import { Test } from "@nestjs/testing";
import { TokenService } from "./token.service.js";
import { APP_CONFIG } from "../config/config.module.js";
import { hmacSha256Hex, sha256Hex } from "../common/utils/tokens.js";

describe("TokenService", () => {
  let svc: TokenService;
  const jwtSecret = "test-jwt-secret";

  beforeAll(async () => {
    const mod = await Test.createTestingModule({
      providers: [
        TokenService,
        { provide: APP_CONFIG, useValue: { jwtSecret } },
      ],
    }).compile();
    svc = mod.get(TokenService);
  });

  it("generates a non-empty token pair with distinct access/refresh", () => {
    const pair = svc.generatePair();
    expect(pair.accessToken).toBeTruthy();
    expect(pair.refreshToken).toBeTruthy();
    expect(pair.accessToken).not.toBe(pair.refreshToken);
    expect(pair.accessHash).not.toBe(pair.accessToken);
    expect(pair.refreshHash).not.toBe(pair.refreshToken);
    expect(pair.expiresIn).toBeGreaterThan(0);
  });

  it("expires access before refresh", () => {
    const pair = svc.generatePair();
    expect(pair.accessTokenExpiresAt.getTime()).toBeLessThan(
      pair.refreshTokenExpiresAt.getTime(),
    );
  });

  it("hashes the same token deterministically", () => {
    const pair = svc.generatePair();
    expect(svc.hash(pair.accessToken)).toBe(pair.accessHash);
    expect(pair.accessHash).toBe(hmacSha256Hex(pair.accessToken, jwtSecret));
    expect(pair.accessHash).not.toBe(sha256Hex(pair.accessToken));
  });

  it("generates unique tokens each call", () => {
    const a = svc.generatePair();
    const b = svc.generatePair();
    expect(a.accessToken).not.toBe(b.accessToken);
    expect(a.refreshToken).not.toBe(b.refreshToken);
  });

  it("looks up both HMAC and legacy SHA-256 hashes", () => {
    const pair = svc.generatePair();
    expect(svc.lookupHashes(pair.accessToken)).toEqual([
      hmacSha256Hex(pair.accessToken, jwtSecret),
      sha256Hex(pair.accessToken),
    ]);
  });

  it("generates a folder token with matching hash", () => {
    const ft = svc.generateFolderToken();
    expect(ft.token).toBeTruthy();
    expect(svc.hash(ft.token)).toBe(ft.hash);
  });

  it("generates a 6-digit verification OTP", () => {
    for (let i = 0; i < 20; i++) {
      expect(svc.generateVerificationToken()).toMatch(/^\d{6}$/);
    }
  });
});
