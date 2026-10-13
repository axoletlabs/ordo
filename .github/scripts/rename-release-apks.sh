#!/usr/bin/env bash
# Rename CI's APK outputs to their publish names inside DIR: universal ->
# <prefix>-vVERSION.apk, per-ABI splits -> <prefix>-vVERSION-<abi>.apk. A partial
# split build must not silently become a published release, so every APK
# is required to exist and be non-empty.
set -euo pipefail

DIR="${1:?artifact directory}"
VERSION="${2:?app version}"
VARIANT="${3:?app variant}"
case "$VARIANT" in
  stable) PREFIX=ordo ;;
  preview) PREFIX=ordo-preview ;;
  *) echo "Only Stable and Preview APKs can be published" >&2; exit 1 ;;
esac
cd "$DIR"

# Prefix is part of the update contract: never offer the other app.
if [ -f app-universal-release.apk ]; then
  mv app-universal-release.apk "${PREFIX}-v${VERSION}.apk"
elif [ -f app-release.apk ]; then
  mv app-release.apk "${PREFIX}-v${VERSION}.apk"
fi
# per-ABI splits -> ordo-vX.Y.Z[-prerelease]-<abi>.apk
for abi in armeabi-v7a arm64-v8a x86 x86_64; do
  if [ -f "app-${abi}-release.apk" ]; then
    mv "app-${abi}-release.apk" "${PREFIX}-v${VERSION}-${abi}.apk"
  fi
done

test -s "${PREFIX}-v${VERSION}.apk"
for abi in armeabi-v7a arm64-v8a x86 x86_64; do
  test -s "${PREFIX}-v${VERSION}-${abi}.apk"
done

echo "## APKs to publish:" >> "$GITHUB_STEP_SUMMARY"
find . -maxdepth 1 -name "${PREFIX}-v*.apk" -printf '%f\n' | sort | sed 's/^/- /' >> "$GITHUB_STEP_SUMMARY"
