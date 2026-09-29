#!/usr/bin/env bash
# Published assets are immutable. A retry can reuse identical bytes, but must
# never silently replace an APK while devices are downloading or caching it.
set -euo pipefail
TAG="${1:?release tag}"
shift
REPO="${GITHUB_REPOSITORY:?}"
release="$(gh api "repos/$REPO/releases/tags/$TAG")"
for file in "$@"; do
  name="$(basename "$file")"
  asset="$(jq -c --arg name "$name" '[.assets[] | select(.name == $name)][0] // empty' <<<"$release")"
  if [[ -n "$asset" ]]; then
    expected="sha256:$(sha256sum "$file" | cut -d ' ' -f 1)"
    actual="$(jq -r '.digest // empty' <<<"$asset")"
    if [[ "$actual" != "$expected" ]]; then
      echo "::error::Published asset $name differs from this build. Publish a new version instead of replacing it."
      exit 1
    fi
    echo "Already published identical asset $name"
  else
    gh release upload "$TAG" "$file" -R "$REPO"
  fi
done
