import type { CommitImportInput } from "@ordo/shared";
import { ImportService } from "./import.service.js";
import type { ParsedEntry } from "./parsers/parse-utils.js";
import { LibraryCryptoService } from "../crypto/library-crypto.service.js";

/** Minimal entry factory. */
function entry(overrides: Partial<ParsedEntry> = {}): ParsedEntry {
  return {
    url: "https://example.com/a",
    title: "A",
    folderPath: [],
    tags: [],
    isRead: false,
    readProgress: 0,
    completedAt: null,
    createdAt: null,
    updatedAt: null,
    description: null,
    author: null,
    publishedAt: null,
    readingTimeMinutes: null,
    ...overrides,
  };
}

const INPUT: CommitImportInput = { duplicatePolicy: "skip", atomic: true };

/** Typed stand-in for the prisma client so mock inference cannot go circular. */
type MockedImportPrisma = {
  importJob: Record<
    "findFirst" | "findUnique" | "create" | "update" | "updateMany" | "deleteMany",
    jest.Mock
  >;
  bookmark: Record<"findMany" | "createMany" | "update" | "updateMany", jest.Mock>;
  folder: { findMany: jest.Mock; aggregate: jest.Mock; create: jest.Mock };
  tag: { findMany: jest.Mock; create: jest.Mock };
  bookmarkTag: { findMany: jest.Mock; createMany: jest.Mock };
  folderToken: { findUnique: jest.Mock };
  $transaction: (fn: (tx: unknown) => Promise<unknown>) => Promise<unknown>;
};

/** The JSON.parse'd ImportResultDto the commit writes back to the job row. */
interface ImportResultLike {
  imported: number;
  updated: number;
  skipped: number;
  failed: number;
  foldersCreated: number;
  atomic: boolean;
  duplicatePolicy: string;
  failures: Array<{ line: number; reason: string; url: string | null }>;
}

describe("ImportService.commit", () => {
  function setup() {
    const existingBookmarks = [
      {
        id: "b1",
        url: "https://example.com/dup",
        folderId: null,
        isRead: false,
        readProgress: 0,
        completedAt: null,
        description: null,
        author: null,
      },
    ];
    const existingFolders = [{ id: "f1", name: "Reading", passwordHash: null }];

    const prisma: MockedImportPrisma = {
      importJob: {
        findFirst: jest.fn(),
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
        deleteMany: jest.fn(),
      },
      bookmark: {
        findMany: jest.fn().mockResolvedValue(existingBookmarks),
        createMany: jest.fn().mockResolvedValue({ count: 0 }),
        update: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      folder: {
        findMany: jest.fn().mockResolvedValue(existingFolders),
        aggregate: jest.fn().mockResolvedValue({ _max: { position: 3 } }),
        create: jest.fn(({ data }: { data: { name: string } & Record<string, unknown> }) =>
          Promise.resolve({ id: `new-${data.name}`, ...data })),
      },
      tag: {
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn(({ data }: { data: { name: string } & Record<string, unknown> }) =>
          Promise.resolve({ id: `tag-${data.name}`, ...data })),
      },
      bookmarkTag: {
        findMany: jest.fn().mockResolvedValue([]),
        createMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      folderToken: { findUnique: jest.fn().mockResolvedValue(null) },
      $transaction: jest.fn((fn: (tx: unknown) => Promise<unknown>) => fn(prisma)),
    };
    const tokens = { hash: jest.fn((t: string) => `hash-${t}`) };
    const extraction = { enqueue: jest.fn() };
    const service = new ImportService(
      prisma as never,
      tokens as never,
      extraction as never,
      new LibraryCryptoService(),
    );

    const run = async (
      entries: ParsedEntry[],
      folders: Array<{ name: string }> = [],
      input: CommitImportInput = INPUT,
    ): Promise<ImportResultLike> => {
      const fullJob = {
        id: "j1",
        status: "committing",
        fileName: null,
        preview: null,
        failure: null,
        result: null,
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + 60_000),
      };
      prisma.importJob.updateMany.mockResolvedValueOnce({ count: 1 });
      prisma.importJob.findFirst.mockResolvedValue(fullJob);
      prisma.importJob.findUnique.mockResolvedValueOnce({
        id: "j1",
        entries: JSON.stringify({ entries, folders }),
      });
      await service.commit("u1", "j1", input, []);
      // runCommit is fire-and-forget; drain the microtask queue.
      await new Promise((resolve) => setTimeout(resolve, 0));
      const resultCall = prisma.importJob.update.mock.calls.find(
        (call: unknown[]) => (call[0] as { data: { result?: string } }).data?.result !== undefined,
      );
      if (!resultCall) throw new Error("commit did not record a result");
      return JSON.parse(
        (resultCall[0] as { data: { result: string } }).data.result,
      ) as ImportResultLike;
    };

    return { prisma, service, run };
  }

  it("skips duplicates by url normalization and imports the rest", async () => {
    const { run } = setup();
    const result = await run([
      entry({ url: "https://EXAMPLE.com/dup" }),
      entry({ url: "https://example.com/fresh" }),
    ]);

    expect(result.imported).toBe(1);
    expect(result.skipped).toBe(1);
    expect(result.updated).toBe(0);
  });

  it("update policy refreshes the existing row instead of creating", async () => {
    const { prisma, run } = setup();
    const result = await run([entry({ url: "https://example.com/dup", title: "New title", isRead: true })], [], {
      duplicatePolicy: "update",
      atomic: true,
    });

    expect(result.imported).toBe(0);
    expect(result.updated).toBe(1);
    expect(prisma.bookmark.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "b1" }, data: expect.objectContaining({ title: "New title" }) }),
    );
  });

  it("copy policy creates duplicates verbatim", async () => {
    const { run } = setup();
    const result = await run([entry({ url: "https://example.com/dup" })], [], {
      duplicatePolicy: "copy",
      atomic: true,
    });
    expect(result.imported).toBe(1);
    expect(result.skipped).toBe(0);
  });

  it("merges into an existing folder by name and creates new ones", async () => {
    const { prisma, run } = setup();
    const result = await run([
      entry({ url: "https://example.com/1", folderPath: ["reading"] }),
      entry({ url: "https://example.com/2", folderPath: ["New", "Stuff"] }),
    ]);

    expect(result.foldersCreated).toBe(1);
    expect(prisma.folder.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ name: "New / Stuff", position: 4 }) }),
    );
    const batch = prisma.bookmark.createMany.mock.calls[0][0].data as Array<{ folderId: string | null }>;
    expect(batch[0].folderId).toBe("f1"); // case-insensitive merge into "Reading"
    expect(batch[1].folderId).toBe("new-New / Stuff");
  });

  it("flattens within-file repeats to one row under skip policy", async () => {
    const { run } = setup();
    const result = await run([
      entry({ url: "https://example.com/same" }),
      entry({ url: "https://example.com/same" }),
    ]);
    expect(result.imported).toBe(1);
    expect(result.skipped).toBe(1);
  });

  it("marks rows targeting locked folders as failed (best-effort)", async () => {
    const { prisma, run } = setup();
    prisma.folder.findMany.mockResolvedValue([
      { id: "locked", name: "Private", passwordHash: "x" },
    ]);
    const result = await run(
      [entry({ url: "https://example.com/1", folderPath: ["Private"] })],
      [],
      { duplicatePolicy: "skip", atomic: false },
    );

    expect(result.failed).toBe(1);
    expect(result.imported).toBe(0);
    expect(prisma.bookmark.createMany).not.toHaveBeenCalled();
  });

  it("creates ordo-json tags and links them to created rows", async () => {
    const { prisma, run } = setup();
    await run([entry({ url: "https://example.com/t", tags: ["ai", "ethics"] })]);
    expect(prisma.tag.create).toHaveBeenCalledTimes(2);
    expect(prisma.bookmarkTag.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.arrayContaining([
          expect.objectContaining({ tagId: "tag-ai" }),
          expect.objectContaining({ tagId: "tag-ethics" }),
        ]),
      }),
    );
  });

  it("preview counts unique new urls separately from already-saved ones", async () => {
    const { prisma, service } = setup();
    prisma.importJob.create.mockResolvedValue({ id: "j1" });
    prisma.importJob.update.mockResolvedValue({});
    prisma.bookmark.findMany.mockResolvedValue([{ url: "https://example.com/dup" }]);
    prisma.folder.findMany.mockResolvedValue([]);

    await service.createJob(
      "u1",
      "brave.html",
      `<DL><p>
        <DT><A HREF="https://example.com/dup">Old</A>
        <DT><A HREF="https://example.com/fresh">New</A>
      </DL>`,
    );
    await new Promise((resolve) => setTimeout(resolve, 50));
    const previewCall = prisma.importJob.update.mock.calls.find(
      (call: unknown[]) => (call[0] as { data: { preview?: string } }).data?.preview,
    );
    expect(previewCall).toBeTruthy();
    const preview = JSON.parse(
      (previewCall[0] as { data: { preview: string } }).data.preview,
    ) as { uniqueNew: number; uniqueDuplicates: number; duplicateSamples: Array<{ title: string }> };
    expect(preview.uniqueNew).toBe(1);
    expect(preview.uniqueDuplicates).toBe(1);
    expect(preview.duplicateSamples[0].title).toBe("Old");
  });
});

describe("ImportService.getJob", () => {
  it("throws IMPORT_NOT_FOUND for foreign or missing jobs", async () => {
    const prisma = {
      importJob: { findFirst: jest.fn().mockResolvedValue(null), deleteMany: jest.fn() },
    };
    const service = new ImportService(prisma as never, {} as never, {} as never, new LibraryCryptoService());
    await expect(service.getJob("u1", "j1")).rejects.toMatchObject({
      response: expect.objectContaining({ code: "import_not_found" }),
    });
  });

  it("deletes and reports expired jobs", async () => {
    const prisma = {
      importJob: {
        findFirst: jest.fn().mockResolvedValue({
          id: "j1",
          status: "ready",
          fileName: null,
          preview: null,
          failure: null,
          result: null,
          createdAt: new Date(),
          expiresAt: new Date(Date.now() - 1000),
        }),
        deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
    const service = new ImportService(prisma as never, {} as never, {} as never, new LibraryCryptoService());
    await expect(service.getJob("u1", "j1")).rejects.toMatchObject({
      response: expect.objectContaining({ code: "import_not_found" }),
    });
    expect(prisma.importJob.deleteMany).toHaveBeenCalledWith({ where: { id: "j1" } });
  });

  it("fills missing preview arrays so older jobs stay renderable", async () => {
    const prisma = {
      importJob: {
        findFirst: jest.fn().mockResolvedValue({
          id: "j1",
          status: "ready",
          fileName: "brave.html",
          preview: JSON.stringify({
            format: "netscape-html",
            totalRows: 2,
            validRows: 2,
            invalidRows: 0,
            duplicates: 1,
            withinFileDuplicates: 0,
            newFolders: [],
            existingFolders: [],
            lockedFolderMatches: [],
            invalidSamples: [],
          }),
          failure: null,
          result: null,
          createdAt: new Date(),
          expiresAt: new Date(Date.now() + 60_000),
        }),
        deleteMany: jest.fn(),
      },
    };
    const service = new ImportService(prisma as never, {} as never, {} as never, new LibraryCryptoService());
    const job = await service.getJob("u1", "j1");
    expect(job.preview?.duplicateSamples).toEqual([]);
    expect(job.preview?.uniqueDuplicates).toBe(1);
    expect(job.preview?.uniqueNew).toBe(1);
  });
});
