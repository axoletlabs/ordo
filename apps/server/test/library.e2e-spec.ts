import request from "supertest";
import { ErrorCode } from "@ordo/shared";
import { MailService } from "../src/auth/mail.service.js";
import { ReaderService } from "../src/bookmarks/reader.service.js";
import {
  clearDb,
  createTestApp,
  registerUser,
  teardownApp,
  type TestCtx,
} from "./utils.js";

function fakeReader() {
  return {
    extract: async () => ({
      title: "Sample Article",
      description: "A summary.",
      author: "Jane Doe",
      publishedAt: "2026-01-15T09:30:00.000Z",
      domain: "example.com",
      readingTimeMinutes: 4,
      contentHtml: "<p>Hello world.</p>",
      contentText: "Hello world.",
    }),
    prefetch: () => undefined,
    classifyShellText: () => null,
  } as unknown as ReaderService;
}

describe("Library encryption (e2e)", () => {
  let ctx: TestCtx;
  const sent: { to: string; token: string }[] = [];

  beforeAll(async () => {
    ctx = await createTestApp({
      customize: (b) =>
        b
          .overrideProvider(MailService)
          .useValue({
            isConfigured: true,
            sendVerification: async () => undefined,
            sendPasswordReset: async (to: string, token: string) => {
              sent.push({ to, token });
            },
            sendMfaRecovery: async () => undefined,
          })
          .overrideProvider(ReaderService)
          .useValue(fakeReader()),
    });
  });

  afterAll(async () => {
    await teardownApp(ctx);
  });

  beforeEach(async () => {
    await clearDb(ctx.prisma);
    sent.length = 0;
  });

  it("stores library fields as ciphertext and returns plaintext over the API", async () => {
    const auth = await registerUser(ctx.app, "vault@ordo.app");
    const agent = request.agent(ctx.app.getHttpServer()).auth(auth.tokens.accessToken, {
      type: "bearer",
    });

    const folder = await agent.post("/api/folders").send({ name: "Reading" }).expect(201);
    expect(folder.body.name).toBe("Reading");
    const storedFolder = await ctx.prisma.folder.findUniqueOrThrow({ where: { id: folder.body.id } });
    expect(storedFolder.name).toMatch(/^enc1\./);

    const tag = await agent.post("/api/tags").send({ name: "later" }).expect(201);
    expect(tag.body.name).toBe("later");
    const storedTag = await ctx.prisma.tag.findUniqueOrThrow({ where: { id: tag.body.id } });
    expect(storedTag.name).toMatch(/^enc1\./);
    expect(storedTag.normalizedName).toMatch(/^[0-9a-f]{64}$/);

    const created = await agent
      .post("/api/bookmarks")
      .send({ url: "https://example.com/secret-notes", folderId: folder.body.id, tagIds: [tag.body.id] })
      .expect(201);
    expect(created.body.url).toBe("https://example.com/secret-notes");
    expect(created.body.title.startsWith("enc1.")).toBe(false);

    const stored = await ctx.prisma.bookmark.findUniqueOrThrow({ where: { id: created.body.id } });
    expect(stored.url).toMatch(/^enc1\./);
    expect(stored.title).toMatch(/^enc1\./);
    expect(stored.domain).toMatch(/^enc1\./);

    const listed = await agent.get("/api/folders").expect(200);
    expect(listed.body[0].name).toBe("Reading");
    const tags = await agent.get("/api/tags").expect(200);
    expect(tags.body.map((row: { name: string }) => row.name)).toContain("later");

    const found = await agent.get("/api/bookmarks/search").query({ q: "secret" }).expect(200);
    expect(found.body.items.map((row: { id: string }) => row.id)).toContain(created.body.id);
  });

  it("hides locked-folder reminders and requires an unlock token to delete or relock", async () => {
    const auth = await registerUser(ctx.app, "lock@ordo.app");
    const agent = request.agent(ctx.app.getHttpServer()).auth(auth.tokens.accessToken, {
      type: "bearer",
    });
    const folder = await agent.post("/api/folders").send({ name: "Vault" }).expect(201);
    const created = await agent
      .post("/api/bookmarks")
      .send({ url: "https://example.com/hidden", folderId: folder.body.id })
      .expect(201);
    const remindAt = Math.floor(Date.now() / 1000) + 3600;
    const patched = await agent.patch(`/api/bookmarks/${created.body.id}`).send({ remindAt }).expect(200);

    await agent.post(`/api/folders/${folder.body.id}/password`).send({ password: "1234" }).expect(200);

    const hidden = await agent.get("/api/bookmarks/reminders").expect(200);
    expect(hidden.body).toEqual([]);

    const relock = await agent
      .post(`/api/folders/${folder.body.id}/password`)
      .send({ password: "5678", lockType: "pin" })
      .expect(403);
    expect(relock.body.error.code).toBe(ErrorCode.FOLDER_PROTECTED);

    const unlocked = await agent
      .post(`/api/folders/${folder.body.id}/unlock`)
      .send({ password: "1234" })
      .expect(200);
    const token = unlocked.body.token as string;

    const visible = await agent.get("/api/bookmarks/reminders").set("x-folder-token", token).expect(200);
    expect(visible.body).toEqual([
      expect.objectContaining({
        id: created.body.id,
        folderId: folder.body.id,
        title: patched.body.title,
        remindAt,
      }),
    ]);

    await agent
      .post(`/api/folders/${folder.body.id}/password`)
      .set("x-folder-token", token)
      .send({ password: "5678", lockType: "pin" })
      .expect(200);

    const again = await agent
      .post(`/api/folders/${folder.body.id}/unlock`)
      .send({ password: "5678" })
      .expect(200);
    await agent
      .delete(`/api/folders/${folder.body.id}`)
      .set("x-folder-token", again.body.token)
      .expect(200);
    expect((await agent.get("/api/folders").expect(200)).body).toHaveLength(0);
  });

  it("keeps the library readable after refresh, password change, and recovery-key reset", async () => {
    const auth = await registerUser(ctx.app, "keys@ordo.app");
    let agent = request.agent(ctx.app.getHttpServer()).auth(auth.tokens.accessToken, {
      type: "bearer",
    });
    const created = await agent
      .post("/api/bookmarks")
      .send({ url: "https://example.com/keep-me" })
      .expect(201);

    const refreshed = await request(ctx.app.getHttpServer())
      .post("/api/auth/refresh")
      .set("x-client-type", "mobile")
      .send({ refreshToken: auth.tokens.refreshToken })
      .expect(200);
    agent = request.agent(ctx.app.getHttpServer()).auth(refreshed.body.tokens.accessToken, {
      type: "bearer",
    });
    expect((await agent.get(`/api/bookmarks/${created.body.id}`).expect(200)).body.url).toBe(
      "https://example.com/keep-me",
    );

    const changed = await agent
      .post("/api/auth/password")
      .set("x-client-type", "mobile")
      .send({ currentPassword: "password123", newPassword: "brandnewpass" })
      .expect(200);
    agent = request.agent(ctx.app.getHttpServer()).auth(changed.body.tokens.accessToken, {
      type: "bearer",
    });
    expect((await agent.get(`/api/bookmarks/${created.body.id}`).expect(200)).body.url).toBe(
      "https://example.com/keep-me",
    );

    await request(ctx.app.getHttpServer())
      .post("/api/auth/forgot-password")
      .send({ email: "keys@ordo.app" })
      .expect(200);
    await request(ctx.app.getHttpServer())
      .post("/api/auth/reset-password")
      .send({
        email: "keys@ordo.app",
        token: sent.at(-1)!.token,
        newPassword: "afterresetpass",
        recoveryKey: auth.recoveryKey,
      })
      .expect(200);

    const loggedIn = await request(ctx.app.getHttpServer())
      .post("/api/auth/login")
      .set("x-client-type", "mobile")
      .send({ identifier: "keys@ordo.app", password: "afterresetpass" })
      .expect(200);
    agent = request.agent(ctx.app.getHttpServer()).auth(loggedIn.body.tokens.accessToken, {
      type: "bearer",
    });
    expect((await agent.get(`/api/bookmarks/${created.body.id}`).expect(200)).body.url).toBe(
      "https://example.com/keep-me",
    );
  });
});
