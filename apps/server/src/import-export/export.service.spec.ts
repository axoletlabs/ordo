import { Readable } from "node:stream";
import { ExportService } from "./export.service.js";
import { LibraryCryptoService } from "../crypto/library-crypto.service.js";

function rows(books: Array<Record<string, unknown>>) {
  return books.map((b, i) => ({
    id: `b${i + 1}`,
    folderId: null,
    url: "https://example.com/a",
    title: "A",
    description: null,
    author: null,
    publishedAt: null,
    readingTimeMinutes: null,
    readProgress: 0,
    completedAt: null,
    isRead: false,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
    tags: [],
    ...b,
  }));
}

async function readAll(stream: Readable): Promise<string> {
  let out = "";
  for await (const chunk of stream) out += chunk as string;
  return out;
}

describe("ExportService", () => {
  function setup() {
    const folders = [
      { id: "f1", name: "Public", icon: "book-outline", pinned: false, passwordHash: null, createdAt: new Date() },
      { id: "f2", name: "Private", icon: "folder-outline", pinned: false, passwordHash: "x", createdAt: new Date() },
    ];
    const bookmarks = rows([
      { folderId: "f1", url: "https://example.com/one", title: "One" },
      { folderId: "f2", url: "https://example.com/secret", title: "Secret" },
      { folderId: null, url: "https://example.com/unfiled", title: "Unfiled" },
    ]);

    const matchWhere = (where: Record<string, unknown>) => {
      if (Array.isArray(where.OR)) {
        // Library filter: OR [{ folderId: null }, { folderId: { in: [...] } }].
        const inClause = where.OR.find(
          (clause: unknown) =>
            typeof clause === "object" &&
            clause !== null &&
            (clause as { folderId?: unknown }).folderId !== null &&
            typeof (clause as { folderId?: unknown }).folderId === "object",
        ) as { folderId: { in: string[] } } | undefined;
        const included = inClause?.folderId?.in ?? [];
        return bookmarks.filter((b) => b.folderId === null || included.includes(b.folderId));
      }
      const folderId = where.folderId as string | { in: string[] } | null | undefined;
      if (folderId && typeof folderId === "object" && Array.isArray(folderId.in)) {
        return bookmarks.filter((b) => typeof b.folderId === "string" && folderId.in.includes(b.folderId));
      }
      if (folderId === null || folderId === undefined) {
        return bookmarks.filter((b) => b.folderId === null);
      }
      return bookmarks.filter((b) => b.folderId === folderId);
    };

    const prisma = {
      folder: { findMany: jest.fn().mockResolvedValue(folders) },
      bookmark: {
        findMany: jest.fn().mockImplementation(async (args: { where: Record<string, unknown> }) =>
          matchWhere(args.where),
        ),
      },
      folderToken: { findUnique: jest.fn().mockResolvedValue(null) },
    };
    const tokens = { hash: jest.fn((t: string) => `hash-${t}`) };
    const service = new ExportService(prisma as never, tokens as never, new LibraryCryptoService());
    return { prisma, tokens, service, folders };
  }

  it("json export emits a valid envelope and excludes locked folders without tokens", async () => {
    const { service } = setup();
    const file = await service.export("u1", { format: "json", folderId: null }, []);
    const body = JSON.parse(await readAll(file.stream));

    expect(body.format).toBe("ordo-export");
    expect(body.version).toBe(1);
    expect(body.folders.map((f: { name: string }) => f.name)).toEqual(["Public"]);
    expect(body.bookmarks.map((b: { url: string }) => b.url)).toEqual([
      "https://example.com/one",
      "https://example.com/unfiled",
    ]);
    expect(body.bookmarks[0].folder).toBe("Public");
    expect(body.bookmarks[0].contentHtml).toBeUndefined();
    expect(file.contentType).toContain("application/json");
    expect(file.filename).toMatch(/^ordo-export-\d{4}-\d{2}-\d{2}\.json$/);
  });

  it("includes a locked folder when its token is valid", async () => {
    const { service, prisma, tokens } = setup();
    prisma.folderToken.findUnique.mockImplementation(async ({ where }: { where: { tokenHash: string } }) => ({
      folderId: "f2",
      expiresAt: new Date(Date.now() + 60_000),
      tokenHash: where.tokenHash,
    }));

    const file = await service.export("u1", { format: "json", folderId: null }, ["tok-priv"]);
    expect(tokens.hash).toHaveBeenCalledWith("tok-priv");
    const body = JSON.parse(await readAll(file.stream));
    expect(body.folders.map((f: { name: string }) => f.name)).toEqual(["Public", "Private"]);
    expect(body.bookmarks).toHaveLength(3);
  });

  it("single-folder export enforces the folder token", async () => {
    const { service } = setup();
    await expect(
      service.export("u1", { format: "json", folderId: "f2" }, []),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: "folder_protected" }),
    });
  });

  it("html export writes Netscape structure with folder sections", async () => {
    const { service } = setup();
    const file = await service.export("u1", { format: "html", folderId: null }, []);
    const body = await readAll(file.stream);

    expect(body).toContain("<!DOCTYPE NETSCAPE-Bookmark-file-1>");
    expect(body).toContain("<H3>Public</H3>");
    expect(body).not.toContain("Private");
    expect(body).toContain('HREF="https://example.com/one"');
    expect(body).toContain('HREF="https://example.com/unfiled"');
  });

  it("csv export writes the Ordo profile header and rows", async () => {
    const { service } = setup();
    const file = await service.export("u1", { format: "csv", folderId: null }, []);
    const body = await readAll(file.stream);

    const lines = body.trimEnd().split("\n");
    expect(lines[0]).toBe(
      "url,title,folder,tags,isRead,readProgress,completedAt,createdAt,updatedAt,description,author,publishedAt,readingTimeMinutes",
    );
    expect(lines[1]).toContain("https://example.com/one,One,Public,");
    expect(body).not.toContain("secret");
  });

  it("folderIds export includes only those folders and omits unfiled", async () => {
    const { service, prisma } = setup();
    prisma.folderToken.findUnique.mockImplementation(async ({ where }: { where: { tokenHash: string } }) => ({
      folderId: "f2",
      expiresAt: new Date(Date.now() + 60_000),
      tokenHash: where.tokenHash,
    }));

    const file = await service.export("u1", { format: "json", folderIds: ["f1", "f2"] }, ["tok-priv"]);
    const body = JSON.parse(await readAll(file.stream));
    expect(body.folders.map((f: { name: string }) => f.name)).toEqual(["Public", "Private"]);
    expect(body.bookmarks.map((b: { url: string }) => b.url)).toEqual([
      "https://example.com/one",
      "https://example.com/secret",
    ]);
  });

  it("html folderIds export skips the Unfiled section", async () => {
    const { service } = setup();
    const file = await service.export("u1", { format: "html", folderIds: ["f1"] }, []);
    const body = await readAll(file.stream);
    expect(body).toContain("<H3>Public</H3>");
    expect(body).not.toContain("<H3>Unfiled</H3>");
    expect(body).not.toContain("https://example.com/unfiled");
  });

  it("legacy folderId still scopes to a single folder", async () => {
    const { service } = setup();
    const file = await service.export("u1", { format: "json", folderId: "f1" }, []);
    const body = JSON.parse(await readAll(file.stream));
    expect(body.folders.map((f: { name: string }) => f.name)).toEqual(["Public"]);
    expect(body.bookmarks.map((b: { url: string }) => b.url)).toEqual(["https://example.com/one"]);
  });
});
