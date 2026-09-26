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

mkdir -p "$tmp/bin" "$tmp/with-pnpm" "$tmp/home"
printf '#!/bin/sh\nprintf 11.10.0\n' >"$tmp/with-pnpm/pnpm"
chmod +x "$tmp/with-pnpm/pnpm"
# Keep the normal PATH so mkdir and mktemp exist, but hide any real pnpm.
clean_path=""
IFS=:
for dir in $PATH; do
  [[ -n "$dir" && ! -x "$dir/pnpm" ]] || continue
  clean_path="${clean_path:+$clean_path:}$dir"
done
unset IFS
cat >"$tmp/bin/corepack" <<'EOF'
#!/bin/bash
printf '%s\n' "$*" >> "${ORDO_COREPACK_LOG}"
if [[ "$1" == enable ]]; then
  dir=""
  prev=""
  for arg in "$@"; do
    if [[ "$prev" == "--install-directory" ]]; then
      dir=$arg
    fi
    prev=$arg
  done
  mkdir -p "$dir"
  printf '#!/bin/sh\nprintf 11.10.0\n' >"$dir/pnpm"
  chmod +x "$dir/pnpm"
fi
exit 0
EOF
chmod +x "$tmp/bin/corepack"
export ORDO_COREPACK_LOG="$tmp/corepack.log"
: >"$ORDO_COREPACK_LOG"
(
  export HOME="$tmp/home"
  export PATH="$tmp/with-pnpm:$tmp/bin:$clean_path"
  ordo_ensure_pnpm
)
[[ ! -s "$ORDO_COREPACK_LOG" ]] || fail "corepack should not run when pnpm exists"

out=$(
  export HOME="$tmp/home"
  export PATH="$tmp/bin:$clean_path"
  ordo_ensure_pnpm
)
[[ "$out" == *"pnpm is in ${tmp}/home/.local/bin"* ]] || fail "pnpm location, got $out"
[[ -x "${tmp}/home/.local/bin/pnpm" ]] || fail "pnpm shim was not created"
grep -q -F -- "--install-directory ${tmp}/home/.local/bin" "$ORDO_COREPACK_LOG" || fail "install directory"
grep -q -F -- "prepare pnpm@11.10.0 --activate" "$ORDO_COREPACK_LOG" || fail "prepare"

cat >"$tmp/bin/corepack" <<'EOF'
#!/bin/bash
printf 'EACCES: permission denied\n' >&2
exit 1
EOF
msg=$(
  export HOME="$tmp/home-fail"
  export PATH="$tmp/bin:$clean_path"
  ordo_ensure_pnpm 2>&1
) || status=$?
[[ "${status:-0}" -ne 0 ]] || fail "a failed corepack enable should stop the install"
[[ "$msg" == *"Could not install pnpm"* ]] || fail "enable error, got $msg"

rm -rf "$tmp"
printf 'ok\n'
