import { existsSync, unlinkSync } from "node:fs";
import { Test, type TestingModuleBuilder } from "@nestjs/testing";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { AppModule } from "../src/app.module.js";
import { APP_CONFIG } from "../src/config/config.module.js";
import type { AppConfig } from "../src/config/config.module.js";
import { loadConfig } from "../src/config/configuration.js";
import { applyHttp } from "../src/common/http.js";
import { PrismaService } from "../src/prisma/prisma.service.js";

export interface TestCtx {
  app: NestExpressApplication;
  prisma: PrismaService;
  dbPath: string;
}

/** Provisions a fresh temp SQLite DB; PrismaService applies migrations on boot. */
export async function createTestApp(
  options: {
    config?: Partial<AppConfig>;
    customize?: (builder: TestingModuleBuilder) => TestingModuleBuilder;
  } = {},
): Promise<TestCtx> {
  const dbPath = `/tmp/ordo-e2e-${process.pid}-${Date.now()}-${Math.random()
    .toString(36)
    .slice(2)}.db`;
  if (existsSync(dbPath)) unlinkSync(dbPath);

  const base = loadConfig();
  const cfg: AppConfig = {
    ...base,
    databaseUrl: `file:${dbPath}`,
    registrationEnabled: true,
    emailVerificationRequired: false,
    instanceRenameEnabled: true,
    instanceAdminEmail: null,
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

  const app = moduleRef.createNestApplication<NestExpressApplication>();
  applyHttp(app, cfg);
  await app.init();

  return { app, prisma: app.get(PrismaService), dbPath };
}

/** Truncate all tables (order respects foreign keys via cascade). */
export async function clearDb(prisma: PrismaService): Promise<void> {
  await prisma.appInstallDay.deleteMany();
  await prisma.appInstallSnapshot.deleteMany();
  await prisma.appInstall.deleteMany();
  await prisma.importJob.deleteMany();
  await prisma.bookmarkHighlight.deleteMany();
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
  app: NestExpressApplication,
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
export async function authedAgent(app: NestExpressApplication, email?: string, password?: string) {
  const supertest = (await import("supertest")).default;
  const auth = await registerUser(app, email, password);
  return supertest.agent(app.getHttpServer()).auth(auth.tokens.accessToken, { type: "bearer" });
}
