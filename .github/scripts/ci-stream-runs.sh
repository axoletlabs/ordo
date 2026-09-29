#!/usr/bin/env bash
# GitHub records release events under the tag in head_branch, not the target
# release/x.y.z branch. Include that tag's jobs in baselines and APK waits.
set -euo pipefail
BRANCH="${1:?stream branch}"
STATUS="${2:?run status}"
PAGE="${3:-1}"
SIZE="${4:-20}"
REPO="${GITHUB_REPOSITORY:?}"
branch_query="$(jq -rn --arg branch "$BRANCH" '$branch | @uri')"
branch_runs="$(gh api "repos/$REPO/actions/workflows/ci.yml/runs?branch=$branch_query&status=$STATUS&per_page=$SIZE&page=$PAGE" --jq '.workflow_runs')"
tag_runs='[]'
if [[ "$BRANCH" == release/* ]]; then
  tag="v${APP_VERSION:-${BRANCH#release/}}"
  tag_query="$(jq -rn --arg tag "$tag" '$tag | @uri')"
  tag_runs="$(gh api "repos/$REPO/actions/workflows/ci.yml/runs?branch=$tag_query&status=$STATUS&per_page=$SIZE&page=$PAGE" --jq '.workflow_runs')"
fi
jq -s 'add | unique_by(.id) | sort_by(.id) | reverse' <<<"$branch_runs $tag_runs"
