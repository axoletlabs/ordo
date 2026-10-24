#!/usr/bin/env node
/** Real HTTP + SQLite regression checks. Run after building shared/server:
 * node scripts/test-folder-preservation-api.mjs
 * All accounts, credentials, and data are created in a disposable directory.
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm, symlink } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const Database = createRequire(join(root, 'package.json'))('better-sqlite3');
const temporary = await mkdtemp(join(tmpdir(), 'ordo-folder-preservation-'));
const reservation = createServer();
reservation.listen(0, '127.0.0.1');
await once(reservation, 'listening');
const port = reservation.address().port;
await new Promise((done) => reservation.close(done));
await symlink(join(root, 'apps/server/prisma'), join(temporary, 'prisma'));
const server = spawn(process.execPath, [join(root, 'apps/server/dist/main.js')], {
  cwd: temporary,
  env: {
    ...process.env,
    PORT: String(port), LISTEN_HOST: '127.0.0.1',
    DATABASE_URL: `file:${join(temporary, 'test.db')}`,
    REGISTRATION_ENABLED: 'true', EMAIL_VERIFICATION_REQUIRED: 'false',
    RATE_LIMIT_ENABLED: 'false', SMTP_REQUIRED: 'false', SMTP_URL: '',
    MFA_REQUIRED: 'false', AVATAR_STORAGE: 'database',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let logs = '';
server.stdout.on('data', (chunk) => { logs = (logs + chunk).slice(-16000); });
server.stderr.on('data', (chunk) => { logs = (logs + chunk).slice(-16000); });
const base = `http://127.0.0.1:${port}`;
let checked = 0;
let sequence = 0;

async function request(path, { method = 'GET', body, session, token } = {}) {
  const response = await fetch(base + path, {
    method,
    headers: {
      'content-type': 'application/json', 'x-client-type': 'mobile',
      ...(session ? { authorization: `Bearer ${session.tokens.accessToken}` } : {}),
      ...(token ? { 'x-folder-token': token } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(15000),
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
}

async function ok(path, options) {
  const result = await request(path, options);
  assert.ok(result.status >= 200 && result.status < 300, `${options?.method ?? 'GET'} ${path}: ${JSON.stringify(result)}`);
  return result.body;
}

async function account(name) {
  return ok('/api/auth/register', { method: 'POST', body: {
    displayName: name, email: `${name}@example.test`, password: 'Disposable-test-password-42!',
  } });
}

async function fixture(session, count = 3) {
  const folder = await ok('/api/folders', { method: 'POST', session, body: { name: `Folder ${++sequence}` } });
  const bookmarks = [];
  for (let i = 0; i < count; i++) {
    bookmarks.push(await ok('/api/bookmarks', { method: 'POST', session, body: {
      url: `https://example.invalid/folder-${sequence}/bookmark-${i}`, folderId: folder.id,
    } }));
  }
  return { folder, bookmarks };
}

async function check(name, run) {
  await run();
  checked++;
  console.log(`PASS ${name}`);
}

try {
  let ready = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    if (server.exitCode !== null) throw new Error(`Test server exited: ${logs}`);
    try { ready = (await request('/api/server/info')).status === 200; } catch { /* booting */ }
    if (ready) break;
    await new Promise((done) => setTimeout(done, 100));
  }
  assert.ok(ready, `Test server did not start: ${logs}`);
  const owner = await account('folder-owner');
  const stranger = await account('folder-stranger');
  const remove = (folderId, keepIds, session = owner, token) => request(`/api/folders/${folderId}/delete`, {
    method: 'POST', session, token, body: { keepIds },
  });

  await check('preserve selected bookmark and its reading/reminder metadata; cascade the rest', async () => {
    const { folder, bookmarks } = await fixture(owner);
    await ok(`/api/bookmarks/${bookmarks[0].id}`, { method: 'PATCH', session: owner,
      body: { readProgress: 0.4, remindAt: 1900000000 } });
    const result = await remove(folder.id, [bookmarks[0].id]);
    assert.equal(result.status, 200, JSON.stringify(result));
    assert.deepEqual(result.body.keptIds, [bookmarks[0].id]);
    assert.equal(result.body.deletedBookmarks, 2);
    const kept = await ok(`/api/bookmarks/${bookmarks[0].id}`, { session: owner });
    assert.equal(kept.folderId, null);
    assert.equal(kept.readProgress, 0.4);
    assert.equal(kept.remindAt, 1900000000);
    for (const item of bookmarks.slice(1)) assert.equal((await request(`/api/bookmarks/${item.id}`, { session: owner })).status, 404);
    assert.ok(!(await ok('/api/folders', { session: owner })).some((item) => item.id === folder.id));
  });

  await check('retry a completed preservation without losing the kept bookmark', async () => {
    const { folder, bookmarks } = await fixture(owner, 1);
    assert.equal((await remove(folder.id, [bookmarks[0].id])).status, 200);
    const replay = await remove(folder.id, [bookmarks[0].id]);
    assert.ok([200, 404].includes(replay.status), JSON.stringify(replay));
    assert.equal((await ok(`/api/bookmarks/${bookmarks[0].id}`, { session: owner })).folderId, null);
  });

  await check('leave a kept bookmark in the folder another client moved it to', async () => {
    const { folder, bookmarks } = await fixture(owner, 2);
    const destination = (await fixture(owner, 0)).folder;
    await ok(`/api/bookmarks/${bookmarks[0].id}`, { method: 'PATCH', session: owner, body: { folderId: destination.id } });
    const result = await remove(folder.id, bookmarks.map((item) => item.id));
    assert.equal(result.status, 200);
    assert.deepEqual(result.body.keptIds, [bookmarks[1].id]);
    assert.equal((await ok(`/api/bookmarks/${bookmarks[0].id}`, { session: owner })).folderId, destination.id);
    assert.equal((await ok(`/api/bookmarks/${bookmarks[1].id}`, { session: owner })).folderId, null);
  });

  await check('a missing kept bookmark does not block preserving remaining bookmarks', async () => {
    const { folder, bookmarks } = await fixture(owner, 2);
    await ok(`/api/bookmarks/${bookmarks[0].id}`, { method: 'DELETE', session: owner });
    assert.equal((await remove(folder.id, bookmarks.map((item) => item.id))).status, 200);
    assert.equal((await ok(`/api/bookmarks/${bookmarks[1].id}`, { session: owner })).folderId, null);
  });

  await check('require ownership and authentication before preserving or deleting', async () => {
    const { folder, bookmarks } = await fixture(owner, 1);
    assert.equal((await remove(folder.id, [bookmarks[0].id], stranger)).status, 404);
    assert.equal((await remove(folder.id, [bookmarks[0].id], null)).status, 401);
    assert.equal((await ok(`/api/bookmarks/${bookmarks[0].id}`, { session: owner })).folderId, folder.id);
  });

  await check('never move another account\'s bookmark supplied as a keep ID', async () => {
    const own = await fixture(owner, 1);
    const other = await fixture(stranger, 1);
    assert.equal((await remove(own.folder.id, [own.bookmarks[0].id, other.bookmarks[0].id])).status, 200);
    assert.equal((await ok(`/api/bookmarks/${own.bookmarks[0].id}`, { session: owner })).folderId, null);
    assert.equal((await ok(`/api/bookmarks/${other.bookmarks[0].id}`, { session: stranger })).folderId, other.folder.id);
  });

  await check('deduplicate keeps and support deleting empty folders', async () => {
    const { folder, bookmarks } = await fixture(owner, 1);
    assert.equal((await remove(folder.id, [bookmarks[0].id, bookmarks[0].id])).status, 200);
    assert.equal((await ok(`/api/bookmarks/${bookmarks[0].id}`, { session: owner })).folderId, null);
    assert.equal((await remove((await fixture(owner, 0)).folder.id, [])).status, 200);
  });

  await check('reject malformed selections without deleting the folder', async () => {
    const { folder, bookmarks } = await fixture(owner, 1);
    for (const keepIds of ['all', [null], ['']]) assert.equal((await remove(folder.id, keepIds)).status, 400);
    for (const body of [{}, { keepBookmarks: [bookmarks[0].id] }, { keepIds: [], keepBookmarks: [bookmarks[0].id] }]) {
      assert.equal((await request(`/api/folders/${folder.id}/delete`, { method: 'POST', session: owner, body })).status, 400);
    }
    assert.equal((await ok(`/api/bookmarks/${bookmarks[0].id}`, { session: owner })).folderId, folder.id);
  });

  await check('reject keep IDs sent to legacy cascading deletion endpoints', async () => {
    const { folder, bookmarks } = await fixture(owner, 1);
    assert.equal((await request(`/api/folders/${folder.id}`, { method: 'DELETE', session: owner,
      body: { keepIds: [bookmarks[0].id] } })).status, 400);
    assert.equal((await request('/api/folders/batch', { method: 'POST', session: owner,
      body: { action: 'delete', ids: [folder.id], keepIds: [bookmarks[0].id] } })).status, 400);
    assert.equal((await ok(`/api/bookmarks/${bookmarks[0].id}`, { session: owner })).folderId, folder.id);
  });

  await check('require a live unlock token, and preserve content after unlocking', async () => {
    const { folder, bookmarks } = await fixture(owner, 1);
    await ok(`/api/folders/${folder.id}/password`, { method: 'POST', session: owner,
      body: { password: '1234', lockType: 'pin' } });
    assert.equal((await remove(folder.id, [bookmarks[0].id])).status, 403);
    assert.equal((await remove(folder.id, [bookmarks[0].id], owner, 'expired-token')).status, 403);
    const access = await ok(`/api/folders/${folder.id}/unlock`, { method: 'POST', session: owner, body: { password: '1234' } });
    assert.equal((await remove(folder.id, [bookmarks[0].id], owner, access.token)).status, 200);
    assert.equal((await ok(`/api/bookmarks/${bookmarks[0].id}`, { session: owner })).folderId, null);
  });

  await check('roll back bookmark moves when deleting the folder fails', async () => {
    const { folder, bookmarks } = await fixture(owner, 2);
    const database = new Database(join(temporary, 'test.db'));
    try {
      database.exec(`CREATE TRIGGER fail_test_folder_delete BEFORE DELETE ON Folder
        WHEN old.id = '${folder.id}' BEGIN SELECT RAISE(ABORT, 'forced test deletion failure'); END`);
      assert.equal((await remove(folder.id, [bookmarks[0].id])).status, 500);
      for (const item of bookmarks) assert.equal((await ok(`/api/bookmarks/${item.id}`, { session: owner })).folderId, folder.id);
    } finally {
      database.exec('DROP TRIGGER IF EXISTS fail_test_folder_delete');
      database.close();
    }
    assert.equal((await remove(folder.id, [bookmarks[0].id])).status, 200);
  });

  await check('preserve more bookmarks than the 200-item batch limit', async () => {
    const { folder, bookmarks } = await fixture(owner, 205);
    const result = await remove(folder.id, bookmarks.map((item) => item.id));
    assert.equal(result.status, 200, JSON.stringify(result));
    for (const item of bookmarks) assert.equal((await ok(`/api/bookmarks/${item.id}`, { session: owner })).folderId, null);
  });

  await check('legacy folder delete still cascades when nothing is kept', async () => {
    const { folder, bookmarks } = await fixture(owner, 2);
    await ok(`/api/folders/${folder.id}`, { method: 'DELETE', session: owner });
    for (const item of bookmarks) assert.equal((await request(`/api/bookmarks/${item.id}`, { session: owner })).status, 404);
  });
  console.log(`${checked} real HTTP/SQLite folder-preservation checks passed.`);
} finally {
  if (server.exitCode === null) {
    server.kill('SIGTERM');
    const timer = setTimeout(() => server.kill('SIGKILL'), 5000);
    try { await once(server, 'exit'); } finally { clearTimeout(timer); }
  }
  await rm(temporary, { recursive: true, force: true });
}
