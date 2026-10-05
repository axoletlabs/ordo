const { withMainApplication } = require('expo/config-plugins');
const { mergeContents } = require('@expo/config-plugins/build/utils/generateCode');

function patchMainApplication(contents, language) {
  return mergeContents({
    src: contents,
    tag: 'ordo-pointer-hover',
    comment: '    //',
    offset: 0,
    anchor: /super\.onCreate\(\)/,
    newSrc: `    com.facebook.react.config.ReactFeatureFlags.dispatchPointerEvents = true${language === 'java' ? ';' : ''}`,
  }).contents;
}

module.exports = config => withMainApplication(config, c => {
  c.modResults.contents = patchMainApplication(c.modResults.contents, c.modResults.language);
  return c;
});
module.exports.patchMainApplication = patchMainApplication;
