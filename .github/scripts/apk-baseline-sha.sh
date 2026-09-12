#!/usr/bin/env bash
# Print the commit SHA whose Android fingerprint is the OTA/APK routing
# baseline for the current stream branch (main or preview).
#
# Prefer a newer in-flight ci.yml run that might still produce an APK (detect
# still running, or build_apk pending/succeeded) so a JS-only follow-up OTAs
# onto that runtime instead of starting a second APK. Skip JS-only in-flight
# runs — their fingerprint is not a binary. Fall back to the last successful
# APK on the same branch.
#
# The in-flight SHA must already be an ancestor of CURRENT_SHA. A later push
# can look like an APK-producing run while its detect is still running; that
# commit is not in this clone, and `git worktree add` then exits 128, which
# detect treats as native-incompatible and mints a spare APK.
set -euo pipefail

REPO="${GITHUB_REPOSITORY:?}"
CURRENT_RUN="${GITHUB_RUN_ID:-0}"
CURRENT_SHA="${CURRENT_SHA:-${GITHUB_SHA:-}}"
BRANCH="${1:-${GITHUB_REF_NAME:-main}}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

usable_baseline() {
  local sha="$1"
  [[ -n "$sha" ]] || return 1
  git cat-file -e "${sha}^{commit}" 2>/dev/null || return 1
  [[ -n "$CURRENT_SHA" ]] || return 1
  [[ "$sha" == "$CURRENT_SHA" ]] && return 0
  git merge-base --is-ancestor "$sha" "$CURRENT_SHA"
}

list_runs() {
  local status="$1"
  gh api "repos/${REPO}/actions/workflows/ci.yml/runs?branch=${BRANCH}&status=${status}&per_page=20" \
    --jq '.workflow_runs' || echo '[]'
}

# True when this run is building an APK, already built one, or detect has not
# decided yet. False for a finished JS-only detect (build_apk skipped).
might_produce_apk() {
  local run_id="$1"
  local jobs detect_status apk_status apk_conclusion
  jobs="$(gh api "repos/${REPO}/actions/runs/${run_id}/jobs" --jq '[.jobs[] | {name,status,conclusion}]')"
  detect_status="$(jq -r '.[] | select(.name == "detect") | .status' <<<"$jobs")"
  apk_status="$(jq -r '.[] | select(.name == "build_apk") | .status' <<<"$jobs")"
  apk_conclusion="$(jq -r '.[] | select(.name == "build_apk") | .conclusion // empty' <<<"$jobs")"

  if [[ "$apk_status" == "in_progress" || "$apk_status" == "queued" || "$apk_status" == "waiting" ]]; then
    return 0
  fi
  if [[ "$apk_status" == "completed" && "$apk_conclusion" == "success" ]]; then
    return 0
  fi
  if [[ "$detect_status" == "in_progress" || "$detect_status" == "queued" || "$detect_status" == "waiting" ]]; then
    return 0
  fi
  # Detect finished but the APK job has not appeared yet.
  if [[ "$detect_status" == "completed" && -z "$apk_status" ]]; then
    return 0
  fi
  return 1
}

in_flight="$(
  jq -s --argjson current "${CURRENT_RUN}" \
    'add | map(select(.id != $current)) | sort_by(.created_at) | reverse' \
    <(list_runs in_progress) \
    <(list_runs queued) \
    <(list_runs waiting)
)"

if [[ -n "$in_flight" && "$in_flight" != "null" && "$in_flight" != "[]" ]]; then
  while read -r run_id sha; do
    [[ -z "$run_id" || -z "$sha" ]] && continue
    if might_produce_apk "$run_id"; then
      if usable_baseline "$sha"; then
        echo "Using in-flight CI run ${run_id} on ${BRANCH} as fingerprint baseline" >&2
        echo "$sha"
        exit 0
      fi
      echo "Skipping in-flight run ${run_id}: ${sha} is not an ancestor of ${CURRENT_SHA:-unknown}" >&2
      continue
    fi
    echo "Skipping in-flight run ${run_id}: JS-only (no APK)" >&2
  done < <(jq -r '.[] | "\(.id) \(.head_sha // empty)"' <<<"$in_flight")
fi

bash "$SCRIPT_DIR/last-successful-apk-sha.sh" "$BRANCH"
