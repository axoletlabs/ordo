const assert = require('node:assert/strict');
const { test } = require('node:test');
const { patchMainApplication } = require('./with-pointer-hover.js');

for (const language of ['kt', 'java']) {
  test(`${language}: enables Android pointer dispatch before application creation`, () => {
    const source = language === 'java'
      ? 'public class MainApplication {\n  public void onCreate() {\n    super.onCreate();\n  }\n}'
      : 'class MainApplication {\n  override fun onCreate() {\n    super.onCreate()\n  }\n}';
    const once = patchMainApplication(source, language);
    assert.ok(once.indexOf('dispatchPointerEvents = true') < once.indexOf('super.onCreate()'));
    assert.match(once, /com\.facebook\.react\.config\.ReactFeatureFlags\.dispatchPointerEvents = true/);
    assert.equal(patchMainApplication(once, language), once);
    assert.equal(once.includes('dispatchPointerEvents = true;'), language === 'java');
  });
}
