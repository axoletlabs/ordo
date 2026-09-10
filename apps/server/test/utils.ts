import { execSync } from "node:child_process";
import { existsSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { Test, type TestingModuleBuilder } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import cookieParser from "cookie-parser";
import { AppModule } from "../src/app.module.js";
import { APP_CONFIG } from "../src/config/config.module.js";
import { loadConfig } from "../src/config/configuration.js";
import { PrismaService } from "../src/prisma/prisma.service.js";

export interface TestCtx {
  app: INestApplication;
  prisma: PrismaService;
  dbPath: string;
}

const SERVER_DIR = join(__dirname, "..");

/** Provisions a fresh temp SQLite DB with the current schema and boots the app. */
export async function createTestApp(
  options: {
    config?: Record<string, unknown>;
    customize?: (builder: TestingModuleBuilder) => TestingModuleBuilder;
  } = {},
): Promise<TestCtx> {
  const dbPath = `/tmp/ordo-e2e-${process.pid}-${Date.now()}-${Math.random()
    .toString(36)
    .slice(2)}.db`;
  if (existsSync(dbPath)) unlinkSync(dbPath);

  execSync(`DATABASE_URL="file:${dbPath}" prisma db push --skip-generate`, {
    cwd: SERVER_DIR,
    stdio: ["ignore", "ignore", "ignore"],
    env: { ...process.env, DATABASE_URL: `file:${dbPath}` },
  });

  const base = loadConfig();
  const cfg = {
    ...base,
    databaseUrl: `file:${dbPath}`,
    registrationEnabled: true,
    emailVerificationRequired: false,
    smtpUrl: null,
    rateLimitEnabled: false,
    trustProxy: 0,
    ...(options.config ?? {}),
  };

  let builder = Test.createTestingModule({ imports: [AppModule] }).overrideProvider(APP_CONFIG);
  // overrideProvider returns a stripped builder; apply the config value, then
  // hand back a regular TestingModuleBuilder for further overrides.
  const moduleRef = await (options.customize ?? ((b: TestingModuleBuilder) => b))(
    builder.useValue(cfg),
  ).compile();

  const app = moduleRef.createNestApplication();
  app.use(cookieParser());
  await app.init();

  return { app, prisma: app.get(PrismaService), dbPath };
}

/** Truncate all tables (order respects foreign keys via cascade). */
export async function clearDb(prisma: PrismaService): Promise<void> {
  await prisma.bookmark.deleteMany();
  await prisma.bookmarkTagSuggestion.deleteMany();
  await prisma.bookmarkTag.deleteMany();
  await prisma.tag.deleteMany();
  await prisma.folderToken.deleteMany();
  await prisma.emailVerificationToken.deleteMany();
  await prisma.mfaBackupCode.deleteMany();
  await prisma.mfaChallenge.deleteMany();
  await prisma.session.deleteMany();
  await prisma.folder.deleteMany();
  await prisma.user.deleteMany();
  await prisma.instanceSettings.deleteMany();
}

export async function teardownApp(ctx: TestCtx): Promise<void> {
  await ctx.app.close();
  if (existsSync(ctx.dbPath)) unlinkSync(ctx.dbPath);
  const avatarDir = `${ctx.dbPath.replace(/\.db$/i, "")}-avatars`;
  if (existsSync(avatarDir)) {
    const { rmSync } = await import("node:fs");
    rmSync(avatarDir, { recursive: true, force: true });
  }
}

/** Register a user via the API and return the mobile auth response (with tokens). */
export async function registerUser(
  app: INestApplication,
  email = "user@ordo.app",
  password = "password123",
  displayName?: string,
): Promise<{
  user: { id: string; displayName: string; email: string };
  tokens: { accessToken: string; refreshToken: string; expiresIn: number };
}> {
  const supertest = (await import("supertest")).default;
  let name = email.split("@")[0] ?? "user";
  if (displayName) name = displayName;
  if (!name) name = "user";
  const res = await supertest(app.getHttpServer())
    .post("/api/auth/register")
    .set("x-client-type", "mobile")
    .send({ displayName: name, email, password });
  return res.body;
}

/** Obtain a bearer-authenticated supertest agent. */
export async function authedAgent(app: INestApplication, email?: string, password?: string) {
  const supertest = (await import("supertest")).default;
  const auth = await registerUser(app, email, password);
  return supertest.agent(app.getHttpServer()).auth(auth.tokens.accessToken, { type: "bearer" });
}
