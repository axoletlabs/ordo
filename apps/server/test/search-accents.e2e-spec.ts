import request from "supertest";
import { randomUUID } from "node:crypto";
import { LibraryCryptoService } from "../src/crypto/library-crypto.service.js";
import { SessionService } from "../src/auth/session.service.js";
import { clearDb, createTestApp, registerUser, teardownApp, type TestCtx } from "./utils.js";

describe.each(["plaintext", "encrypted"] as const)("Accent-insensitive search (%s)", (mode) => {
  let ctx: TestCtx;
  let agent: ReturnType<typeof request.agent>;
  let userId: string;
  let dek: Buffer | null;
  let crypto: LibraryCryptoService;

  beforeAll(async () => {
    ctx = await createTestApp();
    crypto = ctx.app.get(LibraryCryptoService);
  });
  afterAll(async () => teardownApp(ctx));
  beforeEach(async () => {
    await clearDb(ctx.prisma);
    const auth = await registerUser(ctx.app, "accents@ordo.app");
    userId = auth.user.id;
    if (mode === "plaintext") {
      // Legacy accounts have neither encrypted fields nor session key wraps.
      await ctx.prisma.user.update({ where: { id: userId }, data: {
        dataEncryptionVersion: 0, dekKdfSalt: null, dekPasswordWrapped: null, dekServerWrapped: null,
      } });
      await ctx.prisma.session.updateMany({ where: { userId }, data: { dekWrapped: null, dekRefreshWrapped: null } });
    }
    const session = await ctx.app.get(SessionService).validateAccess(auth.tokens.accessToken);
    expect(session).not.toBeNull();
    dek = session!.dek;
    expect(crypto.active(dek)).toBe(mode === "encrypted");
    agent = request.agent(ctx.app.getHttpServer()).auth(auth.tokens.accessToken, { type: "bearer" });
  });

  async function seed(fields: { title?: string; description?: string; author?: string; domain?: string; url?: string; contentHtml?: string } = {}) {
    const id = randomUUID();
    return ctx.prisma.bookmark.create({ data: crypto.sealBookmark(userId, id, {
      id, userId, title: "Notes", url: `https://example.test/${id}`, domain: "example.test",
      ...fields,
    }, dek) });
  }

  it("finds accented titles with plain, accented and decomposed queries", async () => {
    const items = await Promise.all([
      seed({ title: "Café résumé" }), seed({ title: "Cafe\u0301 re\u0301sume\u0301" }), seed({ title: "Cafe resume" }),
    ]);
    await seed({ title: "Decafé" });
    for (const q of ["cafe resume", "CAFÉ RÉSUMÉ", "cafe\u0301 re\u0301sume\u0301"]) {
      const response = await agent.get("/api/bookmarks/search").query({ q }).expect(200);
      expect(new Set(response.body.items.map((item: { id: string }) => item.id))).toEqual(new Set(items.map((item) => item.id)));
    }
  });

  it("matches Latin accents in domain, URL, description, author and body", async () => {
    for (const fields of [
      { domain: "résumé.example" }, { url: "https://example.test/résumé" },
      { description: "Résumé writing" }, { author: "Résumé writer" }, { contentHtml: "<p>Résumé writing</p>" },
    ]) {
      const item = await seed(fields);
      const response = await agent.get("/api/bookmarks/search").query({ q: "resume" }).expect(200);
      expect(response.body.items.map((row: { id: string }) => row.id)).toContain(item.id);
    }
  });

  it("recalls accented tags and still omits active tag filters from text matching", async () => {
    const tagId = randomUUID();
    await ctx.prisma.tag.create({ data: {
      id: tagId, userId, color: "blue", ...crypto.sealTag(userId, tagId, { name: "Reading Café", normalizedName: "reading café" }, dek),
    } });
    const item = await seed();
    await ctx.prisma.bookmarkTag.create({ data: { bookmarkId: item.id, tagId } });
    for (const q of ["cafe", "CAFÉ", "cafe\u0301", "reading cafe"]) {
      const response = await agent.get("/api/bookmarks/search").query({ q }).expect(200);
      expect(response.body.items.map((row: { id: string }) => row.id)).toEqual([item.id]);
    }
    const filtered = await agent.get("/api/bookmarks/search").query({ q: "cafe", tagIds: tagId }).expect(200);
    expect(filtered.body.items).toEqual([]);
  });
});
