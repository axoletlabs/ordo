/** Regression checks for implicit state machines in src/lib and src/store:
 * reminder armed/fired persistence under concurrency, handler bootstrap
 * recovery, corrupt delete-journal salvage, and connectivity init idempotency.
 *
 * Runs with plain node (see other scripts/*.cjs): TypeScript is transpiled per
 * module and loaded in a vm with the same dependency mocks the app uses.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const tick = () => new Promise(resolve => setImmediate(resolve));
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

function loader(mocks) {
  const cache = new Map();
  function load(file) {
    if (cache.has(file)) return cache.get(file);
    const exports = {};
    cache.set(file, exports);
    const source = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    vm.runInNewContext(source, {
      exports, console, queueMicrotask,
      setTimeout: (callback, ms) => setTimeout(callback, ms), clearTimeout,
      requestAnimationFrame: callback => queueMicrotask(callback),
      require: name => Object.hasOwn(mocks, name) ? mocks[name] : name.startsWith('.')
        ? load(path.resolve(path.dirname(file), `${name}.ts`)) : require(name),
    }, { filename: file });
    return exports;
  }
  return name => load(path.resolve(__dirname, `../src/${name}.ts`));
}

const SHARED = {
  unixSeconds: value => Math.floor((value instanceof Date ? value.getTime() : value) / 1000),
  reminderStatus: () => 'upcoming',
};

function notificationMock(overrides = {}) {
  return {
    setNotificationHandler() {},
    setNotificationChannelAsync: async () => {},
    setNotificationCategoryAsync: async () => {},
    getPresentedNotificationsAsync: async () => [],
    getAllScheduledNotificationsAsync: async () => [],
    getPermissionsAsync: async () => ({ granted: true, status: 'granted' }),
    requestPermissionsAsync: async () => ({ granted: true, status: 'granted' }),
    scheduleNotificationAsync: async () => 'scheduled',
    cancelScheduledNotificationAsync: async () => {},
    dismissNotificationAsync: async () => {},
    addNotificationReceivedListener: () => ({ remove() {} }),
    addNotificationResponseReceivedListener: () => ({ remove() {} }),
    getLastNotificationResponseAsync: async () => null,
    clearLastNotificationResponseAsync: async () => {},
    DEFAULT_ACTION_IDENTIFIER: 'expo.modules.notifications.actions.DEFAULT',
    AndroidImportance: { HIGH: 4 },
    AndroidNotificationVisibility: { PUBLIC: 1 },
    SchedulableTriggerInputTypes: { DATE: 'date', CALENDAR: 'calendar' },
    ...overrides,
  };
}

function reminderMocks({ readDelay = 0, scheduleDelay = 0, notifications, packageName = 'com.ordo.test' } = {}) {
  const prefs = new Map();
  const scheduled = [];
  const notif = notifications ?? notificationMock({
    scheduleNotificationAsync: async request => {
      // A slow OS handoff keeps both overlapping syncs inside presentDue, the
      // same window a live channel/scheduler opens.
      if (scheduleDelay > 0) await delay(scheduleDelay);
      scheduled.push(request);
      return request.identifier;
    },
  });
  return {
    prefs, scheduled, notif,
    load: loader({
      'react-native': { Platform: { OS: 'android', Version: 33 } },
      '@ordo/shared': SHARED,
      'expo-notifications': notif,
      './storage': {
        StorageKeys: {
          REMINDER_FIRED: 'ordo.reminderFired',
          REMINDER_ARMED: 'ordo.reminderArmed',
          REMINDER_ACTIONS_REV: 'ordo.reminderActionsRev',
          REMINDER_EXACT_ALARM_ASKED: 'ordo.reminderExactAlarmAsked',
        },
        prefsGet: async key => {
          if (readDelay > 0) await delay(readDelay);
          const raw = prefs.get(key);
          return raw == null ? null : JSON.parse(raw);
        },
        prefsSet: async (key, value) => {
          prefs.set(key, JSON.stringify(value));
        },
      },
      './app-variant': { APP_IDENTITY: { package: packageName } },
      'expo-intent-launcher': { startActivityAsync: async () => ({}) },
    }),
  };
}

async function reminderConcurrencyTest() {
  // Slow reads keep first syncs overlapping the way a launch reconcile races
  // fire-and-forget syncs from mutations.
  const { prefs, scheduled, load } = reminderMocks({ readDelay: 12, scheduleDelay: 5 });
  const { syncBookmarkReminder } = load('lib/reminder-notifications');
  const now = Math.floor(Date.now() / 1000);
  const rows = [
    { id: 'bookmark-a', title: 'A', remindAt: now - 5 },
    { id: 'bookmark-b', title: 'B', remindAt: now - 6 },
  ];
  await Promise.all(rows.map(row => syncBookmarkReminder(row)));

  const fired = JSON.parse(prefs.get('ordo.reminderFired') ?? '{}');
  assert.deepEqual(
    Object.keys(fired).sort(),
    ['bookmark-a', 'bookmark-b'],
    'concurrent syncs persist both fired markers',
  );
  assert.equal(fired['bookmark-a'], rows[0].remindAt);
  assert.equal(fired['bookmark-b'], rows[1].remindAt);
  assert.deepEqual(
    scheduled.map(request => request.identifier).sort(),
    ['ordo-reminder:bookmark-a', 'ordo-reminder:bookmark-b'],
    'each due reminder is presented',
  );

  // Two overlapping syncs of the same due row (reconcile + mutation success)
  // must not present the banner twice. Warm the handler/maps first so both
  // enter presentation together, like a running app rather than launch.
  await syncBookmarkReminder({ id: 'warmup', title: 'Warm-up', remindAt: null });
  const shared = { id: 'bookmark-c', title: 'C', remindAt: now - 7 };
  await Promise.all([syncBookmarkReminder(shared), syncBookmarkReminder(shared)]);
  const presentedC = scheduled.filter(request => request.identifier === 'ordo-reminder:bookmark-c');
  assert.equal(presentedC.length, 1, 'overlapping syncs present one banner per reminder');
  assert.equal(
    JSON.parse(prefs.get('ordo.reminderFired') ?? '{}')['bookmark-c'],
    shared.remindAt,
  );
}

async function reminderHandlerRecoveryTest() {
  let channelCalls = 0;
  let failNextChannel = true;
  const { load } = reminderMocks({
    notifications: notificationMock({
      setNotificationChannelAsync: async () => {
        channelCalls += 1;
        if (failNextChannel) {
          failNextChannel = false;
          throw new Error('channel setup failed');
        }
      },
    }),
  });
  const { syncBookmarkReminder } = load('lib/reminder-notifications');
  const now = Math.floor(Date.now() / 1000);

  // A native channel failure is best effort: the sync must settle, and the
  // next call must retry the channel instead of considering setup finished.
  assert.equal(await syncBookmarkReminder({ id: 'first', title: 'First', remindAt: now - 5 }), true);
  assert.equal(await syncBookmarkReminder({ id: 'second', title: 'Second', remindAt: now - 6 }), true);
  assert.equal(channelCalls, 2, 'failed channel setup is retried on the next call');
}

async function reminderCancellationTest() {
  let release;
  let started;
  const gate = new Promise(resolve => { release = resolve; });
  const ready = new Promise(resolve => { started = resolve; });
  const active = new Map();
  const { load } = reminderMocks({ notifications: notificationMock({
    scheduleNotificationAsync: async request => {
      started();
      await gate;
      active.set(request.identifier, request);
      return request.identifier;
    },
    getAllScheduledNotificationsAsync: async () => [...active.values()],
    cancelScheduledNotificationAsync: async id => { active.delete(id); },
    dismissNotificationAsync: async id => { active.delete(id); },
  }) });
  const { syncBookmarkReminder, cancelBookmarkReminder } = load('lib/reminder-notifications');
  const syncing = syncBookmarkReminder({ id: 'cancelled', title: 'Cancelled', remindAt: Math.floor(Date.now() / 1000) + 600 });
  await ready;
  const cancelling = cancelBookmarkReminder('cancelled');
  release();
  await Promise.all([syncing, cancelling]);
  assert.equal(active.size, 0, 'a late OS schedule cannot recreate a cancelled reminder');
}

async function deleteJournalTest() {
  const journalKey = 'ordo.rq.user.https%3A%2F%2Fordo.example.deletes.v1';
  const storage = new Map();
  const mmkv = {
    getString: key => storage.get(key),
    set: (key, value) => { storage.set(key, value); },
    remove: key => { storage.delete(key); },
  };
  const load = loader({
    'react-native': { Platform: { OS: 'android' } },
    'react-native-mmkv': { createMMKV: () => mmkv },
    '../store/auth': {
      useAuthStore: { getState: () => ({ status: 'authenticated', user: { id: 'user' } }) },
    },
    '../store/settings': {
      useSettingsStore: { getState: () => ({ serverUrl: 'https://ordo.example' }) },
    },
    './query-persist': { queryCacheStorageKey: () => 'ordo.rq.user.https%3A%2F%2Fordo.example' },
  });
  const { readDeleteIntents, recordDeleteIntent, deleteJournalKey } = load('lib/delete-journal');
  assert.equal(deleteJournalKey(), journalKey);

  storage.set(journalKey, '{not json');
  assert.deepEqual([...readDeleteIntents(journalKey)], [], 'corrupt bytes must not brick the journal');
  assert.equal(storage.get(journalKey), '[]', 'corrupt journal is reset for the next write');

  const recorded = recordDeleteIntent({
    bookmarks: [{ id: 'bookmark', folderId: null }],
    folders: [],
    tags: [],
    contained: [],
  });
  assert.equal(recorded.key, journalKey);
  assert.deepEqual(Array.from(readDeleteIntents(journalKey), entry => entry.id), [recorded.intent.id]);

  // Structured damage: keep the entries that still validate.
  storage.set(journalKey, JSON.stringify([
    { id: 'valid', bookmarks: [{ id: 'kept', folderId: 'folder' }], folders: [], tags: [], contained: [] },
    { id: 42 },
    'garbage',
  ]));
  const salvaged = readDeleteIntents(journalKey);
  assert.deepEqual(Array.from(salvaged, entry => entry.id), ['valid']);
  assert.equal(storage.get(journalKey), JSON.stringify(salvaged), 'valid intents are rewritten');
}

async function onlineInitTest() {
  let listeners = 0;
  const load = loader({
    'zustand': require('zustand'),
    '@tanstack/react-query': { onlineManager: { setOnline() {} } },
    'expo-network': {
      getNetworkStateAsync: async () => ({ isConnected: true, isInternetReachable: true }),
      addNetworkStateListener: () => { listeners += 1; },
    },
    './network-state': { networkStateIsOnline: () => true },
  });
  const { useOnlineStore } = load('lib/online');
  await Promise.all([useOnlineStore.getState().init(), useOnlineStore.getState().init()]);
  await useOnlineStore.getState().init();
  assert.equal(listeners, 1, 'connectivity listener is subscribed once per process');
  assert.equal(useOnlineStore.getState().online, true);
}

(async () => {
  await reminderConcurrencyTest();
  await reminderHandlerRecoveryTest();
  await reminderCancellationTest();
  await deleteJournalTest();
  await onlineInitTest();
  await tick();
  console.log('Core state machine checks passed.');
})().catch(error => { console.error(error); process.exitCode = 1; });
