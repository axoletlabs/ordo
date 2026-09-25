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
PREFIX="ordo-server"
ASSET="ordo-server-v${VERSION}.tar.gz"
WORKDIR="$(mktemp -d)"
trap 'rm -rf "$WORKDIR"' EXIT
mkdir -p "$OUT" "$WORKDIR/extra/${PREFIX}/apps/server"

git -C "$ROOT" archive --format=tar --prefix="${PREFIX}/" -o "$WORKDIR/server.tar" "$SHA"

node -e '
const fs = require("node:fs");
const body = {
  version: process.argv[2],
  tag: process.argv[3],
  commit: process.argv[4],
  asset: process.argv[5],
};
fs.writeFileSync(process.argv[1], JSON.stringify(body, null, 2) + "\n");
' "$WORKDIR/extra/${PREFIX}/apps/server/release.json" "$VERSION" "$TAG" "$SHA" "$ASSET"

tar -rf "$WORKDIR/server.tar" -C "$WORKDIR/extra" "${PREFIX}/apps/server/release.json"
gzip -n -c "$WORKDIR/server.tar" > "$OUT/$ASSET"
(
  cd "$OUT"
  sha256sum "$ASSET" > "${ASSET}.sha256"
)

echo "Wrote $OUT/$ASSET"
