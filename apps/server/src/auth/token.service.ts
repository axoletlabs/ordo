import { Inject, Injectable } from "@nestjs/common";
import { EMAIL_OTP, TOKEN_TTL } from "@ordo/shared";
import { randomInt } from "node:crypto";
import { APP_CONFIG, type AppConfig } from "../config/config.module.js";
import { generateToken, hmacSha256Hex, sha256Hex } from "../common/utils/tokens.js";

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  accessHash: string;
  refreshHash: string;
  accessTokenExpiresAt: Date;
  refreshTokenExpiresAt: Date;
  /** Access-token lifetime in seconds (for clients to schedule refresh). */
  expiresIn: number;
}

/** Creates opaque random-byte token pairs and hashes for storage. */
@Injectable()
export class TokenService {
  constructor(@Inject(APP_CONFIG) private readonly cfg: AppConfig) {}

  generatePair(): TokenPair {
    const accessToken = generateToken(32);
    const refreshToken = generateToken(48);
    const now = Date.now();
    const accessTokenExpiresAt = new Date(now + TOKEN_TTL.ACCESS_MS);
    const refreshTokenExpiresAt = new Date(now + TOKEN_TTL.REFRESH_MS);
    return {
      accessToken,
      refreshToken,
      accessHash: this.hash(accessToken),
      refreshHash: this.hash(refreshToken),
      accessTokenExpiresAt,
      refreshTokenExpiresAt,
      expiresIn: Math.round(TOKEN_TTL.ACCESS_MS / 1000),
    };
  }

  generateFolderToken(): { token: string; hash: string } {
    const token = generateToken(32);
    return { token, hash: this.hash(token) };
  }

  generateVerificationToken(): string {
    const max = 10 ** EMAIL_OTP.LENGTH;
    return String(randomInt(0, max)).padStart(EMAIL_OTP.LENGTH, "0");
  }

  /** HMAC with JWT_SECRET. New rows always store this. */
  hash(token: string): string {
    return hmacSha256Hex(token, this.cfg.jwtSecret);
  }

  /** Pre-HMAC unsalted hash, for dual-read of existing sessions. */
  legacyHash(token: string): string {
    return sha256Hex(token);
  }

  lookupHashes(token: string): string[] {
    const modern = this.hash(token);
    const legacy = this.legacyHash(token);
    return modern === legacy ? [modern] : [modern, legacy];
  }
}
