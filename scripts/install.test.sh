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

mkdir -p "$tmp/bin" "$tmp/with-pnpm"
printf '#!/bin/sh\nprintf 11.10.0\n' >"$tmp/with-pnpm/pnpm"
chmod +x "$tmp/with-pnpm/pnpm"
printf '#!/bin/sh\nprintf 18.19.1\n' >"$tmp/bin/node"
chmod +x "$tmp/bin/node"
node_free=""
IFS=:
for dir in $PATH; do
  [[ -n "$dir" && ! -x "$dir/node" && ! -x "$dir/nodejs" ]] || continue
  node_free="${node_free:+$node_free:}$dir"
done
unset IFS

status=0
msg=$(PATH="$node_free" ordo_ensure_node 2>&1) || status=$?
[[ "$status" -ne 0 ]] || fail "missing node should stop"
[[ "$msg" == *"Node.js is not installed."* ]] || fail "missing node message, got $msg"
[[ "$msg" != *"This machine has"* ]] || fail "missing node should not look like an old version"

status=0
msg=$(PATH="$tmp/bin" ordo_ensure_node 2>&1) || status=$?
[[ "$status" -ne 0 ]] || fail "old node should stop"
[[ "$msg" == *"This machine has Node.js 18.19.1."* ]] || fail "old node message, got $msg"
[[ "$msg" == *"Ordo needs Node.js 22.13 or newer."* ]] || fail "old node requirement, got $msg"

printf '#!/bin/sh\nexit 1\n' >"$tmp/bin/node"
status=0
msg=$(PATH="$tmp/bin" ordo_ensure_node 2>&1) || status=$?
[[ "$status" -ne 0 ]] || fail "broken node should stop"
[[ "$msg" == *"Node.js is not installed."* ]] || fail "broken node message, got $msg"

printf '#!/bin/sh\nprintf 22.14.0\n' >"$tmp/bin/node"
PATH="$tmp/bin" ordo_ensure_node || fail "node 22.14 should pass"

# Hide any real pnpm, but keep the tools the installer needs.
clean_path=""
IFS=:
for dir in $PATH; do
  [[ -n "$dir" && ! -x "$dir/pnpm" ]] || continue
  clean_path="${clean_path:+$clean_path:}$dir"
done
unset IFS

export ORDO_PNPM_LOG="$tmp/pnpm.log"
export ORDO_CHOICE_LOG="$tmp/choice.log"
: >"$ORDO_PNPM_LOG"
: >"$ORDO_CHOICE_LOG"
eval "$(declare -f ordo_pnpm_choice | sed '1s/ordo_pnpm_choice/ordo_pnpm_choice_real/')"
ordo_install_pnpm() {
  printf 'official %s\n' "$ORDO_PNPM_VERSION" >>"$ORDO_PNPM_LOG"
  mkdir -p "${HOME}/.local/share/pnpm"
  printf '#!/bin/sh\nprintf 11.10.0\n' >"${HOME}/.local/share/pnpm/pnpm"
  chmod +x "${HOME}/.local/share/pnpm/pnpm"
}
ordo_pnpm_choice() {
  printf 'asked\n' >>"$ORDO_CHOICE_LOG"
  printf '%s\n' "$ORDO_PNPM_ANSWER"
}

(
  export HOME="$tmp/home" PNPM_HOME="" XDG_DATA_HOME="" ORDO_PNPM_ANSWER="1"
  export PATH="$tmp/with-pnpm:$clean_path"
  ordo_ensure_pnpm
)
[[ ! -s "$ORDO_CHOICE_LOG" ]] || fail "should not ask when pnpm exists"
[[ ! -s "$ORDO_PNPM_LOG" ]] || fail "should not install pnpm when it exists"

: >"$ORDO_CHOICE_LOG"
status=0
msg=$(
  export HOME="$tmp/home" PNPM_HOME="" XDG_DATA_HOME="" ORDO_PNPM_ANSWER="2"
  export PATH="$clean_path"
  ordo_ensure_pnpm 2>&1
) || status=$?
[[ "$status" -ne 0 ]] || fail "declining pnpm should stop"
[[ ! -s "$ORDO_PNPM_LOG" ]] || fail "declining should not install pnpm"
[[ "$msg" == *"pnpm is not installed."* ]] || fail "decline should say pnpm is missing, got $msg"
[[ "$msg" == *"PNPM_VERSION=11.10.0"* ]] || fail "decline should show the official command, got $msg"
[[ "$msg" != *"This machine has"* ]] || fail "decline should not look like a node version error"

: >"$ORDO_PNPM_LOG"
(
  export HOME="$tmp/home" PNPM_HOME="" XDG_DATA_HOME="" ORDO_PNPM_ANSWER="1"
  export PATH="$clean_path"
  ordo_ensure_pnpm
)
grep -q -F "official 11.10.0" "$ORDO_PNPM_LOG" || fail "yes should use the official installer pin"
[[ -x "${tmp}/home/.local/share/pnpm/pnpm" ]] || fail "pnpm was not installed into PNPM_HOME"

ordo_have_tty() { return 1; }
[[ "$(ordo_pnpm_choice_real)" == "2" ]] || fail "no terminal should not install pnpm"

ordo_install_pnpm() { return 1; }
status=0
msg=$(
  export HOME="$tmp/home-fail" PNPM_HOME="" XDG_DATA_HOME="" ORDO_PNPM_ANSWER="1"
  export PATH="$clean_path"
  ordo_ensure_pnpm 2>&1
) || status=$?
[[ "$status" -ne 0 ]] || fail "a failed pnpm install should stop"
[[ "$msg" == *"Could not install pnpm."* ]] || fail "install failure, got $msg"
[[ "$msg" == *"https://pnpm.io/installation"* ]] || fail "pnpm help link, got $msg"

rm -rf "$tmp"
printf 'ok\n'
