#!/usr/bin/env bash
# A published tag must point at a commit that already lives on its matching
# release/x.y.z branch. Publishing does not create or move that branch.
# Used by both ci.yml (before attaching APKs or the server archive) and
# release.yml's independent guard. Prints the branch on success.
set -euo pipefail

TAG="${1:?release tag, such as v0.1.0}"
TARGET="${2:?release target commitish}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SHA="${GITHUB_SHA:?}"

BRANCH=$(node "$SCRIPT_DIR/validate-release-tag.js" --release-branch "$TAG" "$TARGET")
if ! git fetch origin "$BRANCH"; then
  echo "::error::Branch $BRANCH does not exist. Push the release commit there before publishing $TAG."
  exit 1
fi
if ! git merge-base --is-ancestor "$SHA" "origin/$BRANCH"; then
  echo "::error::$SHA is not on $BRANCH. Push that commit to $BRANCH, then publish the tag."
  exit 1
fi
echo "$TAG is on $BRANCH"
