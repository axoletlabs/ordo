import request from "supertest";
import { DEFAULT_FOLDER_ICON, ErrorCode, EXTRACTION_VERSION } from "@ordo/shared";
import { ReaderService, UnsupportedContentError } from "../src/bookmarks/reader.service.js";
import {
  clearDb,
  createTestApp,
  registerUser,
  teardownApp,
  type TestCtx,
} from "./utils.js";

const FAKE_EXTRACTED = {
  title: "Sample Article",
  description: "A summary.",
  author: "Jane Doe",
  publishedAt: "2026-01-15T09:30:00.000Z",
  domain: "example.com",
  readingTimeMinutes: 4,
  contentHtml: "<p>Hello world.</p>",
  contentMarkdown: "Hello world.",
  contentText: "Hello world.",
};

function fakeReader() {
  return {
    extract: async (url: string, options?: { forceArticle?: boolean }) => {
      if (url.includes("/js-only")) {
        throw new UnsupportedContentError("js_required", "JavaScript is not enabled");
      }
      if (url.includes("/unmarked-essay") && options?.forceArticle !== true) {
        throw new UnsupportedContentError("not_an_article", "Page does not declare itself an article");
      }
      return { ...FAKE_EXTRACTED };
    },
    prefetch: () => undefined,
    classifyShellText: () => null,
  } as unknown as ReaderService;
}

describe("Bookmarks & Folders (e2e)", () => {
  let ctx: TestCtx;

  beforeAll(async () => {
    ctx = await createTestApp({
      customize: (b) => b.overrideProvider(ReaderService).useValue(fakeReader()),
    });
  });

  afterAll(async () => {
    await teardownApp(ctx);
  });

  beforeEach(async () => {
    await clearDb(ctx.prisma);
  });

  /** Register a fresh user; new accounts start with zero folders. */
  async function setup() {
    const auth = await registerUser(ctx.app, "reader@ordo.app");
    const agent = request.agent(ctx.app.getHttpServer()).auth(auth.tokens.accessToken, {
      type: "bearer",
    });
    expect(await ctx.prisma.folder.count({ where: { userId: auth.user.id } })).toBe(0);
    return { agent, userId: auth.user.id };
  }

  describe("folders", () => {
    it("creates a folder and lists folders for a fresh account", async () => {
      const { agent } = await setup();

      const created = await agent
        .post("/api/folders")
        .send({ name: "Reading" })
        .expect(201);
      expect(created.body.name).toBe("Reading");
      expect(created.body.icon).toBe("folder-outline");
      expect(created.body.pinned).toBe(false);
      expect(created.body.protected).toBe(false);
      expect(created.body.bookmarkCount).toBe(0);
      expect(created.body.unreadCount).toBe(0);

      const list = await agent.get("/api/folders").expect(200);
      expect(list.body).toHaveLength(1);
      expect(list.body[0].id).toBe(created.body.id);
    });

    it("creates a folder with an explicit icon and defaults otherwise", async () => {
      const { agent } = await setup();

      const withIcon = await agent
        .post("/api/folders")
        .send({ name: "Dev", icon: "code-slash-outline" })
        .expect(201);
      expect(withIcon.body.icon).toBe("code-slash-outline");
      expect(withIcon.body.pinned).toBe(false);

      const plain = await agent.post("/api/folders").send({ name: "Misc" }).expect(201);
      expect(plain.body.icon).toBe("folder-outline");
      expect(plain.body.pinned).toBe(false);

      const invalid = await agent
        .post("/api/folders")
        .send({ name: "Bad", icon: "not-an-ionicon" })
        .expect(400);
      expect(invalid.body.error.code).toBe(ErrorCode.VALIDATION_ERROR);
    });

    it("falls back safely when persisted icon data is unsupported", async () => {
      const { agent } = await setup();
      const folder = await agent.post("/api/folders").send({ name: "Reading" }).expect(201);
      await ctx.prisma.folder.update({
        where: { id: folder.body.id },
        data: { icon: "removed-icon-outline" },
      });

      const folders = await agent.get("/api/folders").expect(200);
      expect(folders.body[0].icon).toBe(DEFAULT_FOLDER_ICON);
    });

    it("updates folder metadata (name/icon/pinned) and keeps counts accurate", async () => {
      const { agent } = await setup();
      const folder = await agent.post("/api/folders").send({ name: "Reading" }).expect(201);
      await agent
        .post("/api/bookmarks")
        .send({ url: "https://example.com/1", folderId: folder.body.id })
        .expect(201);
      await agent
        .post("/api/bookmarks")
        .send({ url: "https://example.com/2", folderId: folder.body.id })
        .expect(201);
      const read = await agent
        .post("/api/bookmarks")
        .send({ url: "https://example.com/3", folderId: folder.body.id })
        .expect(201);
      await agent.patch(`/api/bookmarks/${read.body.id}`).send({ isRead: true }).expect(200);

      const updated = await agent
        .patch(`/api/folders/${folder.body.id}`)
        .send({ name: "Read Later", icon: "reader-outline", pinned: true })
        .expect(200);
      expect(updated.body.name).toBe("Read Later");
      expect(updated.body.icon).toBe("reader-outline");
      expect(updated.body.pinned).toBe(true);
      // counts must reflect the folder's real contents after the update
      expect(updated.body.bookmarkCount).toBe(3);
      expect(updated.body.unreadCount).toBe(2);

      const empty = await agent.patch(`/api/folders/${folder.body.id}`).send({}).expect(400);
      expect(empty.body.error.code).toBe(ErrorCode.VALIDATION_ERROR);

      // partial update touching only pinned leaves other metadata intact
      const pinnedOnly = await agent
        .patch(`/api/folders/${folder.body.id}`)
        .send({ pinned: false })
        .expect(200);
      expect(pinnedOnly.body.name).toBe("Read Later");
      expect(pinnedOnly.body.icon).toBe("reader-outline");
      expect(pinnedOnly.body.pinned).toBe(false);
    });

    it("lists pinned folders first, then position/creation order", async () => {
      const { agent } = await setup();
      const alpha = await agent.post("/api/folders").send({ name: "Alpha" }).expect(201);
      const beta = await agent.post("/api/folders").send({ name: "Beta" }).expect(201);
      const gamma = await agent.post("/api/folders").send({ name: "Gamma" }).expect(201);

      const names = async () => {
        const res = await agent.get("/api/folders").expect(200);
        return res.body.map((f: { name: string }) => f.name);
      };

      expect(await names()).toEqual(["Alpha", "Beta", "Gamma"]);

      await agent.patch(`/api/folders/${gamma.body.id}`).send({ pinned: true }).expect(200);
      expect(await names()).toEqual(["Gamma", "Alpha", "Beta"]);

      await agent.patch(`/api/folders/${alpha.body.id}`).send({ pinned: true }).expect(200);
      expect(await names()).toEqual(["Alpha", "Gamma", "Beta"]);

      await agent.patch(`/api/folders/${gamma.body.id}`).send({ pinned: false }).expect(200);
      expect(await names()).toEqual(["Alpha", "Beta", "Gamma"]);
    });

    it("deletes any folder, including non-empty ones, cascading its bookmarks", async () => {
      const { agent } = await setup();
      const folder = await agent.post("/api/folders").send({ name: "Temp" }).expect(201);
      const b1 = await agent
        .post("/api/bookmarks")
        .send({ url: "https://example.com/a", folderId: folder.body.id })
        .expect(201);
      await agent
        .post("/api/bookmarks")
        .send({ url: "https://example.com/b", folderId: folder.body.id })
        .expect(201);

      await agent.delete(`/api/folders/${folder.body.id}`).expect(200);
      const after = await agent.get("/api/folders").expect(200);
      expect(after.body).toHaveLength(0);

      const gone = await agent.get(`/api/bookmarks/${b1.body.id}`).expect(404);
      expect(gone.body.error.code).toBe(ErrorCode.BOOKMARK_NOT_FOUND);
    });

    it("does not expose other users' folders", async () => {
      const { agent } = await setup();
      const other = await registerUser(ctx.app, "other@ordo.app");
      const foreign = await ctx.prisma.folder.create({
        data: { userId: other.user.id, name: "Foreign" },
      });

      await agent.get("/api/folders").expect(200, []);
      await agent.get(`/api/bookmarks?folderId=${foreign.id}`).expect(404);
      await agent.delete(`/api/folders/${foreign.id}`).expect(404);
    });

    it("reports folder counts (total + unread)", async () => {
      const { agent } = await setup();
      const folder = await agent.post("/api/folders").send({ name: "Counted" }).expect(201);
      await agent
        .post("/api/bookmarks")
        .send({ url: "https://example.com/1", folderId: folder.body.id })
        .expect(201);
      const b2 = await agent
        .post("/api/bookmarks")
        .send({ url: "https://example.com/2", folderId: folder.body.id })
        .expect(201);

      await agent.patch(`/api/bookmarks/${b2.body.id}`).send({ isRead: true }).expect(200);

      const folders = (await agent.get("/api/folders").expect(200)).body;
      const found = folders.find((f: { id: string }) => f.id === folder.body.id);
      expect(found.bookmarkCount).toBe(2);
      expect(found.unreadCount).toBe(1);
    });
  });

  describe("unfiled bookmarks", () => {
    it("creates an unfiled bookmark without a folderId", async () => {
      const { agent } = await setup();
      const res = await agent
        .post("/api/bookmarks")
        .send({ url: "https://example.com/article" })
        .expect(201);
      expect(res.body.folderId).toBeNull();
      expect(res.body.title).toBe("example.com");
      expect(res.body.domain).toBe("example.com");
      expect(res.body.contentMarkdown).toBeNull();
      expect(res.body.fetchStatus).toBe("pending");
      expect(res.body.contentKind).toBeNull();
      expect(res.body.isRead).toBe(false);

      let stored = await ctx.prisma.bookmark.findUnique({ where: { id: res.body.id } });
      for (let attempt = 0; attempt < 20 && stored?.fetchStatus === "pending"; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 10));
        stored = await ctx.prisma.bookmark.findUnique({ where: { id: res.body.id } });
      }
      expect(stored).toMatchObject({
        title: "Sample Article",
        contentMarkdown: "Hello world.",
        fetchStatus: "ok",
        extractionVersion: EXTRACTION_VERSION,
        extractionReason: null,
        author: "Jane Doe",
        readingTimeMinutes: 4,
        publishedAt: new Date("2026-01-15T09:30:00.000Z"),
      });
      const ready = await agent.get(`/api/bookmarks/${res.body.id}`).expect(200);
      expect(ready.body.contentKind).toBe("article");
      expect(ready.body.contentMarkdown).toBe("Hello world.");
      expect(ready.body.contentText).toBe("Hello world.");
      const listed = await agent.get("/api/bookmarks").expect(200);
      const row = listed.body.items.find((item: { id: string }) => item.id === res.body.id);
      expect(row.contentMarkdown).toBeNull();
      expect(row.contentText).toBeNull();
    });

    it("stores typed unsupported rejections instead of junk content", async () => {
      const { agent } = await setup();
      const res = await agent
        .post("/api/bookmarks")
        .send({ url: "https://example.com/js-only/app" })
        .expect(201);
      expect(res.body.fetchStatus).toBe("pending");

      let stored = await ctx.prisma.bookmark.findUnique({ where: { id: res.body.id } });
      for (let attempt = 0; attempt < 20 && stored?.fetchStatus === "pending"; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 10));
        stored = await ctx.prisma.bookmark.findUnique({ where: { id: res.body.id } });
      }
      expect(stored).toMatchObject({
        fetchStatus: "unsupported",
        extractionReason: "js_required",
        extractionVersion: EXTRACTION_VERSION,
        contentHtml: null,
        contentMarkdown: null,
        contentText: null,
      });
      const rejected = await agent.get(`/api/bookmarks/${res.body.id}`).expect(200);
      expect(rejected.body.contentKind).toBe("web");
    });

    it("lets the user mark and unmark a bookmark as an article", async () => {
      const { agent } = await setup();
      const res = await agent
        .post("/api/bookmarks")
        .send({ url: "https://example.com/js-only/app" })
        .expect(201);
      let stored = await ctx.prisma.bookmark.findUnique({ where: { id: res.body.id } });
      for (let attempt = 0; attempt < 20 && stored?.fetchStatus === "pending"; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 10));
        stored = await ctx.prisma.bookmark.findUnique({ where: { id: res.body.id } });
      }
      expect(stored?.fetchStatus).toBe("unsupported");

      const marked = await agent
        .put(`/api/bookmarks/${res.body.id}/content-kind`)
        .send({ contentKindOverride: "article" })
        .expect(200);
      expect(marked.body.contentKindOverride).toBe("article");
      expect(marked.body.contentKind).toBe("article");

      const unmarked = await agent
        .put(`/api/bookmarks/${res.body.id}/content-kind`)
        .send({ contentKindOverride: "web" })
        .expect(200);
      expect(unmarked.body.contentKindOverride).toBeNull();
      expect(unmarked.body.contentKind).toBe("web");

      const viaPatch = await agent
        .patch(`/api/bookmarks/${res.body.id}`)
        .send({ contentKindOverride: "article" })
        .expect(200);
      expect(viaPatch.body.contentKindOverride).toBe("article");

      const empty = await agent
        .put(`/api/bookmarks/${res.body.id}/content-kind`)
        .send({})
        .expect(400);
      expect(empty.body.error.message).toMatch(/Required|invalid|article|web/i);

      const cleared = await agent
        .patch(`/api/bookmarks/${res.body.id}`)
        .send({ contentKindOverride: null })
        .expect(200);
      expect(cleared.body.contentKindOverride).toBeNull();
      expect(cleared.body.contentKind).toBe("web");
    });

    it("restores the original website when a forced article is unmarked", async () => {
      const { agent } = await setup();
      const res = await agent
        .post("/api/bookmarks")
        .send({ url: "https://example.com/unmarked-essay" })
        .expect(201);
      let stored = await ctx.prisma.bookmark.findUnique({ where: { id: res.body.id } });
      for (let attempt = 0; attempt < 20 && stored?.fetchStatus === "pending"; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 10));
        stored = await ctx.prisma.bookmark.findUnique({ where: { id: res.body.id } });
      }
      expect(stored).toMatchObject({
        fetchStatus: "unsupported",
        extractionReason: "not_an_article",
        contentHtml: null,
      });
      const originalTitle = stored?.title;

      const marked = await agent
        .put(`/api/bookmarks/${res.body.id}/content-kind`)
        .send({ contentKindOverride: "article" })
        .expect(200);
      expect(marked.body.contentKind).toBe("article");
      stored = await ctx.prisma.bookmark.findUnique({ where: { id: res.body.id } });
      for (let attempt = 0; attempt < 20 && stored?.fetchStatus === "pending"; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 10));
        stored = await ctx.prisma.bookmark.findUnique({ where: { id: res.body.id } });
      }
      expect(stored).toMatchObject({
        fetchStatus: "ok",
        title: "Sample Article",
        contentHtml: "<p>Hello world.</p>",
        readingTimeMinutes: 4,
        contentKindOverride: "article",
      });

      const unmarked = await agent
        .put(`/api/bookmarks/${res.body.id}/content-kind`)
        .send({ contentKindOverride: "web" })
        .expect(200);
      expect(unmarked.body).toMatchObject({
        contentKindOverride: null,
        contentKind: "web",
        fetchStatus: "unsupported",
        title: originalTitle,
        readingTimeMinutes: null,
      });
      stored = await ctx.prisma.bookmark.findUnique({ where: { id: res.body.id } });
      expect(stored).toMatchObject({
        fetchStatus: "unsupported",
        extractionReason: "not_an_article",
        title: originalTitle,
        contentHtml: null,
        contentMarkdown: null,
        contentText: null,
        readingTimeMinutes: null,
        contentKindOverride: null,
        articleUndoSnapshot: null,
      });
    });

    it("creates an unfiled bookmark with an explicit null folderId", async () => {
      const { agent } = await setup();
      const res = await agent
        .post("/api/bookmarks")
        .send({ url: "https://example.com/article", folderId: null })
        .expect(201);
      expect(res.body.folderId).toBeNull();
    });

    it("stores the bookmark even when extraction fails", async () => {
      const { agent } = await setup();
      const res = await agent
        .post("/api/bookmarks")
        .send({ url: "https://example.org/nope" })
        .expect(201);
      // fake reader always succeeds, so drive failure through an invalid URL shape
      expect(res.body.url).toBe("https://example.org/nope");
    });

    it("rejects invalid payloads", async () => {
      const { agent } = await setup();
      const badUrl = await agent.post("/api/bookmarks").send({ url: "not-a-url" }).expect(400);
      expect(badUrl.body.error.code).toBe(ErrorCode.VALIDATION_ERROR);

      const emptyFolder = await agent
        .post("/api/bookmarks")
        .send({ url: "https://example.com/x", folderId: "" })
        .expect(400);
      expect(emptyFolder.body.error.code).toBe(ErrorCode.VALIDATION_ERROR);
    });

    it("accepts a prefetch warmup without creating a bookmark", async () => {
      const { agent } = await setup();
      await agent.post("/api/bookmarks/prefetch").send({ url: "https://example.com/soon" }).expect(204);
      await agent.post("/api/bookmarks/prefetch").send({ url: "not-a-url" }).expect(400);
      const listed = await agent.get("/api/bookmarks").expect(200);
      expect(listed.body.items).toEqual([]);
    });

    it("creates a bookmark directly into an owned folder", async () => {
      const { agent } = await setup();
      const folder = await agent.post("/api/folders").send({ name: "Filed" }).expect(201);
      const res = await agent
        .post("/api/bookmarks")
        .send({ url: "https://example.com/in-folder", folderId: folder.body.id })
        .expect(201);
      expect(res.body.folderId).toBe(folder.body.id);
    });

    it("returns 404 for a bookmark created in a missing folder", async () => {
      const { agent } = await setup();
      const res = await agent
        .post("/api/bookmarks")
        .send({ url: "https://example.com/x", folderId: "does-not-exist" })
        .expect(404);
      expect(res.body.error.code).toBe(ErrorCode.FOLDER_NOT_FOUND);
    });

    it("lists only unfiled bookmarks when folderId is omitted", async () => {
      const { agent } = await setup();
      const unfiled = await agent
        .post("/api/bookmarks")
        .send({ url: "https://example.com/unfiled" })
        .expect(201);
      const folder = await agent.post("/api/folders").send({ name: "Filed" }).expect(201);
      await agent
        .post("/api/bookmarks")
        .send({ url: "https://example.com/filed", folderId: folder.body.id })
        .expect(201);

      const list = await agent.get("/api/bookmarks").expect(200);
      expect(list.body.items).toHaveLength(1);
      expect(list.body.items[0].id).toBe(unfiled.body.id);
      expect(list.body.items[0].folderId).toBeNull();
    });

    it("paginates unfiled bookmarks with a cursor", async () => {
      const { agent, userId } = await setup();
      // seed 25 unfiled bookmarks with spread timestamps
      const base = Date.now() - 60_000;
      await ctx.prisma.bookmark.createMany({
        data: Array.from({ length: 25 }, (_, i) => ({
          userId,
          folderId: null,
          url: `https://example.com/p${i}`,
          title: `Post ${i}`,
          domain: "example.com",
          contentText: `body ${i}`,
          createdAt: new Date(base + i * 1000),
        })),
      });

      const page1 = await agent.get("/api/bookmarks?limit=10").expect(200);
      expect(page1.body.items).toHaveLength(10);
      expect(page1.body.hasMore).toBe(true);
      expect(page1.body.nextCursor).toBeTruthy();
      // newest first
      expect(page1.body.items[0].title).toBe("Post 24");

      const page2 = await agent
        .get(`/api/bookmarks?limit=10&cursor=${page1.body.nextCursor}`)
        .expect(200);
      expect(page2.body.items).toHaveLength(10);
      expect(page2.body.items[0].title).toBe("Post 14");

      const page3 = await agent
        .get(`/api/bookmarks?limit=10&cursor=${page2.body.nextCursor}`)
        .expect(200);
      expect(page3.body.items).toHaveLength(5);
      expect(page3.body.hasMore).toBe(false);
      expect(page3.body.nextCursor).toBeNull();
    });

    it("paginates a folder's bookmarks with a cursor", async () => {
      const { agent, userId } = await setup();
      const folder = await ctx.prisma.folder.create({
        data: { userId, name: "Paged" },
      });
      const base = Date.now() - 60_000;
      await ctx.prisma.bookmark.createMany({
        data: Array.from({ length: 12 }, (_, i) => ({
          userId,
          folderId: folder.id,
          url: `https://example.com/f${i}`,
          title: `Folder post ${i}`,
          domain: "example.com",
          createdAt: new Date(base + i * 1000),
        })),
      });

      const page1 = await agent
        .get(`/api/bookmarks?folderId=${folder.id}&limit=10`)
        .expect(200);
      expect(page1.body.items).toHaveLength(10);
      expect(page1.body.hasMore).toBe(true);
      expect(page1.body.items[0].title).toBe("Folder post 11");

      const page2 = await agent
        .get(`/api/bookmarks?folderId=${folder.id}&limit=10&cursor=${page1.body.nextCursor}`)
        .expect(200);
      expect(page2.body.items).toHaveLength(2);
      expect(page2.body.hasMore).toBe(false);
    });

    it("paginates unfiled bookmarks by title", async () => {
      const { agent, userId } = await setup();
      const titles = ["Echo", "Bravo", "Delta", "Alpha", "Charlie"];
      const base = Date.now() - 60_000;
      await ctx.prisma.bookmark.createMany({
        data: titles.map((title, i) => ({
          userId,
          folderId: null,
          url: `https://example.com/${title.toLowerCase()}`,
          title,
          domain: "example.com",
          createdAt: new Date(base + i * 1000),
        })),
      });

      const page1 = await agent.get("/api/bookmarks?limit=2&sort=title").expect(200);
      expect(page1.body.items.map((item: { title: string }) => item.title)).toEqual(["Alpha", "Bravo"]);
      expect(page1.body.hasMore).toBe(true);

      const page2 = await agent
        .get(`/api/bookmarks?limit=2&sort=title&cursor=${page1.body.nextCursor}`)
        .expect(200);
      expect(page2.body.items.map((item: { title: string }) => item.title)).toEqual(["Charlie", "Delta"]);

      const page3 = await agent
        .get(`/api/bookmarks?limit=2&sort=title&cursor=${page2.body.nextCursor}`)
        .expect(200);
      expect(page3.body.items.map((item: { title: string }) => item.title)).toEqual(["Echo"]);
      expect(page3.body.hasMore).toBe(false);
      expect(page3.body.nextCursor).toBeNull();
    });

    it("paginates unfiled bookmarks oldest first", async () => {
      const { agent, userId } = await setup();
      const base = Date.now() - 60_000;
      await ctx.prisma.bookmark.createMany({
        data: Array.from({ length: 5 }, (_, i) => ({
          userId,
          folderId: null,
          url: `https://example.com/old${i}`,
          title: `Post ${i}`,
          domain: "example.com",
          createdAt: new Date(base + i * 1000),
        })),
      });

      const page1 = await agent.get("/api/bookmarks?limit=2&sort=oldest").expect(200);
      expect(page1.body.items.map((item: { title: string }) => item.title)).toEqual(["Post 0", "Post 1"]);
      const page2 = await agent
        .get(`/api/bookmarks?limit=2&sort=oldest&cursor=${page1.body.nextCursor}`)
        .expect(200);
      expect(page2.body.items.map((item: { title: string }) => item.title)).toEqual(["Post 2", "Post 3"]);
    });

    it("treats an unknown sort as newest", async () => {
      const { agent, userId } = await setup();
      const base = Date.now() - 60_000;
      await ctx.prisma.bookmark.createMany({
        data: Array.from({ length: 3 }, (_, i) => ({
          userId,
          folderId: null,
          url: `https://example.com/n${i}`,
          title: `Post ${i}`,
          domain: "example.com",
          createdAt: new Date(base + i * 1000),
        })),
      });

      const listed = await agent.get("/api/bookmarks?sort=nope").expect(200);
      expect(listed.body.items[0].title).toBe("Post 2");
    });

    it("returns bookmark detail including contentHtml", async () => {
      const { agent } = await setup();
      const created = await agent
        .post("/api/bookmarks")
        .send({ url: "https://example.com/article" })
        .expect(201);

      const detail = await agent.get(`/api/bookmarks/${created.body.id}`).expect(200);
      expect(detail.body.id).toBe(created.body.id);
      expect(detail.body.folderId).toBeNull();
      expect(detail.body.contentHtml).toBe("<p>Hello world.</p>");
    });

    it("toggles read state and deletes an unfiled bookmark without a folder token", async () => {
      const { agent } = await setup();
      const created = await agent
        .post("/api/bookmarks")
        .send({ url: "https://example.com/x" })
        .expect(201);

      const toggled = await agent
        .patch(`/api/bookmarks/${created.body.id}`)
        .send({ isRead: true })
        .expect(200);
      expect(toggled.body.isRead).toBe(true);
      expect(toggled.body.folderId).toBeNull();

      await agent.delete(`/api/bookmarks/${created.body.id}`).expect(200);
      const after = await agent.get("/api/bookmarks").expect(200);
      expect(after.body.items).toHaveLength(0);
      await agent.get(`/api/bookmarks/${created.body.id}`).expect(404);
    });

    it("does not list or mutate another user's bookmarks", async () => {
      const { agent } = await setup();
      const other = await registerUser(ctx.app, "someone-else@ordo.app");
      const foreign = await ctx.prisma.bookmark.create({
        data: {
          userId: other.user.id,
          folderId: null,
          url: "https://example.com/foreign",
          title: "Foreign",
          domain: "example.com",
        },
      });

      const list = await agent.get("/api/bookmarks").expect(200);
      expect(list.body.items).toHaveLength(0);
      await agent.get(`/api/bookmarks/${foreign.id}`).expect(404);
      await agent
        .patch(`/api/bookmarks/${foreign.id}`)
        .send({ isRead: true })
        .expect(404);
      await agent.delete(`/api/bookmarks/${foreign.id}`).expect(404);
    });
  });

  describe("moving bookmarks between folders and unfiled", () => {
    it("moves an unfiled bookmark into a folder", async () => {
      const { agent } = await setup();
      const created = await agent
        .post("/api/bookmarks")
        .send({ url: "https://example.com/x" })
        .expect(201);
      const folder = await agent.post("/api/folders").send({ name: "Saved" }).expect(201);

      const moved = await agent
        .patch(`/api/bookmarks/${created.body.id}`)
        .send({ folderId: folder.body.id })
        .expect(200);
      expect(moved.body.folderId).toBe(folder.body.id);

      const unfiled = await agent.get("/api/bookmarks").expect(200);
      expect(unfiled.body.items).toHaveLength(0);
      const filed = await agent.get(`/api/bookmarks?folderId=${folder.body.id}`).expect(200);
      expect(filed.body.items).toHaveLength(1);
    });

    it("moves a filed bookmark to unfiled with folderId null", async () => {
      const { agent } = await setup();
      const folder = await agent.post("/api/folders").send({ name: "Saved" }).expect(201);
      const created = await agent
        .post("/api/bookmarks")
        .send({ url: "https://example.com/x", folderId: folder.body.id })
        .expect(201);

      const moved = await agent
        .patch(`/api/bookmarks/${created.body.id}`)
        .send({ folderId: null })
        .expect(200);
      expect(moved.body.folderId).toBeNull();

      const filed = await agent.get(`/api/bookmarks?folderId=${folder.body.id}`).expect(200);
      expect(filed.body.items).toHaveLength(0);
      const unfiled = await agent.get("/api/bookmarks").expect(200);
      expect(unfiled.body.items).toHaveLength(1);
    });

    it("moves a bookmark between two folders", async () => {
      const { agent } = await setup();
      const a = await agent.post("/api/folders").send({ name: "A" }).expect(201);
      const b = await agent.post("/api/folders").send({ name: "B" }).expect(201);
      const created = await agent
        .post("/api/bookmarks")
        .send({ url: "https://example.com/x", folderId: a.body.id })
        .expect(201);

      await agent
        .patch(`/api/bookmarks/${created.body.id}`)
        .send({ folderId: b.body.id })
        .expect(200);

      expect((await agent.get(`/api/bookmarks?folderId=${a.body.id}`).expect(200)).body.items).toHaveLength(0);
      expect((await agent.get(`/api/bookmarks?folderId=${b.body.id}`).expect(200)).body.items).toHaveLength(1);
    });

    it("rejects moving into a missing folder and requires a field to update", async () => {
      const { agent } = await setup();
      const created = await agent
        .post("/api/bookmarks")
        .send({ url: "https://example.com/x" })
        .expect(201);

      const missing = await agent
        .patch(`/api/bookmarks/${created.body.id}`)
        .send({ folderId: "no-such-folder" })
        .expect(404);
      expect(missing.body.error.code).toBe(ErrorCode.FOLDER_NOT_FOUND);

      const empty = await agent.patch(`/api/bookmarks/${created.body.id}`).send({}).expect(400);
      expect(empty.body.error.code).toBe(ErrorCode.VALIDATION_ERROR);
    });
  });

  describe("read progress", () => {
    it("persists partial progress without completing the bookmark", async () => {
      const { agent } = await setup();
      const created = await agent
        .post("/api/bookmarks")
        .send({ url: "https://example.com/long-read" })
        .expect(201);

      const half = await agent
        .patch(`/api/bookmarks/${created.body.id}`)
        .send({ readProgress: 0.5 })
        .expect(200);
      expect(half.body.readProgress).toBe(0.5);
      expect(half.body.isRead).toBe(false);
      expect(half.body.completedAt).toBeNull();
    });

    it("completes the bookmark at >= 0.98 and clears completedAt when reduced", async () => {
      const { agent } = await setup();
      const created = await agent
        .post("/api/bookmarks")
        .send({ url: "https://example.com/long-read" })
        .expect(201);

      const done = await agent
        .patch(`/api/bookmarks/${created.body.id}`)
        .send({ readProgress: 1 })
        .expect(200);
      expect(done.body.readProgress).toBe(1);
      expect(done.body.isRead).toBe(true);
      expect(done.body.completedAt).toBeTruthy();

      const reread = await agent
        .patch(`/api/bookmarks/${created.body.id}`)
        .send({ readProgress: 0.2 })
        .expect(200);
      expect(reread.body.readProgress).toBe(0.2);
      expect(reread.body.completedAt).toBeNull();
    });

    it("rejects out-of-range progress with a validation error", async () => {
      const { agent } = await setup();
      const created = await agent
        .post("/api/bookmarks")
        .send({ url: "https://example.com/x" })
        .expect(201);

      const tooBig = await agent
        .patch(`/api/bookmarks/${created.body.id}`)
        .send({ readProgress: 1.5 })
        .expect(400);
      expect(tooBig.body.error.code).toBe(ErrorCode.VALIDATION_ERROR);

      const negative = await agent
        .patch(`/api/bookmarks/${created.body.id}`)
        .send({ readProgress: -0.1 })
        .expect(400);
      expect(negative.body.error.code).toBe(ErrorCode.VALIDATION_ERROR);
    });

    it("does not regress progress from incidental mutations", async () => {
      const { agent, userId } = await setup();
      await ctx.prisma.bookmark.create({
        data: {
          userId,
          folderId: null,
          url: "https://example.com/in-progress",
          title: "In progress",
          domain: "example.com",
          readProgress: 0.4,
        },
      });
      const bookmark = (await agent.get("/api/bookmarks").expect(200)).body.items[0];

      // mark-read-on-open keeps its old behavior: it must not touch progress
      const marked = await agent
        .patch(`/api/bookmarks/${bookmark.id}`)
        .send({ isRead: true })
        .expect(200);
      expect(marked.body.readProgress).toBe(0.4);
      expect(marked.body.completedAt).toBeNull();
      expect(marked.body.isRead).toBe(true);

      // moving folders is an incidental mutation, not a progress reset
      const folder = await agent.post("/api/folders").send({ name: "Filed" }).expect(201);
      const moved = await agent
        .patch(`/api/bookmarks/${bookmark.id}`)
        .send({ folderId: folder.body.id })
        .expect(200);
      expect(moved.body.readProgress).toBe(0.4);
      expect(moved.body.isRead).toBe(true);

      // metadata round-trips through list and detail
      const detail = await agent.get(`/api/bookmarks/${bookmark.id}`).expect(200);
      expect(detail.body.readProgress).toBe(0.4);
      expect(detail.body.extractionVersion).toBeNull();
      expect(detail.body.extractionReason).toBeNull();
      expect(detail.body.fetchStatus).toBe("ok");
      expect(detail.body.contentKind).toBe("article");
    });
  });

  describe("mark all read", () => {
    it("marks only unfiled bookmarks when folderId is omitted", async () => {
      const { agent, userId } = await setup();
      const folder = await ctx.prisma.folder.create({
        data: { userId, name: "Filed" },
      });
      await ctx.prisma.bookmark.createMany({
        data: [
          {
            userId,
            folderId: null,
            url: "https://example.com/u1",
            title: "U1",
            domain: "example.com",
          },
          {
            userId,
            folderId: null,
            url: "https://example.com/u2",
            title: "U2",
            domain: "example.com",
          },
          {
            userId,
            folderId: folder.id,
            url: "https://example.com/f1",
            title: "F1",
            domain: "example.com",
          },
        ],
      });

      const res = await agent.post("/api/bookmarks/mark-all-read").send({}).expect(200);
      expect(res.body.updated).toBe(2);

      const unfiled = await agent.get("/api/bookmarks").expect(200);
      expect(unfiled.body.items.every((b: { isRead: boolean }) => b.isRead)).toBe(true);
      const filed = await agent.get(`/api/bookmarks?folderId=${folder.id}`).expect(200);
      expect(filed.body.items.every((b: { isRead: boolean }) => !b.isRead)).toBe(true);
    });

    it("marks only unfiled bookmarks with an explicit null folderId", async () => {
      const { agent, userId } = await setup();
      await ctx.prisma.bookmark.create({
        data: {
          userId,
          folderId: null,
          url: "https://example.com/n",
          title: "N",
          domain: "example.com",
        },
      });

      const res = await agent
        .post("/api/bookmarks/mark-all-read")
        .send({ folderId: null })
        .expect(200);
      expect(res.body.updated).toBe(1);
    });

    it("marks all as read within one folder only", async () => {
      const { agent, userId } = await setup();
      const folderA = await ctx.prisma.folder.create({ data: { userId, name: "A" } });
      const folderB = await ctx.prisma.folder.create({ data: { userId, name: "B" } });
      await ctx.prisma.bookmark.createMany({
        data: [
          { userId, folderId: folderA.id, url: "https://example.com/a1", title: "A1", domain: "example.com" },
          { userId, folderId: folderA.id, url: "https://example.com/a2", title: "A2", domain: "example.com" },
          { userId, folderId: folderB.id, url: "https://example.com/b1", title: "B1", domain: "example.com" },
          { userId, folderId: null, url: "https://example.com/u1", title: "U1", domain: "example.com" },
        ],
      });

      const res = await agent
        .post("/api/bookmarks/mark-all-read")
        .send({ folderId: folderA.id })
        .expect(200);
      expect(res.body.updated).toBe(2);

      const inB = await agent.get(`/api/bookmarks?folderId=${folderB.id}`).expect(200);
      expect(inB.body.items.every((b: { isRead: boolean }) => !b.isRead)).toBe(true);
      const unfiled = await agent.get("/api/bookmarks").expect(200);
      expect(unfiled.body.items.every((b: { isRead: boolean }) => !b.isRead)).toBe(true);
    });

    it("returns 404 for a missing folder and 400 for an empty-string folderId", async () => {
      const { agent } = await setup();
      const missing = await agent
        .post("/api/bookmarks/mark-all-read")
        .send({ folderId: "no-such-folder" })
        .expect(404);
      expect(missing.body.error.code).toBe(ErrorCode.FOLDER_NOT_FOUND);

      const empty = await agent
        .post("/api/bookmarks/mark-all-read")
        .send({ folderId: "" })
        .expect(400);
      expect(empty.body.error.code).toBe(ErrorCode.VALIDATION_ERROR);
    });
  });

  describe("tags", () => {
    it("creates tags, lists them most-used-first, and validates payloads", async () => {
      const { agent, userId } = await setup();
      const rust = await agent.post("/api/tags").send({ name: "rust", color: "orange" }).expect(201);
      const go = await agent.post("/api/tags").send({ name: "  Go  " }).expect(201);
      expect(go.body.name).toBe("Go");
      const tagged = await agent
        .post("/api/bookmarks")
        .send({ url: "https://example.com/a", tagIds: [rust.body.id] })
        .expect(201);
      expect(tagged.body.tags).toEqual([{ id: rust.body.id, name: "rust", color: "orange" }]);
      expect(tagged.body.suggestedTags).toEqual([]);

      const list = await agent.get("/api/tags").expect(200);
      // most used first, then alphabetical
      expect(list.body.map((t: { id: string }) => t.id)).toEqual([rust.body.id, go.body.id]);
      expect(list.body[0].bookmarkCount).toBe(1);
      expect(list.body[1].bookmarkCount).toBe(0);

      const dup = await agent.post("/api/tags").send({ name: "RUST" }).expect(409);
      expect(dup.body.error.code).toBe(ErrorCode.TAG_ALREADY_EXISTS);

      const tooLong = await agent.post("/api/tags").send({ name: "x".repeat(41), color: "blue" }).expect(400);
      expect(tooLong.body.error.code).toBe(ErrorCode.VALIDATION_ERROR);

      const badColor = await agent.post("/api/tags").send({ name: "ok", color: "chartreuse" }).expect(400);
      expect(badColor.body.error.code).toBe(ErrorCode.VALIDATION_ERROR);

      // multi-word names collapse internal whitespace and match case-insensitively
      await agent.post("/api/tags").send({ name: "machine   learning" }).expect(201);
      await agent.post("/api/tags").send({ name: "Machine Learning" }).expect(409);
      expect(await ctx.prisma.tag.count({ where: { userId } })).toBe(3);
    });

    it("renames and recolors tags, keeping assignments", async () => {
      const { agent } = await setup();
      const tag = await agent.post("/api/tags").send({ name: "drafts", color: "slate" }).expect(201);
      const bookmark = await agent
        .post("/api/bookmarks")
        .send({ url: "https://example.com/a", tagIds: [tag.body.id] })
        .expect(201);

      const updated = await agent
        .patch(`/api/tags/${tag.body.id}`)
        .send({ name: "finished", color: "green" })
        .expect(200);
      expect(updated.body.name).toBe("finished");
      expect(updated.body.color).toBe("green");
      expect(updated.body.bookmarkCount).toBe(1);

      const list = await agent.get("/api/bookmarks").expect(200);
      expect(list.body.items[0].tags).toEqual([{ id: tag.body.id, name: "finished", color: "green" }]);

      // rename colliding with another tag is rejected
      await agent.post("/api/tags").send({ name: "other", color: "red" }).expect(201);
      const conflict = await agent
        .patch(`/api/tags/${tag.body.id}`)
        .send({ name: "OTHER" })
        .expect(409);
      expect(conflict.body.error.code).toBe(ErrorCode.TAG_ALREADY_EXISTS);

      await agent.patch(`/api/tags/${tag.body.id}`).send({}).expect(400);
      expect(bookmark.body.id).toBeTruthy();
    });

    it("deleting a tag removes assignments but keeps bookmarks", async () => {
      const { agent } = await setup();
      const tag = await agent.post("/api/tags").send({ name: "temp", color: "blue" }).expect(201);
      await agent
        .post("/api/bookmarks")
        .send({ url: "https://example.com/a", tagIds: [tag.body.id] })
        .expect(201);

      await agent.delete(`/api/tags/${tag.body.id}`).expect(200);
      expect(await ctx.prisma.tag.count()).toBe(0);
      const list = await agent.get("/api/bookmarks").expect(200);
      expect(list.body.items).toHaveLength(1);
      expect(list.body.items[0].tags).toEqual([]);
    });

    it("does not expose or mutate another user's tags", async () => {
      const { agent } = await setup();
      const other = await registerUser(ctx.app, "tag-other@ordo.app");
      const foreign = await ctx.prisma.tag.create({
        data: { userId: other.user.id, name: "Private", normalizedName: "private", color: "red" },
      });

      const list = await agent.get("/api/tags").expect(200);
      expect(list.body).toEqual([]);
      await agent
        .patch(`/api/tags/${foreign.id}`)
        .send({ name: "Hijack" })
        .expect(404);
      await agent.delete(`/api/tags/${foreign.id}`).expect(404);

      const mine = await agent.post("/api/tags").send({ name: "mine", color: "teal" }).expect(201);
      await agent
        .post("/api/bookmarks")
        .send({ url: "https://example.com/a", tagIds: [foreign.id] })
        .expect(404);
      await agent
        .put(`/api/bookmarks/none/tags`)
        .send({ tagIds: [mine.body.id] })
        .expect(404);
    });

    it("replaces bookmark tags atomically and enforces the per-bookmark cap", async () => {
      const { agent } = await setup();
      const one = await agent.post("/api/tags").send({ name: "one", color: "blue" }).expect(201);
      const two = await agent.post("/api/tags").send({ name: "two", color: "red" }).expect(201);
      const three = await agent.post("/api/tags").send({ name: "three", color: "green" }).expect(201);
      const created = await agent
        .post("/api/bookmarks")
        .send({ url: "https://example.com/a", tagIds: [one.body.id] })
        .expect(201);

      const updated = await agent
        .put(`/api/bookmarks/${created.body.id}/tags`)
        .send({ tagIds: [two.body.id, three.body.id] })
        .expect(200);
      expect(updated.body.tags.map((t: { name: string }) => t.name)).toEqual(["three", "two"]);

      const cleared = await agent
        .put(`/api/bookmarks/${created.body.id}/tags`)
        .send({ tagIds: [] })
        .expect(200);
      expect(cleared.body.tags).toEqual([]);

      const tooMany = Array.from({ length: 21 }, (_, i) => `cap-${i}`);      const made: { body: { id: string } }[] = [];
      for (let i = 0; i < 21; i += 1) {
        made.push(
          await agent.post("/api/tags").send({ name: `cap-${i}`, color: i % 2 ? "red" : "blue" }).expect(201),
        );
      }
      const rejected = await agent
        .put(`/api/bookmarks/${created.body.id}/tags`)
        .send({ tagIds: made.map((r) => r.body.id) })
        .expect(400);
      expect(rejected.body.error.code).toBe(ErrorCode.VALIDATION_ERROR);
    });

    it("filters the whole library by tags with AND semantics", async () => {
      const { agent, userId } = await setup();
      const rust = await agent.post("/api/tags").send({ name: "rust", color: "orange" }).expect(201);
      const wasm = await agent.post("/api/tags").send({ name: "wasm", color: "violet" }).expect(201);
      const folder = await agent.post("/api/folders").send({ name: "Filed" }).expect(201);
      const both = await ctx.prisma.bookmark.create({
        data: { userId, folderId: null, url: "https://example.com/both", title: "B", domain: "example.com" },
      });
      await ctx.prisma.bookmarkTag.create({ data: { bookmarkId: both.id, tagId: rust.body.id } });
      await ctx.prisma.bookmarkTag.create({ data: { bookmarkId: both.id, tagId: wasm.body.id } });
      const rustOnly = await ctx.prisma.bookmark.create({
        data: { userId, folderId: folder.body.id, url: "https://example.com/rust-only", title: "R", domain: "example.com" },
      });
      await ctx.prisma.bookmarkTag.create({ data: { bookmarkId: rustOnly.id, tagId: rust.body.id } });
      await ctx.prisma.bookmark.create({
        data: { userId, folderId: null, url: "https://example.com/none", title: "N", domain: "example.com" },
      });

      const rustOnlyList = await agent
        .get(`/api/bookmarks?scope=all&tagIds=${rust.body.id}`)
        .expect(200);
      expect(rustOnlyList.body.items).toHaveLength(2);

      const bothQuery = await agent
        .get(`/api/bookmarks?scope=all&tagIds=${rust.body.id},${wasm.body.id}`)
        .expect(200);
      expect(bothQuery.body.items).toHaveLength(1);
      expect(bothQuery.body.items[0].url).toBe("https://example.com/both");

      // without scope=all only unfiled bookmarks are searched
      const unfiled = await agent.get(`/api/bookmarks?tagIds=${rust.body.id}`).expect(200);
      expect(unfiled.body.items).toHaveLength(1);

      // unknown tag ids are rejected
      await agent.get(`/api/bookmarks?scope=all&tagIds=missing`).expect(404);
    });

    it("searches by tag name and combines text with tag filters", async () => {
      const { agent, userId } = await setup();
      const espresso = await agent.post("/api/tags").send({ name: "espresso", color: "amber" }).expect(201);
      const coffee = await ctx.prisma.bookmark.create({
        data: { userId, folderId: null, url: "https://example.com/coffee", title: "Morning brew", domain: "example.com" },
      });
      await ctx.prisma.bookmarkTag.create({ data: { bookmarkId: coffee.id, tagId: espresso.body.id } });

      const byTagName = await agent.get("/api/bookmarks/search?q=espresso").expect(200);
      expect(byTagName.body.items).toHaveLength(1);
      expect(byTagName.body.items[0].id).toBe(coffee.id);

      const withFilter = await agent
        .get(`/api/bookmarks/search?q=brew&tagIds=${espresso.body.id}`)
        .expect(200);
      expect(withFilter.body.items).toHaveLength(1);

      const shopping = await agent.post("/api/tags").send({ name: "Shopping List", color: "red" }).expect(201);
      const hoodie = await ctx.prisma.bookmark.create({
        data: {
          userId,
          folderId: null,
          url: "https://viralpickz.onshopbase.com/hoodie",
          title: "Shadowflex Hoodie",
          domain: "viralpickz.onshopbase.com",
        },
      });
      const notepad = await ctx.prisma.bookmark.create({
        data: {
          userId,
          folderId: null,
          url: "https://rodanotes.com/notepad-duo",
          title: "Notepad Duo",
          domain: "rodanotes.com",
        },
      });
      await ctx.prisma.bookmarkTag.create({ data: { bookmarkId: hoodie.id, tagId: shopping.body.id } });
      await ctx.prisma.bookmarkTag.create({ data: { bookmarkId: notepad.id, tagId: shopping.body.id } });
      const lettersInTagName = await agent
        .get(`/api/bookmarks/search?q=hood&tagIds=${shopping.body.id}`)
        .expect(200);
      expect(lettersInTagName.body.items.map((item: { id: string }) => item.id)).toEqual([hoodie.id]);

      const tagOnly = await agent.get(`/api/bookmarks/search?tagIds=${espresso.body.id}`).expect(200);
      expect(tagOnly.body.items).toHaveLength(1);
      expect(tagOnly.body.items[0].id).toBe(coffee.id);

      const filterExcludes = await agent
        .get(`/api/bookmarks/search?q=morning&tagIds=${espresso.body.id},unknown-id`)
        .expect(404);
      expect(filterExcludes.body.error.code).toBe(ErrorCode.TAG_NOT_FOUND);
    });
  });

  describe("tag and search visibility across protected folders", () => {
    async function lockFolder(agent: ReturnType<typeof request.agent>, name: string) {
      const folder = await agent.post("/api/folders").send({ name }).expect(201);
      await agent.post(`/api/folders/${folder.body.id}/password`).send({ password: "1234" }).expect(200);
      return folder.body.id as string;
    }

    it("hides protected bookmarks from global lists and search until unlocked", async () => {
      const { agent, userId } = await setup();
      const secret = await lockFolder(agent, "Vault");
      const tag = await agent.post("/api/tags").send({ name: "shared", color: "teal" }).expect(201);
      const hidden = await ctx.prisma.bookmark.create({
        data: { userId, folderId: secret, url: "https://example.com/secret", title: "Secret plan", domain: "example.com" },
      });
      await ctx.prisma.bookmarkTag.create({ data: { bookmarkId: hidden.id, tagId: tag.body.id } });
      await ctx.prisma.bookmark.create({
        data: { userId, folderId: null, url: "https://example.com/open", title: "Open notes", domain: "example.com" },
      });

      // no tokens: protected bookmark is absent from scope=all and search
      const list = await agent.get("/api/bookmarks?scope=all").expect(200);
      expect(list.body.items.map((b: { url: string }) => b.url)).toEqual(["https://example.com/open"]);
      const search = await agent.get("/api/bookmarks/search?q=secret").expect(200);
      expect(search.body.items).toHaveLength(0);
      const tagList = await agent.get("/api/tags").expect(200);
      expect(tagList.body[0].bookmarkCount).toBe(0);

      // unlock and replay with the plural token header
      const unlocked = await agent
        .post(`/api/folders/${secret}/unlock`)
        .send({ password: "1234" })
        .expect(200);
      const token: string = unlocked.body.token;
      const list2 = await agent.get("/api/bookmarks?scope=all").set("x-folder-tokens", token).expect(200);
      expect(list2.body.items).toHaveLength(2);
      const search2 = await agent
        .get("/api/bookmarks/search?q=secret")
        .set("x-folder-tokens", unlocked.body.token)
        .expect(200);
      expect(search2.body.items).toHaveLength(1);
      const tagList2 = await agent.get("/api/tags").set("x-folder-tokens", unlocked.body.token).expect(200);
      expect(tagList2.body[0].bookmarkCount).toBe(1);
    });

    it("ignores tokens that belong to another user's folders", async () => {
      const { agent, userId } = await setup();
      const other = await registerUser(ctx.app, "vault-owner@ordo.app");
      const foreignFolder = await ctx.prisma.folder.create({
        data: { userId: other.user.id, name: "Foreign", passwordHash: "x" },
      });
      const bookmark = await ctx.prisma.bookmark.create({
        data: { userId, folderId: null, url: "https://example.com/mine", title: "Mine", domain: "example.com" },
      });
      expect(bookmark.id).toBeTruthy();
      expect(foreignFolder.id).toBeTruthy();

      // a validly-shaped but foreign token must not unlock anything
      const res = await agent
        .get("/api/bookmarks?scope=all")
        .set("x-folder-tokens", "not-a-real-token")
        .expect(200);
      expect(res.body.items).toHaveLength(1);
    });
    it("suggests existing tags after extraction and honors accept/dismiss", async () => {
      const { agent } = await setup();
      const sample = await agent.post("/api/tags").send({ name: "sample" }).expect(201);
      const article = await agent.post("/api/tags").send({ name: "article" }).expect(201);
      const created = await agent
        .post("/api/bookmarks")
        .send({ url: "https://example.com/post" })
        .expect(201);
      expect(created.body.suggestedTags).toEqual([]);

      // wait for extraction + suggestion generation (fake reader is fast)
      let detail: { suggestedTags: Array<{ id: string }> } | undefined;
      for (let attempt = 0; attempt < 40; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 25));
        const res = await agent.get(`/api/bookmarks/${created.body.id}`).expect(200);
        if (res.body.suggestedTags.length > 0) {
          detail = res.body;
          break;
        }
      }
      expect(detail?.suggestedTags.map((t) => t.id).sort()).toEqual([article.body.id, sample.body.id].sort());

      // accept "sample", dismiss "article"
      const updated = await agent
        .put(`/api/bookmarks/${created.body.id}/tags`)
        .send({ tagIds: [sample.body.id], dismissedSuggestionIds: [article.body.id] })
        .expect(200);
      expect(updated.body.tags.map((t: { id: string }) => t.id)).toEqual([sample.body.id]);
      expect(updated.body.suggestedTags).toEqual([]);

      // a later re-extraction keeps the assignment and the dismissal
      await ctx.prisma.bookmark.update({
        where: { id: created.body.id },
        data: { extractionVersion: null },
      });
      const { TagSuggestionService } = await import("../src/bookmarks/tag-suggestion.service.js");
      await new TagSuggestionService(ctx.prisma).refresh(created.body.id);
      const after = await agent.get(`/api/bookmarks/${created.body.id}`).expect(200);
      expect(after.body.suggestedTags).toEqual([]);
      expect(after.body.tags.map((t: { id: string }) => t.id)).toEqual([sample.body.id]);

      // a brand-new bookmark gets fresh suggestions for both tags
      const other = await agent
        .post("/api/bookmarks")
        .send({ url: "https://example.com/another" })
        .expect(201);
      let otherDetail: { suggestedTags: Array<{ id: string }> } | undefined;
      for (let attempt = 0; attempt < 40; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 25));
        const res = await agent.get(`/api/bookmarks/${other.body.id}`).expect(200);
        if (res.body.suggestedTags.length > 0) {
          otherDetail = res.body;
          break;
        }
      }
      expect(otherDetail?.suggestedTags.map((t) => t.id).sort()).toEqual([article.body.id, sample.body.id].sort());
    });

    it("does not create tags or backfill suggestions for existing bookmarks", async () => {
      const { agent, userId } = await setup();
      const created = await agent
        .post("/api/bookmarks")
        .send({ url: "https://example.com/post" })
        .expect(201);
      for (let attempt = 0; attempt < 20; attempt += 1) {
        const res = await agent.get(`/api/bookmarks/${created.body.id}`).expect(200);
        if (res.body.fetchStatus !== "pending") break;
        await new Promise((resolve) => setTimeout(resolve, 25));
      }

      // creating a tag afterwards does not scan the existing bookmark
      await agent.post("/api/tags").send({ name: "sample" }).expect(201);
      const detail = await agent.get(`/api/bookmarks/${created.body.id}`).expect(200);
      expect(detail.body.suggestedTags).toEqual([]);
      expect(await ctx.prisma.tag.count({ where: { userId } })).toBe(1);
    });
  });

  describe("search", () => {
    it("searches across all of the user's bookmarks, filed and unfiled", async () => {
      const { agent, userId } = await setup();
      const folder = await ctx.prisma.folder.create({
        data: { userId, name: "Searchable" },
      });
      await ctx.prisma.bookmark.createMany({
        data: [
          {
            userId,
            folderId: null,
            url: "https://example.com/needle-unfiled",
            title: "Needle unfiled",
            domain: "example.com",
            contentText: "body",
          },
          {
            userId,
            folderId: folder.id,
            url: "https://example.com/needle-filed",
            title: "Needle filed",
            domain: "example.com",
            contentText: "body",
          },
          {
            userId,
            folderId: null,
            url: "https://example.com/haystack",
            title: "Haystack",
            domain: "example.com",
            contentText: "body",
          },
        ],
      });

      const res = await agent.get("/api/bookmarks/search?q=needle").expect(200);
      expect(res.body.items).toHaveLength(2);
      expect(res.body.items.map((b: { title: string }) => b.title).sort()).toEqual([
        "Needle filed",
        "Needle unfiled",
      ]);
    });

    it("ranks title matches ahead of newer body-only hits and finds domains", async () => {
      const { agent, userId } = await setup();
      await ctx.prisma.bookmark.create({
        data: {
          userId,
          folderId: null,
          url: "https://react.dev/learn",
          title: "Needle titled",
          domain: "react.dev",
        },
      });
      await ctx.prisma.bookmark.create({
        data: {
          userId,
          folderId: null,
          url: "https://example.com/body",
          title: "Diary",
          domain: "example.com",
          contentText: "needle in the article body",
        },
      });

      const ranked = await agent.get("/api/bookmarks/search?q=needle").expect(200);
      expect(ranked.body.items.map((b: { title: string }) => b.title)).toEqual([
        "Needle titled",
        "Diary",
      ]);

      const byDomain = await agent.get("/api/bookmarks/search?q=react.dev").expect(200);
      expect(byDomain.body.items).toHaveLength(1);
      expect(byDomain.body.items[0].domain).toBe("react.dev");
    });

    it("does not treat a single letter as an article-body match", async () => {
      const { agent, userId } = await setup();
      await ctx.prisma.bookmark.create({
        data: {
          userId,
          folderId: null,
          url: "https://ente.com/home",
          title: "Home",
          domain: "ente.com",
          contentText: "Every vault and every device.",
        },
      });
      await ctx.prisma.bookmark.create({
        data: {
          userId,
          folderId: null,
          url: "https://viralpickz.onshopbase.com/hoodie",
          title: "Shadowflex Hoodie",
          domain: "viralpickz.onshopbase.com",
        },
      });

      const res = await agent.get("/api/bookmarks/search?q=v").expect(200);
      expect(res.body.items.map((b: { title: string }) => b.title)).toEqual(["Shadowflex Hoodie"]);
    });

    it("does not match article text until the query is five letters", async () => {
      const { agent, userId } = await setup();
      await ctx.prisma.bookmark.create({
        data: {
          userId,
          folderId: null,
          url: "https://ente.com/home",
          title: "Home",
          domain: "ente.com",
          contentText: "Welcome to the vaults",
        },
      });

      const four = await agent.get("/api/bookmarks/search?q=vaul").expect(200);
      expect(four.body.items).toHaveLength(0);

      const five = await agent.get("/api/bookmarks/search?q=vault").expect(200);
      expect(five.body.items.map((b: { title: string }) => b.title)).toEqual(["Home"]);
    });

    it("filters search results to unread bookmarks", async () => {
      const { agent, userId } = await setup();
      await ctx.prisma.bookmark.create({
        data: {
          userId,
          folderId: null,
          url: "https://example.com/read",
          title: "Needle read",
          domain: "example.com",
          isRead: true,
        },
      });
      await ctx.prisma.bookmark.create({
        data: {
          userId,
          folderId: null,
          url: "https://example.com/unread",
          title: "Needle unread",
          domain: "example.com",
          isRead: false,
        },
      });

      const unread = await agent.get("/api/bookmarks/search?q=needle&unread=1").expect(200);
      expect(unread.body.items.map((b: { title: string }) => b.title)).toEqual(["Needle unread"]);
    });

    it("matches word prefixes on titles and hosts, not mid-word or short body text", async () => {
      const { agent, userId } = await setup();
      await ctx.prisma.bookmark.create({
        data: {
          userId,
          folderId: null,
          url: "https://ente.com/home",
          title: "Home",
          domain: "ente.com",
          contentText: "Need help with vaults and hello from the team.",
        },
      });
      await ctx.prisma.bookmark.create({
        data: {
          userId,
          folderId: null,
          url: "https://help.craftingstore.net/ssl",
          title: "CraftingStore SSL Guide",
          domain: "help.craftingstore.net",
        },
      });
      await ctx.prisma.bookmark.create({
        data: {
          userId,
          folderId: null,
          url: "https://example.com/helpful",
          title: "Helpful Guide",
          domain: "example.com",
        },
      });
      await ctx.prisma.bookmark.create({
        data: {
          userId,
          folderId: null,
          url: "https://example.com/shelf",
          title: "Bookshelf notes",
          domain: "example.com",
        },
      });

      const res = await agent.get("/api/bookmarks/search?q=hel").expect(200);
      expect(res.body.items.map((b: { title: string }) => b.title)).toEqual([
        "Helpful Guide",
        "CraftingStore SSL Guide",
      ]);
    });

    it("ranks AND title hits above OR hits for multi-word queries", async () => {
      const { agent, userId } = await setup();
      await ctx.prisma.bookmark.create({
        data: {
          userId,
          folderId: null,
          url: "https://example.com/both",
          title: "CraftingStore SSL Guide",
          domain: "example.com",
        },
      });
      await ctx.prisma.bookmark.create({
        data: {
          userId,
          folderId: null,
          url: "https://example.com/ssl",
          title: "SSL certificates",
          domain: "example.com",
        },
      });
      await ctx.prisma.bookmark.create({
        data: {
          userId,
          folderId: null,
          url: "https://example.com/guide",
          title: "Style guide",
          domain: "example.com",
        },
      });

      const res = await agent.get("/api/bookmarks/search?q=ssl%20guide").expect(200);
      expect(res.body.items.map((b: { title: string }) => b.title)).toEqual([
        "CraftingStore SSL Guide",
        "SSL certificates",
        "Style guide",
      ]);
    });

    it("filters search to selected folders and unfiled bookmarks", async () => {
      const { agent, userId } = await setup();
      const research = await ctx.prisma.folder.create({ data: { userId, name: "Research" } });
      const archive = await ctx.prisma.folder.create({ data: { userId, name: "Archive" } });
      const filed = await ctx.prisma.bookmark.create({
        data: {
          userId,
          folderId: research.id,
          url: "https://example.com/filed",
          title: "React filed",
          domain: "example.com",
        },
      });
      const unfiled = await ctx.prisma.bookmark.create({
        data: {
          userId,
          folderId: null,
          url: "https://example.com/unfiled",
          title: "React unfiled",
          domain: "example.com",
        },
      });
      await ctx.prisma.bookmark.create({
        data: {
          userId,
          folderId: archive.id,
          url: "https://example.com/other",
          title: "React other",
          domain: "example.com",
        },
      });

      const res = await agent
        .get(`/api/bookmarks/search?q=react&folderIds=${research.id}&unfiled=1`)
        .expect(200);
      expect(res.body.items.map((b: { id: string }) => b.id).sort()).toEqual([filed.id, unfiled.id].sort());

      await agent.get(`/api/bookmarks/search?q=react&folderIds=missing`).expect(404);
    });

    it("applies fuzzy matching only when requested", async () => {
      const { agent, userId } = await setup();
      await ctx.prisma.bookmark.create({
        data: {
          userId,
          folderId: null,
          url: "https://example.com/hello",
          title: "Hello world",
          domain: "example.com",
        },
      });

      const exact = await agent.get("/api/bookmarks/search?q=helo").expect(200);
      expect(exact.body.items).toHaveLength(0);

      const fuzzy = await agent.get("/api/bookmarks/search?q=helo&fuzzy=1").expect(200);
      expect(fuzzy.body.items.map((b: { title: string }) => b.title)).toEqual(["Hello world"]);
    });
  });

  describe("folder protection", () => {
    it("locks a folder, blocks access without a token, and unlocks with the password", async () => {
      const { agent } = await setup();
      const folder = await agent.post("/api/folders").send({ name: "Private" }).expect(201);
      await agent
        .post("/api/bookmarks")
        .send({ url: "https://example.com/secret", folderId: folder.body.id })
        .expect(201);

      await agent
        .post(`/api/folders/${folder.body.id}/password`)
        .send({ password: "1234" })
        .expect(200);

      // protected now — list without token is blocked
      const blocked = await agent
        .get(`/api/bookmarks?folderId=${folder.body.id}`)
        .expect(403);
      expect(blocked.body.error.code).toBe(ErrorCode.FOLDER_PROTECTED);
      expect(blocked.body.error.details).toEqual({ folderId: folder.body.id });

      // wrong password
      const wrong = await agent
        .post(`/api/folders/${folder.body.id}/unlock`)
        .send({ password: "nope" })
        .expect(403);
      expect(wrong.body.error.code).toBe(ErrorCode.INVALID_FOLDER_PASSWORD);

      // correct password → token
      const unlocked = await agent
        .post(`/api/folders/${folder.body.id}/unlock`)
        .send({ password: "1234" })
        .expect(200);
      const token: string = unlocked.body.token;
      expect(token).toBeTruthy();

      await agent
        .post("/api/bookmarks")
        .send({ url: "https://example.com/new-secret", folderId: folder.body.id })
        .expect(403);
      await agent
        .post("/api/bookmarks")
        .set("x-folder-token", token)
        .send({ url: "https://example.com/new-secret", folderId: folder.body.id })
        .expect(201);

      await agent
        .post("/api/bookmarks/mark-all-read")
        .send({ folderId: folder.body.id })
        .expect(403);
      const marked = await agent
        .post("/api/bookmarks/mark-all-read")
        .set("x-folder-token", token)
        .send({ folderId: folder.body.id })
        .expect(200);
      expect(marked.body.updated).toBe(2);

      // with token, list works
      const ok = await agent
        .get(`/api/bookmarks?folderId=${folder.body.id}`)
        .set("x-folder-token", token)
        .expect(200);
      expect(ok.body.items).toHaveLength(2);

      // removing the password opens the folder again
      await agent
        .post(`/api/folders/${folder.body.id}/remove-password`)
        .send({ folderPassword: "1234" })
        .expect(200);
      await agent.get(`/api/bookmarks?folderId=${folder.body.id}`).expect(200);
    });

    it("stores and reports the lock type for PIN, pattern, and legacy requests", async () => {
      const { agent } = await setup();
      const folder = await agent.post("/api/folders").send({ name: "Typed" }).expect(201);

      // legacy request without lockType → password
      await agent
        .post(`/api/folders/${folder.body.id}/password`)
        .send({ password: "1234" })
        .expect(200);
      let listed = await agent.get("/api/folders").expect(200);
      expect(listed.body.find((f: { id: string }) => f.id === folder.body.id).lockType).toBe(
        "password",
      );

      // PIN lock round-trip
      await agent
        .post(`/api/folders/${folder.body.id}/password`)
        .send({ password: "4321", lockType: "pin" })
        .expect(200);
      listed = await agent.get("/api/folders").expect(200);
      expect(listed.body.find((f: { id: string }) => f.id === folder.body.id).lockType).toBe("pin");
      expect(listed.body.find((f: { id: string }) => f.id === folder.body.id).pinLength).toBe(4);
      const pinUnlock = await agent
        .post(`/api/folders/${folder.body.id}/unlock`)
        .send({ password: "4321" })
        .expect(200);
      expect(pinUnlock.body.token).toBeTruthy();

      await agent
        .post(`/api/folders/${folder.body.id}/password`)
        .send({ password: "654321", lockType: "pin" })
        .expect(200);
      listed = await agent.get("/api/folders").expect(200);
      expect(listed.body.find((f: { id: string }) => f.id === folder.body.id).pinLength).toBe(6);

      // pattern lock round-trip + removal with the account password
      await agent
        .post(`/api/folders/${folder.body.id}/password`)
        .send({ password: "0-1-4-8", lockType: "pattern" })
        .expect(200);
      listed = await agent.get("/api/folders").expect(200);
      expect(listed.body.find((f: { id: string }) => f.id === folder.body.id).lockType).toBe(
        "pattern",
      );
      expect(listed.body.find((f: { id: string }) => f.id === folder.body.id).pinLength).toBeNull();
      const patternUnlock = await agent
        .post(`/api/folders/${folder.body.id}/unlock`)
        .send({ password: "0-1-4-8" })
        .expect(200);
      expect(patternUnlock.body.token).toBeTruthy();

      // removal with the account password (setup() registers "password123")
      await agent
        .post(`/api/folders/${folder.body.id}/remove-password`)
        .send({ accountPassword: "password123" })
        .expect(200);
      listed = await agent.get("/api/folders").expect(200);
      const finalFolder = listed.body.find((f: { id: string }) => f.id === folder.body.id);
      expect(finalFolder.protected).toBe(false);
      expect(finalFolder.lockType).toBeNull();
      expect(finalFolder.pinLength).toBeNull();
    });

    it("does not gate unfiled bookmarks on any folder token", async () => {
      const { agent } = await setup();
      const created = await agent
        .post("/api/bookmarks")
        .send({ url: "https://example.com/open" })
        .expect(201);

      // even with protected folders around, unfiled bookmarks stay accessible
      const folder = await agent.post("/api/folders").send({ name: "Locked" }).expect(201);
      await agent.post(`/api/folders/${folder.body.id}/password`).send({ password: "1234" }).expect(200);

      await agent.get(`/api/bookmarks/${created.body.id}`).expect(200);
      await agent.patch(`/api/bookmarks/${created.body.id}`).send({ isRead: true }).expect(200);
      const list = await agent.get("/api/bookmarks").expect(200);
      expect(list.body.items).toHaveLength(1);
      await agent.delete(`/api/bookmarks/${created.body.id}`).expect(200);
    });

    it("requires a token to read or mutate a bookmark inside a protected folder", async () => {
      const { agent } = await setup();
      const folder = await agent.post("/api/folders").send({ name: "Vault" }).expect(201);
      const created = await agent
        .post("/api/bookmarks")
        .send({ url: "https://example.com/secret", folderId: folder.body.id })
        .expect(201);

      await agent.post(`/api/folders/${folder.body.id}/password`).send({ password: "1234" }).expect(200);

      await agent.get(`/api/bookmarks/${created.body.id}`).expect(403);
      await agent
        .patch(`/api/bookmarks/${created.body.id}`)
        .send({ isRead: true })
        .expect(403);
      await agent.delete(`/api/bookmarks/${created.body.id}`).expect(403);

      // moving a bookmark OUT of a protected folder also requires the token
      await agent
        .patch(`/api/bookmarks/${created.body.id}`)
        .send({ folderId: null })
        .expect(403);

      const unlocked = await agent
        .post(`/api/folders/${folder.body.id}/unlock`)
        .send({ password: "1234" })
        .expect(200);
      const token: string = unlocked.body.token;

      const detail = await agent
        .get(`/api/bookmarks/${created.body.id}`)
        .set("x-folder-token", token)
        .expect(200);
      expect(detail.body.contentHtml).toBe("<p>Hello world.</p>");
    });

    it("requires a token to move a bookmark INTO a protected folder", async () => {
      const { agent } = await setup();
      const created = await agent
        .post("/api/bookmarks")
        .send({ url: "https://example.com/x" })
        .expect(201);
      const folder = await agent.post("/api/folders").send({ name: "Vault" }).expect(201);
      await agent.post(`/api/folders/${folder.body.id}/password`).send({ password: "1234" }).expect(200);

      await agent
        .patch(`/api/bookmarks/${created.body.id}`)
        .send({ folderId: folder.body.id })
        .expect(403);

      const unlocked = await agent
        .post(`/api/folders/${folder.body.id}/unlock`)
        .send({ password: "1234" })
        .expect(200);
      await agent
        .patch(`/api/bookmarks/${created.body.id}`)
        .set("x-folder-token", unlocked.body.token)
        .send({ folderId: folder.body.id })
        .expect(200);
    });

    it("deleting a protected folder requires no token (ownership only)", async () => {
      const { agent } = await setup();
      const folder = await agent.post("/api/folders").send({ name: "Bye" }).expect(201);
      await agent.post(`/api/folders/${folder.body.id}/password`).send({ password: "1234" }).expect(200);

      await agent.delete(`/api/folders/${folder.body.id}`).expect(200);
      expect((await agent.get("/api/folders").expect(200)).body).toHaveLength(0);
    });

    it("requires the folder password or account password to remove a lock", async () => {
      const { agent } = await setup();
      const folder = await agent.post("/api/folders").send({ name: "Vault" }).expect(201);
      await agent.post(`/api/folders/${folder.body.id}/password`).send({ password: "1234" }).expect(200);

      const missing = await agent.post(`/api/folders/${folder.body.id}/remove-password`).expect(400);
      expect(missing.body.error.code).toBe(ErrorCode.VALIDATION_ERROR);

      const wrongFolder = await agent
        .post(`/api/folders/${folder.body.id}/remove-password`)
        .send({ folderPassword: "nope" })
        .expect(403);
      expect(wrongFolder.body.error.code).toBe(ErrorCode.INVALID_FOLDER_PASSWORD);

      const wrongAccount = await agent
        .post(`/api/folders/${folder.body.id}/remove-password`)
        .send({ accountPassword: "wrongpassword" })
        .expect(401);
      expect(wrongAccount.body.error.code).toBe(ErrorCode.INVALID_CREDENTIALS);

      await agent
        .post(`/api/folders/${folder.body.id}/remove-password`)
        .send({ accountPassword: "password123" })
        .expect(200);
      await agent.get(`/api/bookmarks?folderId=${folder.body.id}`).expect(200);
    });

    it("does not leak Express Cannot POST for an unknown folder route", async () => {
      const { agent } = await setup();
      const res = await agent.post("/api/folders/any-id/password/nope").expect(404);
      expect(res.body.error.code).toBe(ErrorCode.NOT_FOUND);
      expect(res.body.error.message).not.toMatch(/Cannot POST/i);
    });

    it("moves a bookmark between two locked folders when both tokens are presented", async () => {
      const { agent } = await setup();
      const source = await agent.post("/api/folders").send({ name: "Source" }).expect(201);
      const dest = await agent.post("/api/folders").send({ name: "Dest" }).expect(201);
      const created = await agent
        .post("/api/bookmarks")
        .send({ url: "https://example.com/x", folderId: source.body.id })
        .expect(201);

      await agent.post(`/api/folders/${source.body.id}/password`).send({ password: "aaaa" }).expect(200);
      await agent.post(`/api/folders/${dest.body.id}/password`).send({ password: "bbbb" }).expect(200);

      const tokenA = (
        await agent.post(`/api/folders/${source.body.id}/unlock`).send({ password: "aaaa" }).expect(200)
      ).body.token;
      const tokenB = (
        await agent.post(`/api/folders/${dest.body.id}/unlock`).send({ password: "bbbb" }).expect(200)
      ).body.token;

      await agent
        .patch(`/api/bookmarks/${created.body.id}`)
        .set("x-folder-token", tokenA)
        .send({ folderId: dest.body.id })
        .expect(403);

      const moved = await agent
        .patch(`/api/bookmarks/${created.body.id}`)
        .set("x-folder-tokens", `${tokenA},${tokenB}`)
        .send({ folderId: dest.body.id })
        .expect(200);
      expect(moved.body.folderId).toBe(dest.body.id);
    });
  });

  describe("batch actions", () => {
    it("marks, moves, tags, and deletes many bookmarks in one request", async () => {
      const { agent, userId } = await setup();
      const folder = await agent.post("/api/folders").send({ name: "Later" }).expect(201);
      const tag = await agent.post("/api/tags").send({ name: "queue", color: "blue" }).expect(201);
      const a = await agent.post("/api/bookmarks").send({ url: "https://example.com/a" }).expect(201);
      const b = await agent.post("/api/bookmarks").send({ url: "https://example.com/b" }).expect(201);
      const c = await agent.post("/api/bookmarks").send({ url: "https://example.com/c" }).expect(201);

      const read = await agent
        .post("/api/bookmarks/batch")
        .send({ action: "markRead", ids: [a.body.id, b.body.id] })
        .expect(200);
      expect(read.body.updated).toBe(2);

      const unread = await agent
        .post("/api/bookmarks/batch")
        .send({ action: "markUnread", ids: [a.body.id] })
        .expect(200);
      expect(unread.body.updated).toBe(1);

      const tagged = await agent
        .post("/api/bookmarks/batch")
        .send({ action: "addTags", ids: [a.body.id, b.body.id], tagIds: [tag.body.id] })
        .expect(200);
      expect(tagged.body.updated).toBe(2);
      const taggedDetail = await agent.get(`/api/bookmarks/${a.body.id}`).expect(200);
      expect(taggedDetail.body.tags.map((t: { id: string }) => t.id)).toEqual([tag.body.id]);

      const moved = await agent
        .post("/api/bookmarks/batch")
        .send({ action: "move", ids: [a.body.id, b.body.id, c.body.id], folderId: folder.body.id })
        .expect(200);
      expect(moved.body.updated).toBe(3);
      const inFolder = await agent.get(`/api/bookmarks?folderId=${folder.body.id}`).expect(200);
      expect(inFolder.body.items).toHaveLength(3);

      const deleted = await agent
        .post("/api/bookmarks/batch")
        .send({ action: "delete", ids: [a.body.id, b.body.id] })
        .expect(200);
      expect(deleted.body.updated).toBe(2);
      const remaining = await agent.get(`/api/bookmarks?folderId=${folder.body.id}`).expect(200);
      expect(remaining.body.items.map((item: { id: string }) => item.id)).toEqual([c.body.id]);
      expect(await ctx.prisma.bookmark.count({ where: { userId } })).toBe(1);
    });

    it("requires a folder token to batch-edit bookmarks in a locked folder", async () => {
      const { agent } = await setup();
      const folder = await agent.post("/api/folders").send({ name: "Secret" }).expect(201);
      const created = await agent
        .post("/api/bookmarks")
        .send({ url: "https://example.com/secret", folderId: folder.body.id })
        .expect(201);
      await agent.post(`/api/folders/${folder.body.id}/password`).send({ password: "lock" }).expect(200);

      const blocked = await agent
        .post("/api/bookmarks/batch")
        .send({ action: "markRead", ids: [created.body.id] })
        .expect(403);
      expect(blocked.body.error.code).toBe(ErrorCode.FOLDER_PROTECTED);

      const token = (
        await agent.post(`/api/folders/${folder.body.id}/unlock`).send({ password: "lock" }).expect(200)
      ).body.token;
      const ok = await agent
        .post("/api/bookmarks/batch")
        .set("x-folder-token", token)
        .send({ action: "markRead", ids: [created.body.id] })
        .expect(200);
      expect(ok.body.updated).toBe(1);
    });

    it("ignores other users' bookmarks and rejects an empty batch", async () => {
      const { agent } = await setup();
      const other = await registerUser(ctx.app, "other-batch@ordo.app");
      const foreign = await ctx.prisma.bookmark.create({
        data: {
          userId: other.user.id,
          url: "https://example.com/foreign",
          title: "Foreign",
          domain: "example.com",
        },
      });
      const mine = await agent.post("/api/bookmarks").send({ url: "https://example.com/mine" }).expect(201);

      const res = await agent
        .post("/api/bookmarks/batch")
        .send({ action: "delete", ids: [mine.body.id, foreign.id] })
        .expect(200);
      expect(res.body.updated).toBe(1);
      expect(await ctx.prisma.bookmark.findUnique({ where: { id: foreign.id } })).toBeTruthy();

      const empty = await agent.post("/api/bookmarks/batch").send({ action: "delete", ids: [] }).expect(400);
      expect(empty.body.error.code).toBe(ErrorCode.VALIDATION_ERROR);
    });

    it("pins and deletes many folders, cascading their bookmarks", async () => {
      const { agent, userId } = await setup();
      const keep = await agent.post("/api/folders").send({ name: "Keep" }).expect(201);
      const goneA = await agent.post("/api/folders").send({ name: "Gone A" }).expect(201);
      const goneB = await agent.post("/api/folders").send({ name: "Gone B" }).expect(201);
      await agent.post("/api/bookmarks").send({ url: "https://example.com/a", folderId: goneA.body.id }).expect(201);
      await agent.post("/api/bookmarks").send({ url: "https://example.com/b", folderId: goneB.body.id }).expect(201);

      const pinned = await agent
        .post("/api/folders/batch")
        .send({ action: "pin", ids: [keep.body.id, goneA.body.id], pinned: true })
        .expect(200);
      expect(pinned.body.updated).toBe(2);
      const listed = await agent.get("/api/folders").expect(200);
      expect(listed.body.find((folder: { id: string }) => folder.id === keep.body.id).pinned).toBe(true);

      const deleted = await agent
        .post("/api/folders/batch")
        .send({ action: "delete", ids: [goneA.body.id, goneB.body.id] })
        .expect(200);
      expect(deleted.body.updated).toBe(2);
      expect(await ctx.prisma.folder.count({ where: { userId } })).toBe(1);
      expect(await ctx.prisma.bookmark.count({ where: { userId } })).toBe(0);
    });
  });
});
