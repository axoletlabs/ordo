/**
 * @react-native-masked-view/masked-view android/build.gradle rewrites
 * AndroidManifest.xml in place when Gradle evaluates (AGP 7+: strip
 * package="org.reactnative.maskedview"). That file is inside an autolinked
 * dir Expo fingerprints, so the APK runtime drifts from detect / eas update.
 *
 * Hash the post-Gradle bytes instead, so JS-only OTAs land on the binary.
 *
 * @type {import('expo/fingerprint').Config['fileHookTransform']}
 */
const MANIFEST_SUFFIX =
  "@react-native-masked-view/masked-view/android/src/main/AndroidManifest.xml";
const PACKAGE_ATTR = 'package="org.reactnative.maskedview"';

const buffers = new Map();

function isMaskedViewManifest(filePath) {
  return filePath.replace(/\\/g, "/").endsWith(MANIFEST_SUFFIX);
}

function fileHookTransform(source, chunk, isEndOfFile) {
  if (source.type !== "file" || !isMaskedViewManifest(source.filePath)) {
    return chunk;
  }

  const key = source.filePath;
  if (chunk != null && chunk !== "") {
    const pieces = buffers.get(key) ?? [];
    pieces.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    buffers.set(key, pieces);
  }
  if (!isEndOfFile) {
    return null;
  }

  const pieces = buffers.get(key) ?? [];
  buffers.delete(key);
  const text = Buffer.concat(pieces).toString("utf8");
  return text.replaceAll(PACKAGE_ATTR, "");
}

module.exports = { fileHookTransform };
