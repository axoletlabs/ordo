#!/usr/bin/env node
/**
 * Service-level regression for folder deletion with preserved bookmarks.
 * Exercises FoldersService/FoldersController against a disposable SQLite
 * database, complementing the HTTP-level checks in
 * scripts/test-folder-preservation-api.mjs (which stays the wire-contract
 * authority). Run after building: pnpm --filter @ordo/shared build &&
 * pnpm --filter @ordo/server build, then:
 *   node apps/server/scripts/folder-delete-keeps.test.mjs
 */
import "reflect-metadata";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { once } from "node:events";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
// Migrations normally resolve from the server process cwd; keep this script
// runnable from anywhere by pinning them to the checkout's prisma directory.
process.env.ORDO_MIGRATIONS_DIR = join(here, "..", "prisma", "migrations");

const { FOLDER_DELETE_KEEP_LIMIT } = await import("@ordo/shared");
const { DeleteFolderWithKeepsSchema, BatchFoldersSchema } = await import("@ordo/shared/schemas");
const { PrismaService } = await import("../dist/prisma/prisma.service.js");
const { TokenService } = await import("../dist/auth/token.service.js");
const { FolderTokenService } = await import("../dist/bookmarks/folder-token.service.js");
const { FolderAccessService } = await import("../dist/bookmarks/folder-access.service.js");
const { FoldersService } = await import("../dist/bookmarks/folders.service.js");
const { FoldersController } = await import("../dist/bookmarks/folders.controller.js");
const { BookmarksService } = await import("../dist/bookmarks/bookmarks.service.js");
const { TagsService } = await import("../dist/bookmarks/tags.service.js");
const { findFtsBookmarkIds } = await import("../dist/prisma/bookmark-fts.js");

const temporary = await mkdtemp(join(tmpdir(), "ordo-folder-keeps-"));
const reservation = createServer();
reservation.listen(0, "127.0.0.1");
await once(reservation, "listening");
const dbPath = join(temporary, `test-${reservation.address().port}.db`);
await new Promise((done) => reservation.close(done));

const prisma = new PrismaService({ databaseUrl: `file:${dbPath}` });
await prisma.onModuleInit(); // migrations + FTS triggers

const tokens = new TokenService({ jwtSecret: "disposable-test-secret" });
const folderTokens = new FolderTokenService(prisma, tokens);
const access = new FolderAccessService(prisma, folderTokens);
const rateLimit = new RateLimitStub();
const crypto = new LibraryCryptoStub();
const folders = new FoldersService(prisma, folderTokens, access, rateLimit, crypto);
const controller = new FoldersController(folders);

function RateLimitStub() {
  return {
    checkFolderUnlock() {},
    clearFolderUnlock() {},
    recordFolderUnlockFailure() {},
  };
}
function LibraryCryptoStub() {
  return {
    active: () => false,
    sealFolderName: (_userId, _id, name) => name,
    openFolder: (folder) => folder,
  };
}

let sequence = 0;
async function user(name) {
  return prisma.user.create({
    data: { displayName: name, email: `${name}-${++sequence}@example.test`, passwordHash: "x" },
  });
}
async function folder(userId, name) {
  return prisma.folder.create({ data: { userId, name } });
}
async function bookmark(userId, folderId, title) {
  return prisma.bookmark.create({
    data: {
      userId,
      folderId,
      url: `https://example.test/${++sequence}/${title}`,
      title,
      domain: "example.test",
    },
  });
}

async function check(name, run) {
  await run();
  console.log(`PASS ${name}`);
}

async function expectErrorCode(code, fn) {
  try {
    await fn();
  } catch (cause) {
    assert.equal(cause.code, code, `expected ${code}, got ${cause && cause.code}`);
    return;
  }
  assert.fail(`expected ${code} error, call succeeded`);
}

try {
  await check("real SQLite foreign-key races report missing folders or tags correctly", async () => {
    const owner = await user("foreign-key-owner");
    const staleFolder = await folder(owner.id, "Vanishing folder");
    await prisma.folder.delete({ where: { id: staleFolder.id } });
    const bookmarkCrypto = { ...crypto, sealBookmark: (_user, _id, fields) => fields, openBookmark: (row) => row };
    const tags = new TagsService(prisma, access, bookmarkCrypto);
    const extraction = { enqueue() {}, cancel() {} };
    const bookmarks = new BookmarksService(prisma, extraction, access, tags, bookmarkCrypto);
    await expectErrorCode("folder_not_found", () => bookmarks.create(owner.id, staleFolder, "https://example.invalid/stale-folder"));

    const tag = await prisma.tag.create({ data: { userId: owner.id, name: "Vanishing tag", normalizedName: "vanishing tag", color: "blue" } });
    let first = true;
    const racingTags = { requireOwnedIds: async (...args) => {
      await tags.requireOwnedIds(...args);
      if (first) { first = false; await prisma.tag.delete({ where: { id: tag.id } }); }
    } };
    const withTagRace = new BookmarksService(prisma, extraction, access, racingTags, bookmarkCrypto);
    await expectErrorCode("tag_not_found", () => withTagRace.create(owner.id, null, "https://example.invalid/stale-tag", [tag.id]));

    for (const batch of [false, true]) {
      const destination = await folder(owner.id, "Vanishing destination");
      const row = await bookmark(owner.id, null, `move-race-${batch}`);
      const racingAccess = { requireFolder: async (...args) => {
        const checked = await access.requireFolder(...args);
        await prisma.folder.delete({ where: { id: destination.id } });
        return checked;
      } };
      const moving = new BookmarksService(prisma, extraction, racingAccess, tags, bookmarkCrypto);
      await expectErrorCode("folder_not_found", () => batch
        ? moving.batch(owner.id, { action: "move", ids: [row.id], folderId: destination.id }, [])
        : moving.update(owner.id, row.id, { folderId: destination.id }, []));
      assert.equal((await prisma.bookmark.findUnique({ where: { id: row.id } })).folderId, null);
    }
  });

  await check("schema: keepIds is required and typo'd payloads never silently cascade", async () => {
    assert.equal(DeleteFolderWithKeepsSchema.parse({ keepIds: [] }).keepIds.length, 0);
    assert.equal(DeleteFolderWithKeepsSchema.parse({ keepIds: ["a"] }).keepIds[0], "a");
    for (const bad of [
      {}, // missing keepIds
      { keepBookmarks: ["a"] }, // typo'd field name
      { keepIds: ["a"], keepAll: true }, // unknown extra property
      { keepIds: "all" },
      { keepIds: [null] },
      { keepIds: [""] },
    ]) {
      assert.throws(() => DeleteFolderWithKeepsSchema.parse(bad), undefined, JSON.stringify(bad));
    }
    const atLimit = Array.from({ length: FOLDER_DELETE_KEEP_LIMIT }, (_v, i) => `id-${i}`);
    assert.equal(DeleteFolderWithKeepsSchema.parse({ keepIds: atLimit }).keepIds.length, atLimit.length);
    assert.throws(() => DeleteFolderWithKeepsSchema.parse({ keepIds: [...atLimit, "one-too-many"] }));
  });

  await check("schema: batch delete refuses misrouted keepIds instead of stripping them", async () => {
    const ids = ["folder-1"];
    assert.doesNotThrow(() => BatchFoldersSchema.parse({ action: "delete", ids }));
    assert.throws(() => BatchFoldersSchema.parse({ action: "delete", ids, keepIds: ["a"] }));
    assert.doesNotThrow(() => BatchFoldersSchema.parse({ action: "pin", ids, pinned: true }));
  });

  await check("atomic keep: exact keptIds, cascade cleanup, FTS and highlights stay consistent", async () => {
    const owner = await user("keep-owner");
    const source = await folder(owner.id, "Keep source");
    const gone = await bookmark(owner.id, source.id, "vanishprobe");
    const kept = await bookmark(owner.id, source.id, "survivorprobe");
    await prisma.bookmarkHighlight.create({
      data: { bookmarkId: kept.id, exact: "kept highlight" },
    });
    const tag = await prisma.tag.create({
      data: { userId: owner.id, name: "cascade", normalizedName: "cascade", color: "blue" },
    });
    await prisma.bookmarkTag.create({ data: { bookmarkId: gone.id, tagId: tag.id } });

    const result = await folders.removeWithKeeps(source.id, owner.id, [kept.id, kept.id, "not-an-id"]);
    assert.deepEqual(result, {
      success: true,
      keptIds: [kept.id],
      keptBookmarks: 1,
      deletedBookmarks: 1,
    });

    const keptRow = await prisma.bookmark.findUniqueOrThrow({ where: { id: kept.id } });
    assert.equal(keptRow.folderId, null);
    assert.equal(await prisma.bookmark.count({ where: { id: gone.id } }), 0);
    assert.equal(await prisma.bookmarkHighlight.count({ where: { bookmarkId: kept.id } }), 1);
    assert.equal(await prisma.bookmarkHighlight.count({ where: { bookmarkId: gone.id } }), 0);
    assert.equal(await prisma.bookmarkTag.count({ where: { bookmarkId: gone.id } }), 0);
    assert.equal(await prisma.tag.count({ where: { id: tag.id } }), 1);
    assert.equal(await prisma.folder.count({ where: { id: source.id } }), 0);

    // FTS index follows the cascade: deleted rows stop matching, keeps still do.
    const survivor = await findFtsBookmarkIds(prisma, {
      userId: owner.id,
      match: "{title} : survivorprobe*",
      limit: 10,
    });
    const vanish = await findFtsBookmarkIds(prisma, {
      userId: owner.id,
      match: "{title} : vanishprobe*",
      limit: 10,
    });
    assert.deepEqual(survivor, [kept.id]);
    assert.deepEqual(vanish, []);
  });

  await check("race regression: a keep moved to another folder stays there, never unfiled", async () => {
    const owner = await user("race-owner");
    const source = await folder(owner.id, "Race source");
    const destination = await folder(owner.id, "Race destination");
    const moved = await bookmark(owner.id, source.id, "moved-out-by-other-client");
    const stays = await bookmark(owner.id, source.id, "still-in-source");

    // Another client moves `moved` out between selection and replay.
    await prisma.bookmark.update({ where: { id: moved.id }, data: { folderId: destination.id } });

    const result = await folders.removeWithKeeps(source.id, owner.id, [moved.id, stays.id]);
    assert.deepEqual(result.keptIds, [stays.id]);
    assert.equal(result.keptBookmarks, 1);
    assert.equal(result.deletedBookmarks, 0);

    const movedRow = await prisma.bookmark.findUniqueOrThrow({ where: { id: moved.id } });
    assert.equal(movedRow.folderId, destination.id, "keep must remain in its new folder");
    const staysRow = await prisma.bookmark.findUniqueOrThrow({ where: { id: stays.id } });
    assert.equal(staysRow.folderId, null);
    assert.equal(await prisma.folder.count({ where: { id: source.id } }), 0);
    assert.equal(await prisma.folder.count({ where: { id: destination.id } }), 1);
  });

  await check("kept bookmarks carry their reading state to unfiled untouched", async () => {
    const owner = await user("state-owner");
    const source = await folder(owner.id, "State source");
    const row = await bookmark(owner.id, source.id, "stateful-keep");
    await prisma.bookmark.update({
      where: { id: row.id },
      data: { readProgress: 0.4, remindAt: 1900000000, isRead: false },
    });
    await folders.removeWithKeeps(source.id, owner.id, [row.id]);
    const kept = await prisma.bookmark.findUniqueOrThrow({ where: { id: row.id } });
    assert.equal(kept.folderId, null);
    assert.equal(kept.readProgress, 0.4);
    assert.equal(kept.remindAt, 1900000000);
    assert.equal(kept.isRead, false);
  });

  await check("locked folders need a live unlock token, then keep atomically", async () => {
    const owner = await user("lock-owner");
    const source = await folder(owner.id, "Locked source");
    const row = await bookmark(owner.id, source.id, "locked-keep");
    await folderTokens.setPassword(source.id, "1234", "pin");

    await expectErrorCode("folder_protected", () => folders.removeWithKeeps(source.id, owner.id, [row.id]));
    await expectErrorCode("folder_protected", () =>
      folders.removeWithKeeps(source.id, owner.id, [row.id], ["bogus-token"]));
    const unlocked = await folders.unlock(source.id, owner.id, "1234");
    const result = await folders.removeWithKeeps(source.id, owner.id, [row.id], [unlocked.token]);
    assert.deepEqual(result.keptIds, [row.id]);
    assert.equal((await prisma.bookmark.findUniqueOrThrow({ where: { id: row.id } })).folderId, null);
    assert.equal(await prisma.folderToken.count({ where: { folderId: source.id } }), 0);
  });

  await check("retry after a lost response reports folder_not_found and keeps keeps unfiled", async () => {
    const owner = await user("retry-owner");
    const source = await folder(owner.id, "Retry source");
    const row = await bookmark(owner.id, source.id, "retry-keep");
    await folders.removeWithKeeps(source.id, owner.id, [row.id]);
    await expectErrorCode("folder_not_found", () =>
      folders.removeWithKeeps(source.id, owner.id, [row.id]));
    assert.equal((await prisma.bookmark.findUniqueOrThrow({ where: { id: row.id } })).folderId, null);
  });

  await check("keep lists beyond the move-chunk size stay exact and atomic", async () => {
    const owner = await user("bulk-owner");
    const source = await folder(owner.id, "Bulk source");
    const rows = [];
    for (let i = 0; i < 620; i++) {
      rows.push(await bookmark(owner.id, source.id, `bulk-keep-${i}`));
    }
    const result = await folders.removeWithKeeps(
      source.id,
      owner.id,
      rows.map((row) => row.id),
    );
    assert.equal(result.keptBookmarks, 620);
    assert.equal(result.keptIds.length, 620);
    assert.equal(result.deletedBookmarks, 0);
    assert.equal(await prisma.bookmark.count({ where: { userId: owner.id, folderId: null } }), 620);
    assert.equal(await prisma.folder.count({ where: { id: source.id } }), 0);
  });

  await check("empty folders delete with explicit empty keepIds", async () => {
    const owner = await user("empty-owner");
    const source = await folder(owner.id, "Empty source");
    const result = await folders.removeWithKeeps(source.id, owner.id, []);
    assert.deepEqual(result, { success: true, keptIds: [], keptBookmarks: 0, deletedBookmarks: 0 });
  });

  await check("controller: legacy DELETE refuses every non-empty body, aliases included", async () => {
    const owner = await user("guard-owner");
    const source = await folder(owner.id, "Guard source");
    const other = await folder(owner.id, "Guard other");
    const row = await bookmark(owner.id, source.id, "guard-keep");
    const ctx = { userId: owner.id };
    const req = (body) => ({ body, get: () => undefined });

    for (const body of [
      { keepIds: [] },
      { keepIds: [row.id] },
      { keep: [row.id] }, // alias must not slip through either
      { keepBookmarks: [row.id] },
      "not-an-object",
    ]) {
      await expectErrorCode("validation_error", () => controller.remove(ctx, source.id, req(body)));
    }
    // No body (or an empty object) keeps the legacy cascade contract.
    await controller.remove(ctx, source.id, req(undefined));
    await controller.remove(ctx, other.id, req({}));
    assert.equal(await prisma.bookmark.count({ where: { id: row.id } }), 0);
    assert.equal(await prisma.folder.count({ where: { id: source.id } }), 0);
    assert.equal(await prisma.folder.count({ where: { id: other.id } }), 0);
  });

  console.log("service-level folder-delete-keeps checks passed.");
} finally {
  await prisma.onModuleDestroy();
  await rm(temporary, { recursive: true, force: true });
}
