import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { loadTypeScript } from './load-typescript.mjs';

const rules = loadTypeScript('../src/lib/browser-ad-blocking.ts');
const { AD_HOSTS, adBlockSiteHost, normalizeAdBlockAllowedHosts, browserAdBlockingRules } = rules;
const config = JSON.parse(browserAdBlockingRules(true, ['www.publisher.test']));
const appleRules = JSON.parse(config.webKitRules);

const cases = [];
function check(request, top, expected, mainFrame = false) {
  cases.push({ request, top, expected, mainFrame });
}
for (const host of AD_HOSTS) {
  for (const scheme of ['https', 'http']) {
    for (const sub of ['', 'ads.', 'a.b.']) {
      check(`${scheme}://${sub}${host}/banner.js`, 'https://publisher.test/article', true);
      check(`${scheme}://${sub}${host}/banner.js`, 'https://www.publisher.test/article', false);
      check(`${scheme}://${sub}${host}/banner.js`, `https://www.${host}/`, false);
      check(`${scheme}://${sub}${host}/banner.js`, 'https://publisher.test/', false, true);
    }
  }
  check(`https://${host}.publisher.test/banner.js`, 'https://publisher.test/', false);
  check(`https://not${host}/banner.js`, 'https://publisher.test/', false);
  check(`https://${host.toUpperCase()}.:443/banner.js`, 'https://publisher.test/', true);
  check(`https://user:pass@${host}:8443/banner.js`, 'https://publisher.test/', true);
  check(`https://${host}:443/banner.js`, 'https://WWW.PUBLISHER.TEST.:8080/a', false);
}
for (const url of [
  'https://publisher.test/ads/banner.js', 'https://cdn.publisher.test/ad.js',
  'https://accounts.google.com/login', 'https://www.google.com/recaptcha/api.js',
  'https://challenges.cloudflare.com/turnstile/v0/api.js', 'https://js.stripe.com/v3/',
  'https://www.youtube.com/embed/video', 'https://player.vimeo.com/video/1',
  'https://fonts.googleapis.com/css2', 'https://cdn.jsdelivr.net/npm/react',
  'data:text/html,ad', 'blob:https://publisher.test/id', 'file:///doubleclick.net/banner',
  'https://publisher.test/path/doubleclick.net', 'https://doubleclick.net@publisher.test/a',
  '', 'not a URL', 'https:///bad host', 'ftp://doubleclick.net/banner',
]) check(url, 'https://publisher.test/', false);
check('https://ads.doubleclick.net/ad.js', '', false);
check('https://ads.doubleclick.net/ad.js', 'about:blank', false);
check('https://ads.doubleclick.net/ad.js', 'https://publisher.test.evil.test/', true);

function appleBlocks(request, top, mainFrame) {
  if (mainFrame || !adBlockSiteHost(top)) return false;
  return appleRules.some(({ trigger }) => new RegExp(trigger['url-filter'], 'i').test(request)
    && !trigger['unless-top-url'].some((pattern) => new RegExp(pattern, 'i').test(top)));
}

test('WebKit resource rules cover every ad host without matching lookalikes or essential services', () => {
  assert.equal(new Set(AD_HOSTS).size, AD_HOSTS.length);
  assert.deepEqual(config.blockedHosts, AD_HOSTS);
  assert.equal(appleRules.length, AD_HOSTS.length);
  for (const { trigger, action } of appleRules) {
    assert.deepEqual(trigger['load-type'], ['third-party']);
    assert.ok(!trigger['resource-type'].includes('document'));
    assert.equal(action.type, 'block');
  }
  for (const { request, top, mainFrame, expected } of cases) {
    assert.equal(appleBlocks(request, top, mainFrame), expected, `${request} on ${top}`);
  }
});

test('actual Android matcher passes the shared compatibility corpus', () => {
  const temp = mkdtempSync(join(tmpdir(), 'ordo-adblock-test-'));
  try {
    const strings = (values) => values.map((v) => JSON.stringify(v)).join(',');
    const source = `import com.reactnativecommunity.webview.OrdoAdBlocker;
      import java.util.Arrays;
      public class AdBlockTest {
        public static void main(String[] args) {
          OrdoAdBlocker blocker = new OrdoAdBlocker(Arrays.asList(${strings(AD_HOSTS)}), Arrays.asList("www.publisher.test"));
          int passed = 0;
          ${cases.map(({ request, top, expected, mainFrame }) => `
            if (blocker.shouldBlock(${JSON.stringify(request)}, ${JSON.stringify(top)}, ${mainFrame}) != ${expected})
              throw new AssertionError(${JSON.stringify(`${request} on ${top}`)});
            passed++;
          `).join('')}
          if (blocker.shouldBlock(null, null, false)) throw new AssertionError("null input");
          if (OrdoAdBlocker.DISABLED.shouldBlock("https://doubleclick.net/ad", "https://publisher.test/", false)) throw new AssertionError("disabled");
          System.out.println(passed + " native cases passed");
        }
      }`;
    writeFileSync(join(temp, 'AdBlockTest.java'), source);
    execFileSync('javac', ['-d', temp,
      new URL('../../../node_modules/react-native-webview/android/src/main/java/com/reactnativecommunity/webview/OrdoAdBlocker.java', import.meta.url).pathname,
      join(temp, 'AdBlockTest.java')]);
    const output = execFileSync('java', ['-cp', temp, 'AdBlockTest'], { encoding: 'utf8' });
    assert.match(output, new RegExp(`${cases.length} native cases passed`));
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});

test('site extraction and persisted exceptions stay exact and validated', () => {
  assert.equal(adBlockSiteHost('HTTPS://WWW.Example.COM.:8443/path?q=1'), 'www.example.com');
  assert.equal(adBlockSiteHost('https://user:pass@bücher.example/article'), 'xn--bcher-kva.example');
  for (const value of ['', 'data:text/html,a', 'about:blank', 'javascript:alert(1)', 'broken']) {
    assert.equal(adBlockSiteHost(value), null);
  }
  assert.deepEqual(normalizeAdBlockAllowedHosts(['EXAMPLE.com.', 'example.com', 'www.example.com',
    'evil.com/.*', 'https://evil.com', '.*', '.evil.com', 'evil..com', null, 1, 'a'.repeat(254)]),
  ['example.com', 'www.example.com']);
  for (const value of [null, {}, 'example.com', false]) assert.deepEqual(normalizeAdBlockAllowedHosts(value), []);
  assert.equal(browserAdBlockingRules(false, ['example.com']), '');
  assert.deepEqual(normalizeAdBlockAllowedHosts(['[::1]', '127.0.0.1']), ['[::1]', '127.0.0.1']);
  const ipConfig = JSON.parse(browserAdBlockingRules(true, ['[::1]']));
  const ipRule = JSON.parse(ipConfig.webKitRules)[0].trigger['unless-top-url'][1];
  assert.ok(new RegExp(ipRule, 'i').test('http://[::1]:8080/'));
  assert.ok(!new RegExp(ipRule, 'i').test('http://evil.test/'));
});

function settingsFixture(saved) {
  let disk = saved;
  const writes = [];
  const { useSettingsStore } = loadTypeScript('../src/store/settings.ts', {
    '../lib/browser-ad-blocking': rules,
    '../lib/haptics': { setHapticsEnabled() {} },
    '../lib/share-targets': { syncQuickShareFlags() {}, patchQuickShareSessionServerUrl() {} },
    '../lib/hosting': { DEFAULT_SERVER_URL: 'https://ordo.test', resolvePersistedServerUrl: (url) => url ?? 'https://ordo.test', canonicalizeServerUrl: (url) => url },
    '../lib/storage': { StorageKeys: { SETTINGS: 'settings' }, prefsGet: async () => disk,
      prefsSet: async (_, snapshot) => { writes.push(snapshot); disk = snapshot; } },
    '../theme/material-colors': { APP_COLOR: '#006a60' },
    '../theme/app-colors': { normalizeAppColor: (color) => color },
  });
  return { store: useSettingsStore, writes, persisted: () => disk };
}

test('upgrades enable blocking, preserve other preferences, validate saved exceptions', async () => {
  const { store } = settingsFixture({ forceWebsiteDark: true, websiteBrowser: 'external',
    adBlockAllowedHosts: ['EXAMPLE.COM', 'example.com', 'invalid/path'] });
  await store.getState().hydrate();
  assert.equal(store.getState().blockWebsiteAds, true);
  assert.equal(store.getState().forceWebsiteDark, true);
  assert.equal(store.getState().websiteBrowser, 'external');
  assert.deepEqual(store.getState().adBlockAllowedHosts, ['example.com']);
  const disabled = settingsFixture({ blockWebsiteAds: false });
  await disabled.store.getState().hydrate();
  assert.equal(disabled.store.getState().blockWebsiteAds, false);
});

test('rapid toggles persist the latest choice, keep independent sites, and survive restart', async () => {
  const { store, persisted, writes } = settingsFixture(null);
  await store.getState().hydrate();
  store.getState().setSiteAdsAllowed('WWW.Example.COM', true);
  store.getState().setSiteAdsAllowed('example.com', true);
  store.getState().setSiteAdsAllowed('WWW.Example.COM', false);
  store.getState().setSiteAdsAllowed('invalid/path', true);
  store.getState().setBlockWebsiteAds(false);
  store.getState().setBlockWebsiteAds(true);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(writes.length, 5);
  assert.deepEqual(persisted().adBlockAllowedHosts, ['example.com']);
  assert.equal(persisted().blockWebsiteAds, true);
  const restarted = settingsFixture(persisted());
  await restarted.store.getState().hydrate();
  assert.deepEqual(restarted.store.getState().adBlockAllowedHosts, ['example.com']);
  restarted.store.getState().clearAdBlockAllowedHosts();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(restarted.persisted().adBlockAllowedHosts, []);
});
