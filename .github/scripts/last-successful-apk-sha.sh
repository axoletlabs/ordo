#!/usr/bin/env bash
# Print the head SHA of the latest completed CI run on main whose build_apk
# job succeeded. Exit 1 if none is found.
set -euo pipefail

REPO="${GITHUB_REPOSITORY:?}"

for page in 1 2 3 4 5; do
  ids="$(gh api "repos/${REPO}/actions/workflows/ci.yml/runs?branch=main&status=completed&per_page=20&page=${page}" --jq '.workflow_runs[].id')"
  if [[ -z "$ids" ]]; then
    break
  fi
  while read -r id; do
    [[ -z "$id" ]] && continue
    conclusion="$(gh api "repos/${REPO}/actions/runs/${id}/jobs" --jq '[.jobs[] | select(.name == "build_apk") | .conclusion] | .[0] // empty')"
    if [[ "$conclusion" == "success" ]]; then
      gh api "repos/${REPO}/actions/runs/${id}" --jq .head_sha
      exit 0
    fi
  done <<< "$ids"
done

exit 1
