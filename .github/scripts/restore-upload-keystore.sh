#!/usr/bin/env bash
# Decode the shared Android upload keystore and export ORDO_UPLOAD_STORE_FILE
# for Gradle. Release APKs must all be signed with one stored upload key
# (alias `ordo`); missing secrets fail the build instead of minting a new
# debug key each run.
set -euo pipefail

if [ -z "${ANDROID_KEYSTORE_BASE64:-}" ] || [ -z "${ORDO_UPLOAD_STORE_PASSWORD:-}" ]; then
  echo "::error::Set ANDROID_KEYSTORE_BASE64 and ANDROID_KEYSTORE_PASSWORD repository secrets so release APKs share one upload key."
  exit 1
fi
KEYSTORE="${RUNNER_TEMP:?}/ordo-upload.p12"
echo "$ANDROID_KEYSTORE_BASE64" | base64 -d > "$KEYSTORE"
if [ ! -s "$KEYSTORE" ]; then
  echo "::error::Decoded ANDROID_KEYSTORE_BASE64 is empty."
  exit 1
fi
echo "ORDO_UPLOAD_STORE_FILE=$KEYSTORE" >> "$GITHUB_ENV"
