import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { applyDotEnvFile, loadConfig, parseDotEnv, resolveDatabaseUrl } from "./configuration.js";

describe("loadConfig rate-limit flags", () => {
  const original = {
    RATE_LIMIT_ENABLED: process.env.RATE_LIMIT_ENABLED,
    TRUST_PROXY: process.env.TRUST_PROXY,
    NODE_ENV: process.env.NODE_ENV,
  };

  afterEach(() => {
    restore("RATE_LIMIT_ENABLED", original.RATE_LIMIT_ENABLED);
    restore("TRUST_PROXY", original.TRUST_PROXY);
    restore("NODE_ENV", original.NODE_ENV);
  });

  it("defaults TRUST_PROXY to 0", () => {
    delete process.env.TRUST_PROXY;
    expect(loadConfig().trustProxy).toBe(0);
  });

  it("defaults to off in test and on otherwise", () => {
    delete process.env.RATE_LIMIT_ENABLED;
    process.env.NODE_ENV = "test";
    expect(loadConfig().rateLimitEnabled).toBe(false);

    process.env.NODE_ENV = "development";
    expect(loadConfig().rateLimitEnabled).toBe(true);
  });

  it("honors RATE_LIMIT_ENABLED and TRUST_PROXY", () => {
    process.env.RATE_LIMIT_ENABLED = "false";
    process.env.TRUST_PROXY = "1";
    const cfg = loadConfig();
    expect(cfg.rateLimitEnabled).toBe(false);
    expect(cfg.trustProxy).toBe(1);

    process.env.RATE_LIMIT_ENABLED = "true";
    expect(loadConfig().rateLimitEnabled).toBe(true);
  });
});

describe("loadConfig identity flags", () => {
  const keys = [
    "MFA_REQUIRED",
    "AVATAR_ALLOW_ANIMATED",
    "AVATAR_STORAGE",
    "PROFILE_PICTURE_MAX_BYTES",
  ] as const;
  const original: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const key of keys) original[key] = process.env[key];
  });

  afterEach(() => {
    for (const key of keys) restore(key, original[key]);
  });

  it("defaults MFA off, filesystem avatars, 2 MB, animation off", () => {
    for (const key of keys) delete process.env[key];
    const cfg = loadConfig();
    expect(cfg.mfaRequired).toBe(false);
    expect(cfg.avatarStorage).toBe("filesystem");
    expect(cfg.avatarAllowAnimated).toBe(false);
    expect(cfg.profilePictureMaxBytes).toBe(2 * 1024 * 1024);
  });

  it("honors MFA_REQUIRED, AVATAR_STORAGE, and size", () => {
    process.env.MFA_REQUIRED = "true";
    process.env.AVATAR_STORAGE = "database";
    process.env.AVATAR_ALLOW_ANIMATED = "1";
    process.env.PROFILE_PICTURE_MAX_BYTES = "512000";
    const cfg = loadConfig();
    expect(cfg.mfaRequired).toBe(true);
    expect(cfg.avatarStorage).toBe("database");
    expect(cfg.avatarAllowAnimated).toBe(true);
    expect(cfg.profilePictureMaxBytes).toBe(512000);
  });
});

describe("loadConfig telemetry stats secret", () => {
  const original = process.env.TELEMETRY_STATS_SECRET;

  afterEach(() => {
    restore("TELEMETRY_STATS_SECRET", original);
  });

  it("defaults to empty so the stats page stays off", () => {
    delete process.env.TELEMETRY_STATS_SECRET;
    expect(loadConfig().telemetryStatsSecret).toBe("");
  });

  it("trims TELEMETRY_STATS_SECRET", () => {
    process.env.TELEMETRY_STATS_SECRET = "  hunter2  ";
    expect(loadConfig().telemetryStatsSecret).toBe("hunter2");
  });
});

describe("parseDotEnv", () => {
  it("skips comments and does not override existing env keys", () => {
    expect(
      parseDotEnv(`
# PORT=9
PORT=3001
DATABASE_URL="file:./ordo.db"
SMTP_FROM='ordo <a@b.c>'
`),
    ).toEqual({
      PORT: "3001",
      DATABASE_URL: "file:./ordo.db",
      SMTP_FROM: "ordo <a@b.c>",
    });

    const env: NodeJS.ProcessEnv = { PORT: "80" };
    const dir = mkdtempSync(join(tmpdir(), "ordo-dotenv-"));
    const file = join(dir, ".env");
    writeFileSync(file, "PORT=3001\nTRUST_PROXY=1\n");
    applyDotEnvFile(file, env);
    expect(env.PORT).toBe("80");
    expect(env.TRUST_PROXY).toBe("1");
  });
});

describe("resolveDatabaseUrl", () => {
  it("keeps absolute sqlite paths and resolves relative ones under prisma/", () => {
    expect(resolveDatabaseUrl("file:/tmp/ordo.db")).toBe("file:/tmp/ordo.db");
    expect(resolveDatabaseUrl("/tmp/ordo.db")).toBe("file:/tmp/ordo.db");
    expect(resolveDatabaseUrl("file:./ordo.db")).toBe(
      `file:${resolve(process.cwd(), "prisma", "./ordo.db")}`,
    );
  });
});

function restore(key: string, value: string | undefined): void {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}
