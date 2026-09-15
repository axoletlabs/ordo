#!/usr/bin/env bash
# Print the runtime version baked into a successful Android APK CI run.
#
# Gradle fingerprints after compiling native modules. Some of those modules
# rewrite their own sources (masked-view strips package= from its manifest),
# so the hash in the APK can differ from detect / `eas update --auto`.
# OTA must target this embedded hash, not detect's hash of the same commit.
#
# Usage:
#   apk-embedded-runtime.sh --run-id <id>
#   apk-embedded-runtime.sh --sha <commit>
set -euo pipefail

REPO="${GITHUB_REPOSITORY:?}"
RUN_ID=""
SHA=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --run-id) RUN_ID="${2:-}"; shift 2 ;;
    --sha) SHA="${2:-}"; shift 2 ;;
    *) echo "Usage: $0 --run-id <id> | --sha <commit>" >&2; exit 2 ;;
  esac
done

if [[ -z "$RUN_ID" && -n "$SHA" ]]; then
  while read -r id; do
    [[ -z "$id" ]] && continue
    conclusion="$(gh api "repos/${REPO}/actions/runs/${id}/jobs" \
      --jq '[.jobs[] | select(.name == "build_apk") | .conclusion] | .[0] // empty')"
    if [[ "$conclusion" == "success" ]]; then
      RUN_ID="$id"
      break
    fi
  done < <(gh api "repos/${REPO}/actions/runs?head_sha=${SHA}&status=completed&per_page=20" \
    --jq '.workflow_runs[].id')
fi

if [[ -z "$RUN_ID" ]]; then
  exit 1
fi

tmpdir="$(mktemp -d)"
cleanup() { rm -rf "$tmpdir"; }
trap cleanup EXIT

# New APK jobs upload the hash they pass to Gradle (pre-compile). Prefer that
# over scraping a 100MB log.
if gh run download "$RUN_ID" -n android-runtime-version -D "$tmpdir" -R "$REPO" >/dev/null 2>&1; then
  if [[ -f "$tmpdir/android-runtime-version.txt" ]]; then
    tr -d '[:space:]' <"$tmpdir/android-runtime-version.txt"
    echo
    exit 0
  fi
fi

JOB_ID="$(gh api "repos/${REPO}/actions/runs/${RUN_ID}/jobs" \
  --jq '[.jobs[] | select(.name == "build_apk" and .conclusion == "success")][0].id // empty')"
if [[ -z "$JOB_ID" ]]; then
  exit 1
fi

# expo-updates dumps the fingerprint JSON during :app:createReleaseUpdatesResources.
gh run view "$RUN_ID" --job "$JOB_ID" --log 2>/dev/null | python3 -c '
import json, sys
for line in sys.stdin:
    idx = line.find("{\"sources\":")
    if idx < 0:
        continue
    try:
        data = json.loads(line[idx:])
    except json.JSONDecodeError:
        continue
    digest = data.get("hash")
    if isinstance(digest, str) and len(digest) == 40:
        print(digest)
        sys.exit(0)
sys.exit(1)
'
