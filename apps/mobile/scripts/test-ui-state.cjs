/** Regression checks for UI state ownership around async work:
 * - a second server-switch tap while the first commit is in flight,
 * - a failed runtime reload leaving the switch stuck busy,
 * - a late storage read reopening or replacing an import job,
 * - a double-tapped reminder write,
 * - the Quick Save retry outcome for a non-401 server error.
 *
 * Plain node like the other scripts/*.cjs checks: TypeScript/TSX is transpiled
 * per module and loaded in a vm with the same dependency mocks the app uses.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const tick = () => new Promise(resolve => setImmediate(resolve));

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function sameDeps(a, b) {
  return Boolean(a && b && a.length === b.length && a.every((value, index) => Object.is(value, b[index])));
}

/**
 * Minimal single-component hook runtime: enough for useState/useRef/useMemo and
 * effects. State writes re-render on a microtask, so a test can keep a closure
 * from an earlier render (the double-tap case) and still read latest values.
 */
function createHarness() {
  const state = [];
  const refs = [];
  const memo = new Map();
  const effectDeps = new Map();
  const effectCleanups = new Map();
  const queued = [];
  let cursor = 0;
  let rendering = false;
  let scheduled = false;
  let renderFn = null;
  let result = null;

  const react = {
    Fragment: Symbol.for('react.fragment'),
    createElement: (type, props, ...children) => ({ type, props: props ?? {}, children }),
    useState(initial) {
      const index = cursor++;
      if (!(index in state)) state[index] = typeof initial === 'function' ? initial() : initial;
      const set = next => {
        const value = typeof next === 'function' ? next(state[index]) : next;
        if (Object.is(value, state[index])) return;
        state[index] = value;
        schedule();
      };
      return [state[index], set];
    },
    useRef(initial) {
      const index = cursor++;
      if (!(index in refs)) refs[index] = { current: initial };
      return refs[index];
    },
    useMemo(fn, deps) {
      const index = cursor++;
      const slot = memo.get(index);
      if (slot && sameDeps(slot.deps, deps)) return slot.value;
      const value = fn();
      memo.set(index, { deps, value });
      return value;
    },
    useEffect(fn, deps) { queue(fn, deps); },
    useLayoutEffect(fn, deps) { queue(fn, deps); },
    useCallback(fn) { return fn; },
  };
  react.default = react;

  function queue(fn, deps) {
    const index = cursor++;
    if (effectDeps.has(index) && deps && sameDeps(effectDeps.get(index), deps)) return;
    queued.push({ index, fn, deps });
  }

  function commit() {
    for (const entry of queued.splice(0)) {
      const cleanup = effectCleanups.get(entry.index);
      if (cleanup) { cleanup(); effectCleanups.delete(entry.index); }
      const next = entry.fn();
      if (typeof next === 'function') effectCleanups.set(entry.index, next);
      effectDeps.set(entry.index, entry.deps);
    }
  }

  function render() {
    rendering = true;
    cursor = 0;
    result = renderFn();
    rendering = false;
    commit();
    return result;
  }

  function schedule() {
    if (rendering || scheduled) return;
    scheduled = true;
    queueMicrotask(() => { scheduled = false; render(); });
  }

  return {
    react,
    render,
    setRender(fn) { renderFn = fn; },
    get result() { return result; },
  };
}

function loader(react, mocks) {
  const cache = new Map();
  const table = { react, ...mocks };
  function resolveFile(base) {
    for (const candidate of [`${base}.ts`, `${base}.tsx`, `${base}.js`]) {
      if (fs.existsSync(candidate)) return candidate;
    }
    throw new Error(`Cannot resolve module: ${base}`);
  }
  function load(file) {
    if (cache.has(file)) return cache.get(file);
    const exports = {};
    cache.set(file, exports);
    const source = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        jsx: ts.JsxEmit.React,
      },
    }).outputText;
    vm.runInNewContext(source, {
      exports, console, queueMicrotask,
      setTimeout: (callback, ms) => setTimeout(callback, ms), clearTimeout,
      requestAnimationFrame: callback => queueMicrotask(callback),
      require: name => Object.hasOwn(table, name)
        ? table[name]
        : name.startsWith('.')
          ? load(resolveFile(path.resolve(path.dirname(file), name)))
          : require(name),
    }, { filename: file });
    return exports;
  }
  return name => load(resolveFile(path.resolve(__dirname, `../src/${name}`)));
}

function findElement(node, predicate) {
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findElement(child, predicate);
      if (found) return found;
    }
    return null;
  }
  if (!node || typeof node !== 'object' || !('type' in node)) return null;
  if (predicate(node)) return node;
  for (const child of node.children ?? []) {
    const found = findElement(child, predicate);
    if (found) return found;
  }
  return null;
}

async function serverSwitchTests() {
  const replaced = [];
  const notices = [];
  const toasts = [];
  let commits = 0;
  let pending = deferred();

  const harness = createHarness();
  const load = loader(harness.react, {
    'expo-router': { useRouter: () => ({ replace: to => replaced.push(to) }) },
    '../lib/commit-server-switch': {
      commitServerSwitch: () => { commits += 1; return pending.promise; },
    },
    '../lib/hosting': { isCloudServerUrl: url => url === 'https://cloud.example' },
    '../store/settings': { useSettingsStore: { getState: () => ({ serverUrl: 'https://self.example' }) } },
    '../components/ui/toast-store': {
      toast: { success: message => toasts.push(message), error: message => notices.push(message) },
    },
  });
  const { useCommitServerSwitch } = load('hooks/use-commit-server-switch');
  harness.setRender(() => useCommitServerSwitch());
  harness.render();

  // Two taps can land before the disabled action re-renders.
  const firstAttempt = harness.result.commit('https://other.example');
  const secondAttempt = harness.result.commit('https://other.example');
  assert.equal(commits, 1, 'a second tap must not start a second server commit');
  assert.equal(await secondAttempt, false);

  // The commit landed but the runtime reload failed. The switch reports a
  // restart, yet the screen must not stay disabled forever.
  pending.resolve({ ok: true, restarted: true });
  assert.equal(await firstAttempt, true);
  await tick();
  assert.deepEqual(replaced, ['/(auth)/login'], 'a committed switch sends the user to sign in');
  assert.equal(harness.result.busy, false, 'a failed reload cannot leave the switch stuck busy');
  assert.deepEqual(toasts, ['Server changed']);

  // The next attempt is allowed, and a refused switch clears busy again.
  pending = deferred();
  const third = harness.result.commit('https://other.example');
  assert.equal(commits, 2, 'the hook accepts another attempt after the failed reload');
  pending.resolve({ ok: false });
  assert.equal(await third, false);
  await tick();
  assert.equal(harness.result.busy, false, 'a refused switch is retryable');
  assert.deepEqual(notices, ["Couldn't change server."]);

  // An unexpected throw (for example a failed settings write) releases the
  // action instead of rejecting into an unhandled caller.
  pending = deferred();
  const fourth = harness.result.commit('https://other.example');
  pending.reject(new Error('storage failed'));
  assert.equal(await fourth, false);
  await tick();
  assert.equal(harness.result.busy, false, 'a thrown commit is retryable');
  assert.deepEqual(notices, ["Couldn't change server.", "Couldn't change server."]);
}

async function importHydrationTests() {
  function setup(job) {
    const read = deferred();
    const uploaded = deferred();
    const uploads = [];
    const cancelled = [];
    const queryCalls = [];
    const commits = [];
    const FloatingPanel = () => null;
    const SettingRow = () => null;
    const passthrough = () => null;
    const harness = createHarness();
    const load = loader(harness.react, {
      'react-native': { StyleSheet: { create: value => value }, View: passthrough },
      'expo-document-picker': {
        getDocumentAsync: async () => ({
          canceled: false,
          assets: [{ uri: 'file:///import.json', name: 'import.json', size: 32 }],
        }),
      },
      '@tanstack/react-query': {
        useQueryClient: () => ({ invalidateQueries: () => {}, setQueryData: () => {} }),
        useQuery: options => {
          queryCalls.push(options);
          return { data: job, isError: false, error: null, refetch: () => {} };
        },
      },
      '../../hooks/use-session-mutation': {
        useSessionMutation: options => ({ mutate: () => commits.push(options), isPending: false }),
      },
      '@ordo/shared': {
        IMPORT_EXPORT: { MAX_FILE_BYTES: 1024 },
        normalizeImportPreview: preview => preview,
      },
      '../ui/FloatingPanel': { FloatingPanel },
      '../ui/AnimatedDisclosure': { AnimatedDisclosure: passthrough },
      '../ui/ThemedScrollView': { ThemedScrollView: passthrough },
      '../ui/PanelHeader': { PanelHeader: passthrough },
      '../ui/Spinner': { Spinner: passthrough },
      '../ui/SettingRow': { SettingRow },
      './SettingsPage': { SettingsGroup: passthrough },
      '../ui/Segmented': { Segmented: passthrough },
      '../ui/Toggle': { Toggle: passthrough },
      '../ui/Button': { Button: passthrough },
      '../ui/Text': { Text: passthrough },
      '../ui/SheetActionRow': { PanelActions: passthrough },
      '../ui/toast-store': { toast: { success: () => {}, error: () => {} } },
      '../../lib/api/import-export': {
        importExportApi: {
          uploadImport: () => { const next = uploads.length === 0 ? uploaded : deferred(); uploads.push(next); return next.promise; },
          getImport: async () => { throw new Error('not used'); },
          commitImport: async () => { throw new Error('not used'); },
          cancelImport: async id => { cancelled.push(id); },
        },
      },
      '../../lib/api/query-keys': {
        qk: { importJob: id => `import:${id}`, folders: 'folders', extractionProgress: 'progress' },
      },
      '../../lib/storage': {
        StorageKeys: { IMPORT_JOB: 'ordo.importJob' },
        prefsGet: () => read.promise,
        prefsSet: async () => {},
        prefsDelete: async () => {},
      },
      '../../lib/error-message': { errorMessage: (_error, fallback) => fallback },
      '../../lib/copy': { importedToast: () => '' },
      '../../lib/haptics': { haptics: { success: () => {} } },
      '../../theme/ThemeProvider': { useTheme: () => ({ palette: {} }) },
      '../../theme/tokens': { radius: { lg: 0 }, spacing: {} },
    });
    const { ImportFlow } = load('components/settings/ImportFlow');
    harness.setRender(() => ImportFlow({ folders: [], tokenFor: () => null, onUnlock: () => {} }));
    harness.render();
    return { harness, read, uploaded, uploads, cancelled, queryCalls, commits, FloatingPanel, SettingRow };
  }

  // A slow restore must not replace a job the user just started.
  {
    const { harness, read, uploaded, queryCalls, FloatingPanel, SettingRow } = setup();
    const row = findElement(harness.result, node => node.type === SettingRow && node.props.label === 'Import from file');
    assert.ok(row, 'the import row is rendered');
    void row.props.onPress();
    await tick();
    assert.equal(findElement(harness.result, node => node.type === FloatingPanel).props.visible, true, 'the upload panel opens');

    read.resolve('old-job');
    await tick();
    assert.equal(
      queryCalls.at(-1).queryKey,
      'import:none',
      'a late restore must not point the panel at the previous job',
    );
    assert.equal(findElement(harness.result, node => node.type === FloatingPanel).props.visible, true);

    uploaded.resolve({ jobId: 'new-job' });
    await tick();
    assert.equal(queryCalls.at(-1).queryKey, 'import:new-job', 'the uploaded job owns the panel');
  }

  // A normal mount still resumes the saved job.
  {
    const { harness, read, queryCalls, FloatingPanel } = setup();
    read.resolve('saved-job');
    await tick();
    assert.equal(queryCalls.at(-1).queryKey, 'import:saved-job', 'a saved job is restored on mount');
    assert.equal(findElement(harness.result, node => node.type === FloatingPanel).props.visible, true);
  }

  // Dismissing then picking again transfers ownership before the first upload
  // returns. Its late result must be cancelled, never replace the new job.
  {
    const { harness, uploaded, uploads, cancelled, queryCalls, FloatingPanel, SettingRow } = setup();
    const pick = () => findElement(harness.result, node => node.type === SettingRow).props.onPress();
    void pick();
    void pick();
    await tick();
    assert.equal(uploads.length, 1, 'one picker/upload owns the attempt');
    findElement(harness.result, node => node.type === FloatingPanel).props.onDismiss();
    await tick();
    void pick();
    await tick();
    uploads[1].resolve({ jobId: 'second-upload' });
    await tick();
    uploaded.resolve({ jobId: 'abandoned-upload' });
    await tick();
    assert.equal(queryCalls.at(-1).queryKey, 'import:second-upload');
    assert.deepEqual(cancelled, ['abandoned-upload']);
  }

  // Confirm owns the flow before React renders its pending state. A same-frame
  // dismiss must not forget or cancel that commit and permit a second upload.
  {
    const { harness, read, commits, cancelled, queryCalls, FloatingPanel } = setup({
      id: 'ready-job', status: 'ready', preview: { lockedFolderMatches: [] },
    });
    read.resolve('ready-job');
    await tick();
    const preview = findElement(harness.result, node => typeof node.props.onConfirm === 'function');
    const panel = findElement(harness.result, node => node.type === FloatingPanel);
    preview.props.onConfirm();
    preview.props.onConfirm();
    panel.props.onDismiss();
    await tick();
    assert.equal(commits.length, 1, 'one confirm owns the commit');
    assert.deepEqual(cancelled, [], 'a same-frame dismiss cannot cancel a claimed commit');
    assert.equal(queryCalls.at(-1).queryKey, 'import:ready-job');
    assert.equal(findElement(harness.result, node => node.type === FloatingPanel).props.visible, true);
    commits[0].onSettled();
    panel.props.onDismiss();
    await tick();
    assert.equal(findElement(harness.result, node => node.type === FloatingPanel).props.visible, false, 'a settled commit can be dismissed');
  }
}

async function reminderTapTests() {
  const calls = [];
  const dismissed = [];
  const toasts = [];
  const harness = createHarness();
  const load = loader(harness.react, {
    '../ui/MaterialIcon': { MaterialIcon: () => null },
    '@ordo/shared': {},
    '../ui/ContextMenu': { ContextMenu: () => null, ContextMenuItem: () => null },
    '../../hooks/use-bookmarks': {
      useSetBookmarkReminder: () => ({
        mutate: (variables, options) => { calls.push({ variables, options }); },
        isPending: false,
      }),
    },
    '../../lib/overlay-session-mode': { useOverlaySessionMode: (_visible, initial) => [initial, () => {}] },
    '../../lib/error-message': { errorMessage: (_error, fallback) => fallback },
    '../ui/toast-store': { toast: { success: message => toasts.push(message), error: message => toasts.push(message) } },
    '../../lib/bookmark-reminders': {
      REMINDER_PRESETS: [],
      reminderClearedToast: () => 'cleared',
      reminderPresetAt: () => 0,
      reminderPresetDetail: () => '',
      reminderSetToast: () => 'set',
    },
    './ReminderCustomPanel': { ReminderCustomPanel: () => null },
    '../../lib/menu-anchor': { CONTEXT_MENU_WIDTH: 200 },
  });
  const { useSaveReminder } = load('components/bookmarks/ReminderFlow');
  const bookmark = {
    id: 'bookmark',
    folderId: null,
    title: 'Bookmark',
    domain: 'example.com',
    description: null,
    remindAt: null,
  };
  harness.setRender(() => useSaveReminder(bookmark, () => dismissed.push(true), true));
  harness.render();

  const now = Math.floor(Date.now() / 1000);
  harness.result.save(now + 60);
  harness.result.save(now + 120);
  assert.equal(calls.length, 1, 'a second tap must not send a second reminder write');

  calls[0].options.onSettled();
  harness.result.save(now + 180);
  assert.equal(calls.length, 2, 'the next write is allowed once the first settles');

  calls[1].options.onSuccess({ ...bookmark, remindAt: now + 180 });
  assert.equal(dismissed.length, 1, 'the owning menu closes once');
  assert.deepEqual(toasts, ['set']);
}

function quickSaveOutcomeTest() {
  const source = require('../plugins/quick-share-save-kotlin')('com.ordo.test');
  const start = source.indexOf('private fun saveUrl(');
  const end = source.indexOf('private fun needsRefresh(');
  assert.ok(start > 0 && end > start, 'saveUrl is present');
  const saveUrl = source.slice(start, end);

  // Anything else after the retry (a 5xx, a timeout) is retryable in the sheet.
  const afterRetry = saveUrl.slice(saveUrl.indexOf('val retried'));
  assert.doesNotMatch(
    afterRetry,
    /created == 401/,
    'a retried server error must fall back instead of reporting a dead session',
  );
  assert.match(afterRetry, /return Outcome\.FALLBACK/);
  // A token refreshed moments before the request still failed: the session is
  // dead, and no further refresh should be attempted.
  assert.match(saveUrl, /if \(usedRefresh\) return Outcome\.AUTH/);
  // The retried request may only report AUTH on its own 401.
  assert.match(saveUrl, /if \(retried == 401\) return Outcome\.AUTH/);
}

async function lockPromptTests() {
  let unlocks = 0;
  let unlocked = 0;
  const Button = () => null;
  const Input = () => null;
  const passthrough = () => null;
  const harness = createHarness();
  const load = loader(harness.react, {
    'react-native': { Platform: { OS: 'ios' }, StyleSheet: { create: value => value }, View: passthrough },
    'expo-router': { useFocusEffect: callback => { callback(); } },
    '@ordo/shared': { TOKEN_TTL: { FOLDER_MS: 600_000 } },
    '../ui/FloatingPanel': { FloatingPanel: passthrough },
    '../ui/PanelHeader': { PanelHeader: passthrough },
    '../ui/Input': { Input },
    '../ui/AutofillForm': { AutofillForm: passthrough },
    '../ui/Button': { Button },
    '../ui/Text': { Text: passthrough },
    '../ui/EyeToggle': { EyeToggle: passthrough },
    '../ui/Segmented': { Segmented: passthrough },
    '../ui/OtpInput': { OtpInput: passthrough },
    '../ui/SheetActionRow': { PanelActions: passthrough, sheetMenuStyles: { cancel: {} } },
    './PatternInput': { PatternInput: passthrough },
    '../../hooks/use-keyboard-visible': { dismissKeyboard: () => {} },
    '../../hooks/use-folders': {
      useUnlockFolder: () => ({
        mutateAsync: async () => { unlocks += 1; },
        isPending: false,
      }),
    },
    '../../lib/device-folder-lock': { getDeviceLockCredential: async () => null },
    '../../lib/error-message': { errorMessage: (_error, fallback) => fallback },
    '../../lib/haptics': { haptics: { success: () => {}, error: () => {} } },
    '../../theme/tokens': { spacing: {} },
    '../../lib/password-autofill': { localPasswordAutofillProps: {} },
  });
  const { UnlockForm } = load('components/bookmarks/LockPrompt');
  harness.setRender(() => UnlockForm({ folderId: 'folder', lockType: 'password', onUnlocked: () => { unlocked += 1; } }));
  harness.render();

  const field = findElement(harness.result, node => node.type === Input && node.props.label === 'Password');
  assert.ok(field, 'the password field is rendered');
  field.props.onChangeText('secret');
  await tick();

  const unlock = findElement(harness.result, node => node.type === Button && node.props.label === 'Unlock');
  assert.ok(unlock, 'the unlock action is rendered');
  // Two taps land before React Query can report the first as pending.
  unlock.props.onPress();
  unlock.props.onPress();
  await tick();
  assert.equal(unlocks, 1, 'a second tap must not send a second unlock request');
  assert.equal(unlocked, 1, 'the folder is reported unlocked once');
}

(async () => {
  await serverSwitchTests();
  await importHydrationTests();
  await reminderTapTests();
  await lockPromptTests();
  quickSaveOutcomeTest();
  console.log('UI state ownership, import hydration, reminder write and Quick Save outcome checks passed.');
})().catch(error => { console.error(error); process.exitCode = 1; });
