// react-native-qrcode-svg imports `LocalSvg` from react-native-svg/css for
// its optional `logoSVG` prop, which pulls in css-tree. ordo's QR codes have
// no logo, so that branch never renders (see metro.config.js).
function LocalSvg() {
  throw new Error("react-native-svg/css is stubbed out; QR codes must not use logoSVG.");
}
module.exports = { LocalSvg };
