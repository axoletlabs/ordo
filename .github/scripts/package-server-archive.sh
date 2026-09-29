#!/usr/bin/env bash
# Build ordo-server-vX.Y.Z.tar.gz from the tagged commit, plus a sha256 file.
# The archive is the git tree (so the host compiles native modules) with
# apps/server/release.json added. CI must already have compiled the server;
# this script only packages source.
set -euo pipefail

VERSION="${1:?version, without a leading v}"
TAG="${2:?tag, such as v0.1.0}"
SHA="${3:?full commit sha}"
OUT="${4:?output directory}"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
pre=false
[[ "$VERSION" == *-* ]] && pre=true
node "$ROOT/.github/scripts/validate-release-tag.js" "$TAG" "$VERSION" "$pre"
SHA="$(git -C "$ROOT" rev-parse "${SHA}^{commit}")"
COMMIT_TIME="$(git -C "$ROOT" show -s --format=%ct "$SHA")"
PREFIX="ordo-server"
ASSET="ordo-server-v${VERSION}.tar.gz"
WORKDIR="$(mktemp -d)"
trap 'rm -rf "$WORKDIR"' EXIT
mkdir -p "$OUT" "$WORKDIR/extra/${PREFIX}/apps/server"

git -C "$ROOT" archive --format=tar --prefix="${PREFIX}/" -o "$WORKDIR/server.tar" "$SHA"

node -e '
const fs = require("node:fs");
const { execFileSync } = require("node:child_process");
const { isPreserved } = require(process.argv[6] + "/scripts/server-release.js");
const body = {
  version: process.argv[2],
  tag: process.argv[3],
  commit: process.argv[4],
  asset: process.argv[5],
  files: execFileSync("git", ["-C", process.argv[6], "ls-tree", "-r", "--name-only", "-z", process.argv[4]], { encoding: "utf8" })
    .split("\0").filter((file) => file && !isPreserved(file)),
};
fs.writeFileSync(process.argv[1], JSON.stringify(body, null, 2) + "\n");
' "$WORKDIR/extra/${PREFIX}/apps/server/release.json" "$VERSION" "$TAG" "$SHA" "$ASSET" "$ROOT"

tar -rf "$WORKDIR/server.tar" --mtime="@$COMMIT_TIME" --owner=0 --group=0 --numeric-owner \
  -C "$WORKDIR/extra" "${PREFIX}/apps/server/release.json"
gzip -n -c "$WORKDIR/server.tar" > "$OUT/$ASSET"
(
  cd "$OUT"
  sha256sum "$ASSET" > "${ASSET}.sha256"
)

echo "Wrote $OUT/$ASSET"
