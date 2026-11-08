#!/usr/bin/env bash
# Block until every older in-flight ci.yml run on this branch has finished its
# APK job (or skipped it). expo-updates only loads an OTA when createdAt is
# newer than the launched update's commitTime; the APK stamps that clock while
# packaging, so publishing before the binary finishes makes Check say "up to date".
set -euo pipefail

CURRENT_RUN="${GITHUB_RUN_ID:-0}"
BRANCH="${1:-${GITHUB_REF_NAME:-main}}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# APK jobs are ~8 minutes; leave headroom if the queue is slow.
TIMEOUT_S="${WAIT_FOR_APK_TIMEOUT_S:-2700}"
SLEEP_S="${WAIT_FOR_APK_SLEEP_S:-20}"

list_runs() {
  local status="$1"
  bash "$SCRIPT_DIR/ci-stream-runs.sh" "$BRANCH" "$status"
}

# Runs that started before this one and are still going. Newer runs cancel us
# via the ota concurrency group; waiting on them would deadlock.
older_in_flight_ids() {
  local progress queued waiting
  progress="$(list_runs in_progress)" || return 1
  queued="$(list_runs queued)" || return 1
  waiting="$(list_runs waiting)" || return 1
  jq -s --argjson current "${CURRENT_RUN}" \
    '
      add
      | map(select(.id < $current))
      | .[].id
    ' \
    <<<"$progress $queued $waiting"
}

# True when this run might still produce a binary we must out-timestamp.
run_has_pending_apk() {
  local run_id="$1"
  local state
  state="$(bash "$SCRIPT_DIR/apk-run-state.sh" "$run_id")" || exit 1
  echo "run ${run_id}: ${state}"
  case "$state" in
    deciding|building) return 0 ;;
    *) return 1 ;;
  esac
}

started="$(date +%s)"
pending=0
while true; do
  pending=0
  ids="$(older_in_flight_ids)"
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
