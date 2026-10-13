import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { applyDotEnvFile, loadConfig, parseDotEnv, resolveDatabaseUrl } from "./configuration.js";

describe("loadConfig listen host and registration", () => {
  const original = {
    LISTEN_HOST: process.env.LISTEN_HOST,
    REGISTRATION_ENABLED: process.env.REGISTRATION_ENABLED,
  };

  afterEach(() => {
    restore("LISTEN_HOST", original.LISTEN_HOST);
    restore("REGISTRATION_ENABLED", original.REGISTRATION_ENABLED);
  });

  it("binds localhost and closes sign-ups after the first account by default", () => {
    delete process.env.LISTEN_HOST;
    delete process.env.REGISTRATION_ENABLED;
    const cfg = loadConfig();
    expect(cfg.listenHost).toBe("127.0.0.1");
    expect(cfg.registrationEnabled).toBe(false);
  });

  it("honors LISTEN_HOST=0.0.0.0", () => {
    process.env.LISTEN_HOST = "0.0.0.0";
    expect(loadConfig().listenHost).toBe("0.0.0.0");
  });

  it("rejects an unknown LISTEN_HOST", () => {
    process.env.LISTEN_HOST = "1.2.3.4";
    expect(() => loadConfig()).toThrow(/LISTEN_HOST/);
  });
});

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

describe("loadConfig library wrapping key", () => {
  const original = process.env.LIBRARY_KEK;

  afterEach(() => {
    restore("LIBRARY_KEK", original);
  });

  it("uses a 32-byte hex LIBRARY_KEK as-is", () => {
    process.env.LIBRARY_KEK = "AA".repeat(32);
    expect(loadConfig().libraryKek).toBe("aa".repeat(32));
  });

  it("derives a 32-byte key from a passphrase", () => {
    process.env.LIBRARY_KEK = "not-hex";
    expect(loadConfig().libraryKek).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("loadConfig implicit-secret warning in production", () => {
  const original = {
    NODE_ENV: process.env.NODE_ENV,
    JWT_SECRET: process.env.JWT_SECRET,
    LIBRARY_KEK: process.env.LIBRARY_KEK,
  };

  afterEach(() => {
    restore("NODE_ENV", original.NODE_ENV);
    restore("JWT_SECRET", original.JWT_SECRET);
    restore("LIBRARY_KEK", original.LIBRARY_KEK);
  });

  it("warns when production runs without explicit secrets", () => {
    delete process.env.JWT_SECRET;
    delete process.env.LIBRARY_KEK;
    process.env.NODE_ENV = "production";
    // Production mode persists sidecar secret files; clean up what this test makes.
    const sidecars = [join(process.cwd(), ".ordo-secret"), join(process.cwd(), ".ordo-library-key")];
    const existed = new Set(sidecars.filter((p) => existsSync(p)));
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
    try {
      loadConfig();
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0][0]).toMatch(/JWT_SECRET and LIBRARY_KEK/);
      expect(warn.mock.calls[0][0]).toMatch(/scripts\/deploy-server/);
    } finally {
      warn.mockRestore();
      for (const path of sidecars) if (!existed.has(path) && existsSync(path)) rmSync(path);
    }
  });

  it("stays quiet when both secrets are explicit", () => {
    process.env.NODE_ENV = "production";
    process.env.JWT_SECRET = "explicit";
    process.env.LIBRARY_KEK = "aa".repeat(32);
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
    try {
      loadConfig();
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
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

describe("loadConfig SMTP_REQUIRED", () => {
  const original = process.env.SMTP_REQUIRED;

  afterEach(() => {
    restore("SMTP_REQUIRED", original);
  });

  it("treats SMTP_REQUIRED=false as off", () => {
    process.env.SMTP_REQUIRED = "false";
    expect(loadConfig().smtpRequired).toBe(false);
  });

  it("honors SMTP_REQUIRED", () => {
    process.env.SMTP_REQUIRED = "true";
    expect(loadConfig().smtpRequired).toBe(true);
  });
});

describe("loadConfig cors allowlist", () => {
  const original = process.env.CORS_ALLOWED_ORIGINS;

  afterEach(() => {
    restore("CORS_ALLOWED_ORIGINS", original);
  });

  it("defaults to empty (same-origin plus loopback)", () => {
    delete process.env.CORS_ALLOWED_ORIGINS;
    expect(loadConfig().corsAllowedOrigins).toEqual([]);
  });

  it("parses a comma-separated list", () => {
    process.env.CORS_ALLOWED_ORIGINS = "https://ordo.axolet.com/, http://localhost:8081";
    expect(loadConfig().corsAllowedOrigins).toEqual([
      "https://ordo.axolet.com",
      "http://localhost:8081",
    ]);
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
