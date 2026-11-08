/** Run after the shared/server builds; exercise real SQLite and encryption. */
const assert = require('node:assert/strict');
const { randomBytes } = require('node:crypto');
const { mkdtempSync, readdirSync, readFileSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');
const Database = require('better-sqlite3');
const { UpdateBookmarkSchema, BOOKMARK_TITLE_MAX_LENGTH } = require('@ordo/shared');
const { PrismaClient } = require('../dist/prisma/client.js');
const { createPrismaAdapter } = require('../dist/prisma/create-adapter.js');
const { BookmarksService } = require('../dist/bookmarks/bookmarks.service.js');
const { ExtractionService } = require('../dist/bookmarks/extraction.service.js');
const { FolderAccessService } = require('../dist/bookmarks/folder-access.service.js');
const { LibraryCryptoService } = require('../dist/crypto/library-crypto.service.js');

const directory = mkdtempSync(path.join(tmpdir(), 'ordo-title-test-'));
const filename = path.join(directory, 'test.db');
const database = new Database(filename);
const migrations = path.resolve(__dirname, '../prisma/migrations');
for (const name of readdirSync(migrations).sort()) {
  if (name === 'migration_lock.toml') continue;
  database.exec(readFileSync(path.join(migrations, name, 'migration.sql'), 'utf8'));
}
database.close();
const prisma = new PrismaClient({ adapter: createPrismaAdapter(`file:${filename}`) });
const crypto = new LibraryCryptoService();
const access = new FolderAccessService(prisma, { resolveFolderIds: async (tokens) => tokens });
const bookmarks = new BookmarksService(prisma, { enqueue() {} }, access, {}, crypto);

(async () => {
  assert.equal(UpdateBookmarkSchema.parse({ title: '  My title  ' }).title, 'My title');
  for (const title of ['', ' \n\t ', 'x'.repeat(BOOKMARK_TITLE_MAX_LENGTH + 1), null, 123]) {
    assert.equal(UpdateBookmarkSchema.safeParse({ title }).success, false);
  }
  assert.equal(UpdateBookmarkSchema.safeParse({ title: 'x'.repeat(BOOKMARK_TITLE_MAX_LENGTH) }).success, true);
  assert.equal(UpdateBookmarkSchema.safeParse({}).success, false);
  assert.equal(UpdateBookmarkSchema.safeParse({ isRead: true }).success, true);

  for (const dek of [null, randomBytes(32)]) {
    await crypto.runAsync(dek, async () => {
      const user = await prisma.user.create({ data: {
        email: `${dek ? 'encrypted' : 'plain'}@example.test`, displayName: 'Test', passwordHash: 'unused',
      } });
      const create = async (title, extra = {}) => {
        const id = randomBytes(8).toString('hex');
        return prisma.bookmark.create({ data: {
          id, userId: user.id,
          ...crypto.sealBookmark(user.id, id, { url: 'https://example.test/article', domain: 'example.test', title, ...extra }),
        } });
      };
      const row = await create('Original title', { fetchStatus: 'pending' });
      let release;
      let started;
      const ready = new Promise(resolve => { started = resolve; });
      const gate = new Promise(resolve => { release = resolve; });
      const extraction = new ExtractionService(prisma, {
        extract: async (_url, options) => {
          await options.onMetadata({ title: 'Early page title' });
          started();
          await gate;
          await options.onMetadata({ title: 'Late page title' });
          return {
            title: 'Extracted page title', domain: 'example.test', description: 'Extracted description',
            author: null, publishedAt: null, readingTimeMinutes: 1, contentHtml: '<p>Article content</p>',
          };
        },
      }, { refreshSafely() {} }, crypto, { runWithCurrentKey: (_user, dek, run) => crypto.runAsync(dek, run) });
      const extracting = extraction.enrichBookmark(row.id, 'https://example.test/article');
      await ready;
      const updated = await bookmarks.update(user.id, row.id, UpdateBookmarkSchema.parse({ title: '  My title  ' }), []);
      assert.equal(updated.title, 'My title');
      assert.equal(updated.url, 'https://example.test/article');
      await assert.rejects(bookmarks.update('another-user', row.id, { title: 'Stolen' }, []));
      release();
      await extracting;
      const stored = await prisma.bookmark.findUniqueOrThrow({ where: { id: row.id } });
      const opened = crypto.openBookmark(stored);
      assert.equal(opened.title, 'My title', 'in-flight early/final extraction must keep the edit');
      assert.equal(opened.titleEdited, true);
      assert.equal(opened.contentHtml, '<p>Article content</p>', 'extraction still completes');
      assert.equal(opened.fetchStatus, 'ok');
      if (dek) assert.notEqual(stored.title, 'My title', 'edited title stays encrypted at rest');

      const automatic = await create('Placeholder', { fetchStatus: 'pending' });
      await extraction.enrichBookmark(automatic.id, 'https://example.test/article');
      assert.equal(crypto.openBookmark(await prisma.bookmark.findUniqueOrThrow({ where: { id: automatic.id } })).title,
        'Extracted page title', 'untouched titles still receive page metadata');

      const website = await create('Website title', { fetchStatus: 'unsupported' });
      await bookmarks.update(user.id, website.id, { contentKindOverride: 'article' }, []);
      await bookmarks.update(user.id, website.id, { title: 'Personal title' }, []);
      const restored = await bookmarks.update(user.id, website.id, { contentKindOverride: 'web' }, []);
      assert.equal(restored.title, 'Personal title', 'undoing forced extraction preserves the edit');
      assert.equal(restored.fetchStatus, 'unsupported');

      const folder = await prisma.folder.create({ data: { userId: user.id, name: 'Locked', passwordHash: 'locked' } });
      const locked = await create('Private title', { folderId: folder.id });
      await assert.rejects(bookmarks.update(user.id, locked.id, { title: 'Denied' }, []));
      assert.equal((await bookmarks.update(user.id, locked.id, { title: 'Allowed' }, [folder.id])).title, 'Allowed');
    });
  }
  console.log('PASS: title validation, ownership, locked folders, persistence, encryption, extraction races, and article undo');
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  await prisma.$disconnect();
  rmSync(directory, { recursive: true, force: true });
});
