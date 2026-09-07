import { ErrorCode } from "@ordo/shared";
import { AppError } from "../errors/app-error.js";
import { RateLimitService } from "./rate-limit.service.js";
import {
  formatRetryAfter,
  LOGIN_ACCOUNT,
  RATE_LIMIT,
  rateLimitMessage,
} from "./policies.js";
import type { AppConfig } from "../../config/config.module.js";

function service(enabled = true): RateLimitService {
  return new RateLimitService({ rateLimitEnabled: enabled } as AppConfig);
}

function isRateLimited(err: unknown): err is AppError {
  return err instanceof AppError && err.code === ErrorCode.RATE_LIMITED;
}

function expectLimited(fn: () => void, action: string): number {
  try {
    fn();
    throw new Error("expected rate_limited");
  } catch (err) {
    if (!isRateLimited(err)) throw err;
    expect(err.message).toContain(action);
    const seconds = (err.details as { retryAfterSeconds: number }).retryAfterSeconds;
    expect(seconds).toBeGreaterThanOrEqual(1);
    return seconds;
  }
}

describe("formatRetryAfter", () => {
  it("uses seconds under a minute and minutes after", () => {
    expect(formatRetryAfter(1)).toBe("1 second");
    expect(formatRetryAfter(15)).toBe("15 seconds");
    expect(formatRetryAfter(59)).toBe("59 seconds");
    expect(formatRetryAfter(60)).toBe("1 minute");
    expect(formatRetryAfter(90)).toBe("2 minutes");
    expect(rateLimitMessage("login attempts", 15)).toBe(
      "Too many login attempts. Try again in 15 seconds.",
    );
  });
});

describe("RateLimitService", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("is a no-op when disabled", () => {
    const limiter = service(false);
    for (let i = 0; i < RATE_LIMIT.registerIp.limit + 5; i++) {
      expect(() => limiter.consumeRegister("1.1.1.1")).not.toThrow();
    }
  });

  it("caps a sliding window and reports retry-after", () => {
    const limiter = service();
    const now = 1_700_000_000_000;
    jest.spyOn(Date, "now").mockReturnValue(now);

    for (let i = 0; i < RATE_LIMIT.registerIp.limit; i++) {
      expect(() => limiter.consumeRegister("10.0.0.1")).not.toThrow();
    }
    const retry = expectLimited(() => limiter.consumeRegister("10.0.0.1"), "registration attempts");
    expect(retry).toBe(Math.ceil(RATE_LIMIT.registerIp.windowMs / 1000));

    jest.spyOn(Date, "now").mockReturnValue(now + RATE_LIMIT.registerIp.windowMs);
    expect(() => limiter.consumeRegister("10.0.0.1")).not.toThrow();
  });

  it("rate-limits forgot-password by email and by IP independently", () => {
    const limiter = service();
    const email = "reset@ordo.app";
    for (let i = 0; i < RATE_LIMIT.forgotPasswordEmail.limit; i++) {
      expect(() => limiter.consumeForgotPassword("1.1.1.1", email)).not.toThrow();
    }
    expectLimited(() => limiter.consumeForgotPassword("1.1.1.1", email), "password-reset requests");

    // Same IP, different email still allowed until the IP bucket fills.
    expect(() => limiter.consumeForgotPassword("1.1.1.1", "other@ordo.app")).not.toThrow();
  });

  it("locks an account after max failures and escalates the wait", () => {
    const limiter = service();
    let now = 1_700_000_000_000;
    jest.spyOn(Date, "now").mockImplementation(() => now);
    const keys = { accountKey: "bob@ordo.app", ip: "9.9.9.9", userId: "user-1" };

    for (let i = 0; i < LOGIN_ACCOUNT.maxFailures; i++) {
      limiter.checkLogin(keys);
      limiter.recordLoginFailure(keys);
    }

    const first = expectLimited(() => limiter.checkLogin(keys), "login attempts");
    expect(first).toBe(LOGIN_ACCOUNT.lockMs[0] / 1000);

    now += LOGIN_ACCOUNT.lockMs[0];
    limiter.checkLogin(keys);
    limiter.recordLoginFailure(keys);
    const second = expectLimited(() => limiter.checkLogin(keys), "login attempts");
    expect(second).toBe(LOGIN_ACCOUNT.lockMs[1] / 1000);
  });

  it("keeps the escalated lock after the cap wait, until the idle window", () => {
    const limiter = service();
    let now = 1_700_000_000_000;
    jest.spyOn(Date, "now").mockImplementation(() => now);
    const keys = { accountKey: "cap@ordo.app", ip: "9.9.9.9" };

    for (let i = 0; i < LOGIN_ACCOUNT.maxFailures; i++) {
      limiter.recordLoginFailure(keys);
    }
    for (let i = 0; i < LOGIN_ACCOUNT.lockMs.length; i++) {
      expectLimited(() => limiter.checkLogin(keys), "login attempts");
      now += LOGIN_ACCOUNT.lockMs[i];
      limiter.checkLogin(keys);
      limiter.recordLoginFailure(keys);
    }
    // Lock cap has just started. After it expires, failures must still be hot.
    now += LOGIN_ACCOUNT.lockMs[LOGIN_ACCOUNT.lockMs.length - 1];
    limiter.checkLogin(keys);
    limiter.recordLoginFailure(keys);
    expectLimited(() => limiter.checkLogin(keys), "login attempts");
  });

  it("clears account lockout after a successful login", () => {
    const limiter = service();
    const keys = { accountKey: "bob@ordo.app", ip: "9.9.9.9", userId: "user-1" };
    for (let i = 0; i < LOGIN_ACCOUNT.maxFailures; i++) {
      limiter.recordLoginFailure(keys);
    }
    expectLimited(() => limiter.checkLogin(keys), "login attempts");
    limiter.clearLogin(keys);
    expect(() => limiter.checkLogin(keys)).not.toThrow();
  });

  it("shares lockout across identifier and user id", () => {
    const limiter = service();
    const ip = "8.8.8.8";
    for (let i = 0; i < LOGIN_ACCOUNT.maxFailures; i++) {
      limiter.recordLoginFailure({ accountKey: "alice@ordo.app", ip, userId: "u1" });
    }
    expectLimited(
      () => limiter.checkLogin({ accountKey: "alice", ip, userId: "u1" }),
      "login attempts",
    );
  });

  it("caps failed logins per IP across accounts", () => {
    const limiter = service();
    const ip = "7.7.7.7";
    for (let i = 0; i < RATE_LIMIT.loginIp.limit; i++) {
      limiter.recordLoginFailure({ accountKey: `user-${i}@ordo.app`, ip });
    }
    expectLimited(
      () => limiter.checkLogin({ accountKey: "fresh@ordo.app", ip }),
      "login attempts from this network",
    );
  });

  it("forgets idle failures once the idle window has passed", () => {
    const limiter = service();
    let now = 1_700_000_000_000;
    jest.spyOn(Date, "now").mockImplementation(() => now);
    const keys = { accountKey: "idle@ordo.app", ip: "1.2.3.4" };
    for (let i = 0; i < LOGIN_ACCOUNT.maxFailures - 1; i++) {
      limiter.recordLoginFailure(keys);
    }
    now += LOGIN_ACCOUNT.idleResetMs;
    for (let i = 0; i < LOGIN_ACCOUNT.maxFailures; i++) {
      limiter.checkLogin(keys);
      limiter.recordLoginFailure(keys);
    }
    expectLimited(() => limiter.checkLogin(keys), "login attempts");
  });

  it("limits bookmark creates per user", () => {
    const limiter = service();
    for (let i = 0; i < RATE_LIMIT.bookmarkCreateUser.limit; i++) {
      expect(() => limiter.consumeBookmarkCreate("user-1")).not.toThrow();
    }
    expectLimited(() => limiter.consumeBookmarkCreate("user-1"), "URLs fetched");
    expect(() => limiter.consumeBookmarkCreate("user-2")).not.toThrow();
  });

  it("limits bookmark prefetches per user", () => {
    const limiter = service();
    for (let i = 0; i < RATE_LIMIT.bookmarkPrefetchUser.limit; i++) {
      expect(() => limiter.consumeBookmarkPrefetch("user-1")).not.toThrow();
    }
    expectLimited(() => limiter.consumeBookmarkPrefetch("user-1"), "URL prefetches");
  });

  it("limits failed folder unlocks per user and folder, and clears on success", () => {
    const limiter = service();
    for (let i = 0; i < RATE_LIMIT.folderUnlockUser.limit; i++) {
      limiter.checkFolderUnlock("user-1", "folder-1");
      limiter.recordFolderUnlockFailure("user-1", "folder-1");
    }
    expectLimited(
      () => limiter.checkFolderUnlock("user-1", "folder-1"),
      "folder unlock attempts",
    );
    expect(() => limiter.checkFolderUnlock("user-1", "folder-2")).not.toThrow();

    limiter.clearFolderUnlock("user-1", "folder-1");
    expect(() => limiter.checkFolderUnlock("user-1", "folder-1")).not.toThrow();
  });

  it("does not treat a successful folder unlock as a failure", () => {
    const limiter = service();
    for (let i = 0; i < RATE_LIMIT.folderUnlockUser.limit; i++) {
      limiter.checkFolderUnlock("user-1", "folder-1");
    }
    expect(() => limiter.checkFolderUnlock("user-1", "folder-1")).not.toThrow();
  });

  it("resetAll drops every bucket", () => {
    const limiter = service();
    for (let i = 0; i < RATE_LIMIT.registerIp.limit; i++) {
      limiter.consumeRegister("1.1.1.1");
    }
    limiter.resetAll();
    expect(() => limiter.consumeRegister("1.1.1.1")).not.toThrow();
  });
});
