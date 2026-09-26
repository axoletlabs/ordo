#!/usr/bin/env bash
set -euo pipefail

root=$(cd "$(dirname "$0")/.." && pwd)
# shellcheck disable=SC1091
source "$root/install.sh"

fail() {
  printf 'FAIL: %s\n' "$1" >&2
  exit 1
}

ordo_node_ok "22.13.0" || fail "22.13 should pass"
ordo_node_ok "22.13.1" || fail "22.13.1 should pass"
ordo_node_ok "24.1.0" || fail "24 should pass"
if ordo_node_ok "22.12.9"; then fail "22.12 should fail"; fi
if ordo_node_ok "20.18.0"; then fail "20 should fail"; fi

got=$(ordo_release_from_args --yes --release v0.1.0 --port 8080)
[[ "$got" == "v0.1.0" ]] || fail "spaced --release, got $got"
got=$(ordo_release_from_args --release=0.2.0)
[[ "$got" == "0.2.0" ]] || fail "equals --release, got $got"
if ordo_release_from_args --yes --port 1; then fail "missing --release should fail"; fi

got=$(ordo_normalize_tag "0.1.0")
[[ "$got" == "v0.1.0" ]] || fail "normalize plain, got $got"
got=$(ordo_normalize_tag "v0.1.0-beta.1")
[[ "$got" == "v0.1.0-beta.1" ]] || fail "normalize pre, got $got"
if ordo_normalize_tag "latest"; then fail "latest should defer"; fi
if ordo_normalize_tag "latest-pre"; then fail "latest-pre should defer"; fi
if ordo_normalize_tag "nope"; then fail "junk should fail"; fi

[[ "$(ordo_asset_name v0.1.0)" == "ordo-server-v0.1.0.tar.gz" ]] || fail "asset name"

ordo_wants_help --yes --help || fail "help flag"
if ordo_wants_help --yes; then fail "no help flag"; fi

tmp=$(mktemp -d)
printf 'abc\n' >"$tmp/file"
printf 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad  file\n' >"$tmp/file.sha256"
# hash of "abc\n" is not that. Use the real hash of the bytes we wrote.
hash=$(sha256sum "$tmp/file" | awk '{ print $1 }')
printf '%s  file\n' "$hash" >"$tmp/file.sha256"
ordo_verify_sha256 "$tmp/file" "$tmp/file.sha256" || fail "checksum should match"
printf '0000000000000000000000000000000000000000000000000000000000000000  file\n' >"$tmp/file.sha256"
if ordo_verify_sha256 "$tmp/file" "$tmp/file.sha256"; then fail "checksum should reject"; fi

mkdir -p "$tmp/empty" "$tmp/foreign" "$tmp/ordo/scripts" "$tmp/ordo/apps/server"
: >"$tmp/foreign/notes.txt"
printf 'packages:\n' >"$tmp/ordo/pnpm-workspace.yaml"
: >"$tmp/ordo/scripts/deploy-server.js"
ordo_dir_empty "$tmp/missing" || fail "missing dir is empty"
ordo_dir_empty "$tmp/empty" || fail "empty dir"
if ordo_dir_empty "$tmp/foreign"; then fail "foreign dir is not empty"; fi
ordo_is_ordo_tree "$tmp/ordo" || fail "ordo tree"
if ordo_is_ordo_tree "$tmp/foreign"; then fail "foreign is not ordo"; fi

help_text=$(ordo_print_help)
[[ "$help_text" == *"ordo.axolet.com/install | bash"* ]] || fail "help should show the curl command"

rm -rf "$tmp"
printf 'ok\n'
