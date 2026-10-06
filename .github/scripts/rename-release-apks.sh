#!/usr/bin/env bash
# Rename CI's APK outputs to their publish names inside DIR: universal ->
# ordo-vVERSION.apk, per-ABI splits -> ordo-vVERSION-<abi>.apk. A partial
# split build must not silently become a published release, so every APK
# is required to exist and be non-empty.
set -euo pipefail

DIR="${1:?artifact directory}"
VERSION="${2:?app version}"
cd "$DIR"

# universal (all ABIs) -> ordo-vX.Y.Z.apk or ordo-vX.Y.Z-beta.N.apk
if [ -f app-universal-release.apk ]; then
  mv app-universal-release.apk "ordo-v${VERSION}.apk"
elif [ -f app-release.apk ]; then
  mv app-release.apk "ordo-v${VERSION}.apk"
fi
# per-ABI splits -> ordo-vX.Y.Z[-prerelease]-<abi>.apk
for abi in armeabi-v7a arm64-v8a x86 x86_64; do
  if [ -f "app-${abi}-release.apk" ]; then
    mv "app-${abi}-release.apk" "ordo-v${VERSION}-${abi}.apk"
  fi
done

test -s "ordo-v${VERSION}.apk"
for abi in armeabi-v7a arm64-v8a x86 x86_64; do
  test -s "ordo-v${VERSION}-${abi}.apk"
done

echo "## APKs to publish:" >> "$GITHUB_STEP_SUMMARY"
find . -maxdepth 1 -name 'ordo-v*.apk' -printf '%f\n' | sort | sed 's/^/- /' >> "$GITHUB_STEP_SUMMARY"
