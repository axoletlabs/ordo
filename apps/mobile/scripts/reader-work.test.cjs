/** Run with: node --test apps/mobile/scripts/reader-work.test.cjs
 *
 * Actual-source tests for the reader work scheduler. The real reader-work.ts
 * runs against a controllable idle-work boundary so the test can observe one
 * queued job per idle/paint opportunity, FIFO order, cancellation, scroll
 * pause/resume, enqueueing from a running job, and dispose.
 */
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const { test } = require("node:test");
const ts = require("typescript");

const sourceRoot = process.env.ORDO_CONTROL_SOURCE_ROOT ?? resolve(__dirname, "../src");

function loadScheduler(idleImplementation) {
  const idleTasks = [];
  let nextId = 1;
  const scheduleIdleWork = (work) => {
    const task = { id: nextId++, work, cancelled: false, ran: false };
    idleTasks.push(task);
    return () => { task.cancelled = true; };
  };
  const source = readFileSync(resolve(sourceRoot, "components/reader/reader-work.ts"), "utf8");
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  });
  const module = { exports: {} };
  const localRequire = (name) => {
    if (name === "../../lib/idle-work") return { scheduleIdleWork: idleImplementation ?? scheduleIdleWork };
    return require(name);
  };
  new Function("require", "module", "exports", outputText)(localRequire, module, module.exports);
  return { scheduler: module.exports.createReaderWorkScheduler(), idleTasks };
}

const liveTasks = (idleTasks) => idleTasks.filter((task) => !task.cancelled && !task.ran);

function runNext(idleTasks) {
  const task = liveTasks(idleTasks)[0];
  assert.ok(task, "one idle task is armed");
  task.ran = true;
  task.work();
}

test("runs one queued job per idle opportunity in FIFO order", () => {
  const { scheduler, idleTasks } = loadScheduler();
  const ran = [];
  scheduler.schedule(() => ran.push("a"));
  scheduler.schedule(() => ran.push("b"));
  scheduler.schedule(() => ran.push("c"));

  assert.equal(liveTasks(idleTasks).length, 1, "all pending jobs share one armed task");
  assert.equal(idleTasks.length, 1, "only the head job starts an idle opportunity");
  runNext(idleTasks);
  assert.deepEqual(ran, ["a"]);
  assert.equal(liveTasks(idleTasks).length, 1, "the next job is armed after a completes");
  assert.equal(idleTasks.length, 2, "each job gets a fresh idle opportunity");
  runNext(idleTasks);
  assert.deepEqual(ran, ["a", "b"]);
  assert.equal(liveTasks(idleTasks).length, 1);
  runNext(idleTasks);
  assert.deepEqual(ran, ["a", "b", "c"]);
  assert.equal(liveTasks(idleTasks).length, 0);
});

test("the real idle boundary yields a new animation frame between queued jobs", () => {
  const names = ["requestAnimationFrame", "cancelAnimationFrame", "requestIdleCallback", "cancelIdleCallback"];
  const original = Object.fromEntries(names.map(name => [name, globalThis[name]]));
  const frames = new Map(), idle = new Map();
  let id = 0;
  globalThis.requestAnimationFrame = callback => { frames.set(++id, callback); return id; };
  globalThis.cancelAnimationFrame = token => frames.delete(token);
  globalThis.requestIdleCallback = callback => { idle.set(++id, callback); return id; };
  globalThis.cancelIdleCallback = token => idle.delete(token);
  const source = readFileSync(resolve(sourceRoot, "lib/idle-work.ts"), "utf8");
  const module = { exports: {} };
  new Function("module", "exports", ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText)(module, module.exports);
  const { scheduler } = loadScheduler(module.exports.scheduleIdleWork);
  const run = queue => {
    const [token, callback] = queue.entries().next().value;
    queue.delete(token);
    callback();
  };
  const ran = [];
  try {
    scheduler.schedule(() => ran.push("a"));
    scheduler.schedule(() => ran.push("b"));
    assert.equal(frames.size, 1);
    run(frames);
    assert.equal(idle.size, 1);
    run(idle);
    assert.deepEqual(ran, ["a"]);
    assert.equal(idle.size, 0, "the second job cannot share the current idle deadline");
    assert.equal(frames.size, 1, "React gets another frame before the second idle callback");
    run(frames);
    run(idle);
    assert.deepEqual(ran, ["a", "b"]);
  } finally {
    scheduler.dispose();
    for (const name of names) {
      if (original[name] === undefined) delete globalThis[name];
      else globalThis[name] = original[name];
    }
  }
});

test("dedupes the same work and canceling the head arms the next job", () => {
  const { scheduler, idleTasks } = loadScheduler();
  const ran = [];
  const shared = () => ran.push("shared");
  const cancelFirst = scheduler.schedule(shared);
  const cancelSecond = scheduler.schedule(shared);
  assert.equal(idleTasks.length, 1, "the callback is queued once");
  assert.equal(liveTasks(idleTasks).length, 1);

  cancelSecond();
  assert.equal(liveTasks(idleTasks).length, 0);
  assert.deepEqual(ran, []);
  cancelFirst();

  const cancelA = scheduler.schedule(() => ran.push("a"));
  scheduler.schedule(() => ran.push("b"));
  cancelA();
  assert.equal(liveTasks(idleTasks).length, 1, "canceling the head arms the next job");
  runNext(idleTasks);
  assert.deepEqual(ran, ["b"]);
  assert.equal(liveTasks(idleTasks).length, 0);
});

test("a running job can cancel queued work and enqueue the next job", () => {
  const { scheduler, idleTasks } = loadScheduler();
  const ran = [];
  let cancelB = () => {};
  scheduler.schedule(() => {
    ran.push("a");
    cancelB();
    scheduler.schedule(() => ran.push("c"));
  });
  cancelB = scheduler.schedule(() => ran.push("b"));
  assert.equal(liveTasks(idleTasks).length, 1);

  runNext(idleTasks);
  assert.deepEqual(ran, ["a"], "the running job canceled b");
  assert.equal(liveTasks(idleTasks).length, 1, "work enqueued during a job is armed after it");
  runNext(idleTasks);
  assert.deepEqual(ran, ["a", "c"]);
  assert.equal(liveTasks(idleTasks).length, 0);
});

test("an old cancellation cannot remove a new turn of the same callback", () => {
  const { scheduler, idleTasks } = loadScheduler();
  let runs = 0;
  const work = () => { runs++; };
  const cancelOld = scheduler.schedule(work);
  runNext(idleTasks);
  scheduler.schedule(work);
  cancelOld();
  assert.equal(liveTasks(idleTasks).length, 1, "the cancellation belongs to its original queue entry");
  runNext(idleTasks);
  assert.equal(runs, 2);
});

test("a throwing job still arms the next queued job", () => {
  const { scheduler, idleTasks } = loadScheduler();
  const ran = [];
  const failure = new Error("work failed");
  scheduler.schedule(() => { throw failure; });
  scheduler.schedule(() => ran.push("b"));
  assert.throws(() => runNext(idleTasks), (error) => error === failure);
  assert.equal(liveTasks(idleTasks).length, 1, "the next job was armed in the finally path");
  runNext(idleTasks);
  assert.deepEqual(ran, ["b"]);
});

test("scroll pause cancels the armed job and resume re-arms FIFO one at a time", () => {
  const { scheduler, idleTasks } = loadScheduler();
  const ran = [];
  try {
    scheduler.schedule(() => ran.push("a"));
    scheduler.schedule(() => ran.push("b"));
    assert.equal(liveTasks(idleTasks).length, 1);

    scheduler.scrolling();
    assert.equal(liveTasks(idleTasks).length, 0, "the armed idle task is canceled");
    assert.equal(ran.length, 0);

    scheduler.resume();
    assert.equal(liveTasks(idleTasks).length, 1, "resume arms only the head");
    runNext(idleTasks);
    assert.deepEqual(ran, ["a"]);
    assert.equal(liveTasks(idleTasks).length, 1);
    runNext(idleTasks);
    assert.deepEqual(ran, ["a", "b"]);
    assert.equal(liveTasks(idleTasks).length, 0);
  } finally {
    scheduler.dispose();
  }
});

test("dispose drops armed and queued work", () => {
  const { scheduler, idleTasks } = loadScheduler();
  const ran = [];
  try {
    scheduler.schedule(() => ran.push("a"));
    scheduler.schedule(() => ran.push("b"));
    assert.equal(liveTasks(idleTasks).length, 1);
    scheduler.dispose();
    assert.equal(liveTasks(idleTasks).length, 0);
    assert.equal(ran.length, 0);
  } finally {
    scheduler.dispose();
  }
});
