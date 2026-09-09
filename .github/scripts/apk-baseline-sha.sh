#!/usr/bin/env bash
# Print the commit SHA whose Android fingerprint is the OTA/APK routing
# baseline for the current stream branch (main or preview).
#
# Prefer a newer in-flight ci.yml run on that branch (an APK still building, or
# detect still running) so a JS-only follow-up can OTA onto that runtime
# instead of comparing to the last completed binary and starting a second
# APK. Fall back to the last successful APK on the same branch.
set -euo pipefail

REPO="${GITHUB_REPOSITORY:?}"
CURRENT_RUN="${GITHUB_RUN_ID:-0}"
BRANCH="${1:-${GITHUB_REF_NAME:-main}}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

list_runs() {
  local status="$1"
  gh api "repos/${REPO}/actions/workflows/ci.yml/runs?branch=${BRANCH}&status=${status}&per_page=20" \
    --jq '.workflow_runs' || echo '[]'
}

in_flight="$(
  jq -s --argjson current "${CURRENT_RUN}" \
    'add | map(select(.id != $current)) | sort_by(.created_at) | reverse | .[0] // empty' \
    <(list_runs in_progress) \
    <(list_runs queued) \
    <(list_runs waiting)
)"

if [[ -n "$in_flight" && "$in_flight" != "null" ]]; then
  sha="$(jq -r '.head_sha // empty' <<<"$in_flight")"
  run_id="$(jq -r '.id // empty' <<<"$in_flight")"
  if [[ -n "$sha" ]]; then
    echo "Using in-flight CI run ${run_id} on ${BRANCH} as fingerprint baseline" >&2
    echo "$sha"
    exit 0
  fi
fi

bash "$SCRIPT_DIR/last-successful-apk-sha.sh" "$BRANCH"
