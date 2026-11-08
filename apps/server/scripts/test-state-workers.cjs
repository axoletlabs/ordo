/** Worker exits, cancelled extraction ownership, recovery retries and shared fetch modes. */
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { HtmlCache } = require('../dist/bookmarks/html-cache.js');
const { ExtractionService } = require('../dist/bookmarks/extraction.service.js');
const tick = () => new Promise(resolve => setImmediate(resolve));
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function poolFixture(failSecond = false) {
  const workers = [];
  class Worker extends EventEmitter {
    constructor() {
      super();
      if (failSecond && workers.length === 1) throw new Error('worker unavailable');
      this.messages = [];
      workers.push(this);
    }
    postMessage(message) { this.messages.push(message); }
    terminate() { this.terminated = true; return Promise.resolve(0); }
  }
  const filename = path.resolve(__dirname, '../dist/bookmarks/reader-pool.js');
  const exports = {};
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
    exports, __dirname: path.dirname(filename),
    process: { env: { ORDO_EXTRACT_WORKERS: '1' } },
    require: name => name === 'node:worker_threads' ? { Worker } : name === './reader-parse.js'
      ? { extractFromHtml: html => ({ title: html }) }
      : name.startsWith('.') ? require(path.resolve(path.dirname(filename), name)) : require(name),
  }, { filename });
  return { workers, pool: new exports.ExtractPool() };
}

async function pools() {
  const partial = poolFixture(true);
  assert.equal(partial.workers[0].terminated, true, 'constructor failure cleans up already started workers');
  assert.equal((await partial.pool.parse('inline', 'https://example.test', false)).title, 'inline');
  await partial.pool.close();
  await assert.rejects(partial.pool.parse('closed', 'https://example.test', false), /closed/);

  const running = poolFixture();
  const pending = ['first', 'second', 'queued'].map(html => running.pool.parse(html, 'https://example.test', false));
  running.workers[0].emit('exit', 0);
  assert.deepEqual((await Promise.all(pending)).map(result => result.title), ['first', 'second', 'queued'], 'even a clean unexpected exit settles every job');
  assert.ok(running.workers.every(worker => worker.terminated));
  await running.pool.close();

  const closing = poolFixture();
  const interrupted = closing.pool.parse('pending', 'https://example.test', false);
  interrupted.catch(() => {});
  await closing.pool.close();
  await assert.rejects(interrupted, /closed/);
}

async function extraction() {
  const calls = [], writes = [];
  let scans = 0, failScan = false, encrypted = false;
  const row = { id: 'bookmark', userId: 'account', title: 'Current article', contentKindOverride: null, url: 'https://example.test/article' };
  const prisma = {
    bookmark: {
      findUnique: async () => row,
      findMany: async () => { scans++; if (failScan) throw new Error('temporary database failure'); return encrypted ? [{ ...row, url: 'encrypted' }] : []; },
      updateMany: async args => { writes.push(args); return { count: 1 }; },
    },
    $transaction: operations => Promise.all(operations),
  };
  let hasKey = false;
  const crypto = {
    runAsync: (_dek, run) => run(),
    run: (dek, run) => { hasKey = !!dek; return run(); },
    openBookmark: data => {
      if (data.url === 'encrypted') {
        if (!hasKey) throw new Error('key unavailable');
        return { ...data, url: row.url };
      }
      return data;
    },
    sealBookmark: (_user, _id, data) => data,
  };
  const reader = { extract: (_url, options) => {
    const result = deferred(); calls.push({ options, ...result }); return result.promise;
  } };
  let failKey = false;
  const service = new ExtractionService(prisma, reader, { refreshSafely() {} }, crypto, {
    runWithCurrentKey: (_user, dek, run) => failKey ? Promise.reject(new Error('temporary key lookup failure')) : crypto.runAsync(dek, run),
  });
  const task = { bookmarkId: row.id, userId: row.userId, url: row.url, mode: 'full' };
  const result = { title: 'Extracted article', description: null, domain: 'example.test', author: null, publishedAt: null, readingTimeMinutes: 1, contentHtml: '<p>Body</p>' };
  service.enqueue([task]);
  await tick();
  service.cancel(row.id);
  service.enqueue([task]);
  await tick();
  assert.equal(calls.length, 2);
  assert.equal(calls[0].options.signal.aborted, true);
  await calls[0].options.onMetadata({ title: 'Late obsolete metadata' });
  calls[0].resolve(result); // Readability can finish after its fetch was cancelled.
  await tick();
  assert.equal(writes.length, 0, 'a superseded attempt cannot write');
  service.enqueue([task]);
  await tick();
  assert.equal(calls.length, 2, 'old cleanup cannot delete the new attempt ownership');
  service.cancel(row.id);
  assert.equal(calls[1].options.signal.aborted, true, 'the new attempt remains cancellable');
  calls[1].resolve(result);
  await service.whenIdle();
  assert.equal(writes.length, 0);
  service.enqueue([task]);
  await tick();
  calls[2].resolve(result);
  await service.whenIdle();
  assert.ok(writes.some(write => write.data.fetchStatus === 'ok'), 'a subsequent valid attempt completes');

  failScan = true;
  service.resumePending('retry', null);
  await tick();
  failScan = false;
  service.resumePending('retry', null);
  await tick();
  assert.equal(scans, 2, 'a failed recovery scan does not permanently suppress retries');
  encrypted = true;
  service.resumePending('encrypted-account', null);
  await tick();
  service.resumePending('encrypted-account', Buffer.alloc(32));
  await tick();
  assert.equal(scans, 4, 'missing-key scans can resume when the session supplies its key');
  calls[3].resolve(result);
  await service.whenIdle();

  failKey = true;
  service.enqueue([task]);
  await service.whenIdle();
  assert.equal(calls.length, 4, 'key setup failed before extraction started');
  failKey = false;
  service.enqueue([task]);
  await tick();
  assert.equal(calls.length, 5, 'a failed key lookup releases the attempt for retry');
  calls[4].resolve(result);
  await service.whenIdle();
}

async function cache() {
  const cache = new HtmlCache();
  const old = deferred(), fresh = deferred();
  const abort = new AbortController();
  const first = cache.remember('https://example.test', () => old.promise, abort.signal);
  first.catch(() => {});
  abort.abort();
  await assert.rejects(first, { name: 'AbortError' });
  const second = cache.remember('https://example.test', () => fresh.promise);
  fresh.resolve('fresh');
  assert.equal(await second, 'fresh');
  old.resolve('obsolete');
  await tick();
  assert.equal(cache.get('https://example.test'), 'fresh', 'cancelled work cannot overwrite a newer cache entry');
  assert.equal(await cache.remember('https://example.test', async () => 'forced', undefined, 'forced'), 'forced', 'force mode has independent fetch state');
  assert.equal(await cache.remember('https://example.test', async () => 'metadata', undefined, 'metadata'), 'metadata');
  assert.equal(cache.get('https://example.test'), 'fresh');
}

(async () => {
  await pools(); await extraction(); await cache();
  console.log('Worker lifecycle, extraction ownership, recovery retry and cache-mode checks passed.');
})().catch(error => { console.error(error); process.exitCode = 1; });
