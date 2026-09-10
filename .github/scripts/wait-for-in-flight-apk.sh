#!/usr/bin/env bash
# Block until every older in-flight ci.yml run on this branch has finished its
# APK job (or skipped it). expo-updates only loads an OTA when createdAt is
# newer than the launched update's commitTime; the APK stamps that clock while
# packaging, so publishing before the binary finishes makes Check say "up to date".
set -euo pipefail

REPO="${GITHUB_REPOSITORY:?}"
CURRENT_RUN="${GITHUB_RUN_ID:-0}"
BRANCH="${1:-${GITHUB_REF_NAME:-main}}"
# APK jobs are ~8 minutes; leave headroom if the queue is slow.
TIMEOUT_S="${WAIT_FOR_APK_TIMEOUT_S:-2700}"
SLEEP_S="${WAIT_FOR_APK_SLEEP_S:-20}"

list_runs() {
  local status="$1"
  gh api "repos/${REPO}/actions/workflows/ci.yml/runs?branch=${BRANCH}&status=${status}&per_page=20" \
    --jq '.workflow_runs' || echo '[]'
}

# Runs that started before this one and are still going. Newer runs cancel us
# via the ota concurrency group; waiting on them would deadlock.
older_in_flight_ids() {
  jq -s --argjson current "${CURRENT_RUN}" \
    '
      add
      | map(select(.id < $current))
      | .[].id
    ' \
    <(list_runs in_progress) \
    <(list_runs queued) \
    <(list_runs waiting)
}

# True when this run might still produce a binary we must out-timestamp.
run_has_pending_apk() {
  local run_id="$1"
  local jobs detect_status apk_status apk_conclusion
  jobs="$(gh api "repos/${REPO}/actions/runs/${run_id}/jobs" --jq '[.jobs[] | {name,status,conclusion}]')"
  detect_status="$(jq -r '.[] | select(.name == "detect") | .status' <<<"$jobs")"
  apk_status="$(jq -r '.[] | select(.name == "build_apk") | .status' <<<"$jobs")"
  apk_conclusion="$(jq -r '.[] | select(.name == "build_apk") | .conclusion // empty' <<<"$jobs")"

  if [[ "$detect_status" == "in_progress" || "$detect_status" == "queued" || "$detect_status" == "waiting" ]]; then
    echo "run ${run_id}: detect is ${detect_status}"
    return 0
  fi
  if [[ "$apk_status" == "in_progress" || "$apk_status" == "queued" || "$apk_status" == "waiting" ]]; then
    echo "run ${run_id}: build_apk is ${apk_status}"
    return 0
  fi
  if [[ "$apk_status" == "completed" && "$apk_conclusion" == "skipped" ]]; then
    return 1
  fi
  if [[ "$apk_status" == "completed" ]]; then
    echo "run ${run_id}: build_apk ${apk_conclusion}"
    return 1
  fi
  # Detect finished but the APK job has not appeared yet.
  if [[ "$detect_status" == "completed" && -z "$apk_status" ]]; then
    echo "run ${run_id}: waiting for build_apk to be scheduled"
    return 0
  fi
  return 1
}

started="$(date +%s)"
pending=0
while true; do
  pending=0
  ids="$(older_in_flight_ids || true)"
  if [[ -z "$ids" ]]; then
    echo "No older in-flight CI runs on ${BRANCH}"
    exit 0
  fi
  while read -r run_id; do
    [[ -z "$run_id" ]] && continue
    if run_has_pending_apk "$run_id"; then
      pending=1
    fi
  done <<<"$ids"

  if [[ "$pending" -eq 0 ]]; then
    echo "All older APK jobs on ${BRANCH} have finished"
    exit 0
  fi

  now="$(date +%s)"
  if (( now - started >= TIMEOUT_S )); then
    echo "::error::Timed out after ${TIMEOUT_S}s waiting for an in-flight APK on ${BRANCH}"
    exit 1
  fi
  echo "Waiting ${SLEEP_S}s for in-flight APK…"
  sleep "$SLEEP_S"
done
