import { Inject, Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import { ErrorCode } from "@ordo/shared";
import { AppError } from "../errors/app-error.js";
import { APP_CONFIG, type AppConfig } from "../../config/config.module.js";
import {
  LOGIN_ACCOUNT,
  RATE_LIMIT,
  RATE_LIMIT_MAX_KEYS,
  RATE_LIMIT_SWEEP_MS,
  rateLimitMessage,
  type WindowPolicy,
} from "./policies.js";

type WindowEntry = { kind: "window"; count: number; resetAt: number };
type AccountEntry = {
  kind: "account";
  failures: number;
  lockedUntil: number;
  lastAt: number;
};
type Entry = WindowEntry | AccountEntry;

export interface LoginAttemptKeys {
  accountKey: string;
  ip: string;
  userId?: string;
}

@Injectable()
export class RateLimitService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RateLimitService.name);
  private readonly store = new Map<string, Entry>();
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(@Inject(APP_CONFIG) private readonly cfg: AppConfig) {}

  get enabled(): boolean {
    return this.cfg.rateLimitEnabled;
  }

  onModuleInit(): void {
    this.timer = setInterval(() => this.sweep(), RATE_LIMIT_SWEEP_MS);
    this.timer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.store.clear();
  }

  /** Drop every bucket. Used by tests; production buckets expire on their own. */
  resetAll(): void {
    this.store.clear();
  }

  /**
   * Reject if this account (or source IP) is currently locked / over quota.
   * Does not record a failure.
   */
  checkLogin(keys: LoginAttemptKeys): void {
    if (!this.enabled) return;
    this.assertAccountAvailable(this.accountStoreKey(keys.accountKey), "login attempts");
    if (keys.userId) {
      this.assertAccountAvailable(this.userStoreKey(keys.userId), "login attempts");
    }
    this.assertWindow(
      this.ipStoreKey("login", keys.ip),
      RATE_LIMIT.loginIp,
      "login attempts from this network",
    );
  }

  recordLoginFailure(keys: LoginAttemptKeys): void {
    if (!this.enabled) return;
    this.recordAccountFailure(this.accountStoreKey(keys.accountKey));
    if (keys.userId) {
      this.recordAccountFailure(this.userStoreKey(keys.userId));
    }
    this.consumeWindow(
      this.ipStoreKey("login", keys.ip),
      RATE_LIMIT.loginIp,
      "login attempts from this network",
    );
  }

  clearLogin(keys: Pick<LoginAttemptKeys, "accountKey" | "userId">): void {
    if (!this.enabled) return;
    this.store.delete(this.accountStoreKey(keys.accountKey));
    if (keys.userId) this.store.delete(this.userStoreKey(keys.userId));
  }

  consumeRegister(ip: string): void {
    if (!this.enabled) return;
    this.consumeWindow(this.ipStoreKey("register", ip), RATE_LIMIT.registerIp, "registration attempts");
  }

  consumeForgotPassword(ip: string, email: string | null): void {
    if (!this.enabled) return;
    const checks: Array<{ key: string; policy: WindowPolicy; action: string }> = [
      {
        key: this.ipStoreKey("forgot", ip),
        policy: RATE_LIMIT.forgotPasswordIp,
        action: "password-reset requests",
      },
    ];
    if (email) {
      checks.unshift({
        key: `forgot:email:${email}`,
        policy: RATE_LIMIT.forgotPasswordEmail,
        action: "password-reset requests",
      });
    }
    this.consumeAll(checks);
  }

  consumeResetPassword(ip: string): void {
    if (!this.enabled) return;
    this.consumeWindow(
      this.ipStoreKey("reset", ip),
      RATE_LIMIT.resetPasswordIp,
      "password-reset attempts",
    );
  }

  consumeBookmarkCreate(userId: string): void {
    if (!this.enabled) return;
    this.consumeWindow(`bookmark:${userId}`, RATE_LIMIT.bookmarkCreateUser, "URLs fetched");
  }

  consumeBookmarkPrefetch(userId: string): void {
    if (!this.enabled) return;
    this.consumeWindow(`prefetch:${userId}`, RATE_LIMIT.bookmarkPrefetchUser, "URL prefetches");
  }

  /**
   * Reject if this folder's failed-unlock window is already full.
   * Does not record a failure.
   */
  checkFolderUnlock(userId: string, folderId: string): void {
    if (!this.enabled) return;
    this.assertWindow(
      this.folderUnlockKey(userId, folderId),
      RATE_LIMIT.folderUnlockUser,
      "folder unlock attempts",
    );
  }

  recordFolderUnlockFailure(userId: string, folderId: string): void {
    if (!this.enabled) return;
    this.incrementWindow(
      this.folderUnlockKey(userId, folderId),
      RATE_LIMIT.folderUnlockUser,
      Date.now(),
    );
  }

  clearFolderUnlock(userId: string, folderId: string): void {
    if (!this.enabled) return;
    this.store.delete(this.folderUnlockKey(userId, folderId));
  }

  consumeMfaVerify(ip: string): void {
    if (!this.enabled) return;
    this.consumeWindow(this.ipStoreKey("mfa", ip), RATE_LIMIT.mfaVerifyIp, "MFA attempts");
  }

  consumeAvatarUpload(userId: string): void {
    if (!this.enabled) return;
    this.consumeWindow(`avatar:${userId}`, RATE_LIMIT.avatarUploadUser, "avatar uploads");
  }

  consumeImportUpload(userId: string): void {
    if (!this.enabled) return;
    this.consumeWindow(`import:${userId}`, RATE_LIMIT.importUploadUser, "imports");
  }

  consumeExport(userId: string): void {
    if (!this.enabled) return;
    this.consumeWindow(`export:${userId}`, RATE_LIMIT.exportUser, "exports");
  }

  private accountStoreKey(accountKey: string): string {
    return `login:id:${accountKey}`;
  }

  private userStoreKey(userId: string): string {
    return `login:user:${userId}`;
  }

  private ipStoreKey(scope: string, ip: string): string {
    return `${scope}:ip:${ip}`;
  }

  private folderUnlockKey(userId: string, folderId: string): string {
    return `folder-unlock:${userId}:${folderId}`;
  }

  private assertAccountAvailable(key: string, action: string): void {
    const now = Date.now();
    const entry = this.getAccount(key);
    if (!entry) return;
    if (now >= entry.lockedUntil && now - entry.lastAt >= LOGIN_ACCOUNT.idleResetMs) {
      this.store.delete(key);
      return;
    }
    if (now < entry.lockedUntil) {
      this.deny(action, (entry.lockedUntil - now) / 1000);
    }
  }

  private recordAccountFailure(key: string): void {
    const now = Date.now();
    let entry = this.getAccount(key);
    if (!entry || (now >= entry.lockedUntil && now - entry.lastAt >= LOGIN_ACCOUNT.idleResetMs)) {
      entry = { kind: "account", failures: 0, lockedUntil: 0, lastAt: now };
    }
    entry.failures += 1;
    entry.lastAt = now;
    if (entry.failures >= LOGIN_ACCOUNT.maxFailures) {
      const idx = Math.min(
        entry.failures - LOGIN_ACCOUNT.maxFailures,
        LOGIN_ACCOUNT.lockMs.length - 1,
      );
      entry.lockedUntil = now + LOGIN_ACCOUNT.lockMs[idx];
    }
    this.set(key, entry);
  }

  private assertWindow(key: string, policy: WindowPolicy, action: string): void {
    const retry = this.windowRetryAfter(key, policy, Date.now());
    if (retry !== null) this.deny(action, retry);
  }

  private consumeWindow(key: string, policy: WindowPolicy, action: string): void {
    const now = Date.now();
    const retry = this.windowRetryAfter(key, policy, now);
    if (retry !== null) this.deny(action, retry);
    this.incrementWindow(key, policy, now);
  }

  private consumeAll(checks: Array<{ key: string; policy: WindowPolicy; action: string }>): void {
    const now = Date.now();
    let blocked: { action: string; retryAfterSeconds: number } | null = null;
    for (const check of checks) {
      const retry = this.windowRetryAfter(check.key, check.policy, now);
      if (retry !== null && (!blocked || retry > blocked.retryAfterSeconds)) {
        blocked = { action: check.action, retryAfterSeconds: retry };
      }
    }
    if (blocked) this.deny(blocked.action, blocked.retryAfterSeconds);
    for (const check of checks) {
      this.incrementWindow(check.key, check.policy, now);
    }
  }

  private windowRetryAfter(key: string, policy: WindowPolicy, now: number): number | null {
    const entry = this.getWindow(key);
    if (!entry || now >= entry.resetAt) return null;
    if (entry.count >= policy.limit) {
      return Math.max(1, (entry.resetAt - now) / 1000);
    }
    return null;
  }

  private incrementWindow(key: string, policy: WindowPolicy, now: number): void {
    const existing = this.getWindow(key);
    if (!existing || now >= existing.resetAt) {
      this.set(key, { kind: "window", count: 1, resetAt: now + policy.windowMs });
      return;
    }
    existing.count += 1;
    this.set(key, existing);
  }

  private getAccount(key: string): AccountEntry | undefined {
    const entry = this.store.get(key);
    return entry?.kind === "account" ? entry : undefined;
  }

  private getWindow(key: string): WindowEntry | undefined {
    const entry = this.store.get(key);
    return entry?.kind === "window" ? entry : undefined;
  }

  private set(key: string, entry: Entry): void {
    // Re-insert so the map stays LRU-ordered (oldest keys first).
    this.store.delete(key);
    this.store.set(key, entry);
    this.evict();
  }

  private evict(): void {
    while (this.store.size > RATE_LIMIT_MAX_KEYS) {
      const oldest = this.store.keys().next().value;
      if (oldest === undefined) break;
      this.store.delete(oldest);
    }
  }

  private sweep(): void {
    const now = Date.now();
    for (const [key, entry] of this.store) {
      if (entry.kind === "window") {
        if (now >= entry.resetAt) this.store.delete(key);
      } else if (now >= entry.lockedUntil && now - entry.lastAt >= LOGIN_ACCOUNT.idleResetMs) {
        this.store.delete(key);
      }
    }
  }

  private deny(action: string, retryAfterSeconds: number): never {
    const seconds = Math.max(1, Math.ceil(retryAfterSeconds));
    this.logger.warn(`rate_limited (${action}) retryAfter=${seconds}s`);
    throw new AppError(ErrorCode.RATE_LIMITED, rateLimitMessage(action, seconds), {
      retryAfterSeconds: seconds,
    });
  }
}
