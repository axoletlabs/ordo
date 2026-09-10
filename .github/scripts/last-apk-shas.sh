#!/usr/bin/env bash
# Print unique head SHAs of the most recent successful build_apk jobs on the
# given branch, newest first. Optional second arg is the max count (default 5).
set -euo pipefail

REPO="${GITHUB_REPOSITORY:?}"
BRANCH="${1:-main}"
LIMIT="${2:-5}"
count=0
declare -A seen=()

for page in 1 2 3 4 5; do
  ids="$(gh api "repos/${REPO}/actions/workflows/ci.yml/runs?branch=${BRANCH}&status=completed&per_page=20&page=${page}" --jq '.workflow_runs[].id')"
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
