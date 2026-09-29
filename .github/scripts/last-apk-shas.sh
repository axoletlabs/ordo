#!/usr/bin/env bash
# Print unique head SHAs of the most recent successful build_apk jobs on the
# given branch, newest first. Optional second arg is the max count (default 3).
set -euo pipefail

REPO="${GITHUB_REPOSITORY:?}"
BRANCH="${1:-main}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LIMIT="${2:-3}"
count=0
declare -A seen=()

for page in 1 2 3 4 5; do
  runs="$(bash "$SCRIPT_DIR/ci-stream-runs.sh" "$BRANCH" completed "$page")"
  ids="$(jq -r '.[].id' <<<"$runs")"
  if [[ -z "$ids" ]]; then
    break
  fi
  while read -r id; do
    [[ -z "$id" ]] && continue
    conclusion="$(gh api "repos/${REPO}/actions/runs/${id}/jobs" --jq '[.jobs[] | select(.name == "build_apk") | .conclusion] | .[0] // empty')"
    if [[ "$conclusion" != "success" ]]; then
      continue
    fi
    sha="$(gh api "repos/${REPO}/actions/runs/${id}" --jq .head_sha)"
    [[ -z "$sha" ]] && continue
    if [[ -n "${seen[$sha]+x}" ]]; then
      continue
    fi
    seen[$sha]=1
    echo "$sha"
    count=$((count + 1))
    if (( count >= LIMIT )); then
      exit 0
    fi
  done <<<"$ids"
done

if (( count == 0 )); then
  exit 1
fi
