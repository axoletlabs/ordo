// @native-html/render imports `{ pick, omit }` from the ramda barrel, which
// pulls in all ~250 ramda modules. Serve just those two (see metro.config.js).
module.exports = {
  pick: require("ramda/src/pick"),
  omit: require("ramda/src/omit"),
};
