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
if (ordo_release_from_args --release); then fail "--release without a value should fail"; fi

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
[[ "$help_text" == *"uninstall"* ]] || fail "help should show uninstall"

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

ORDO_MENU_COLOR=0
frame=$(ordo_menu_frame "pnpm is not installed." 0 "Install pnpm 11.10.0" "I'll install it myself")
[[ "$frame" == *"› Install pnpm 11.10.0"* ]] || fail "menu highlight, got $frame"
[[ "$frame" != *"› I'll install it myself"* ]] || fail "second row should not be highlighted"
[[ "$frame" == *"↑↓ move    enter select"* ]] || fail "menu hint, got $frame"
[[ "$(ordo_choice_step 0 2 up)" == 1 ]] || fail "up should wrap"
[[ "$(ordo_choice_step 1 2 down)" == 0 ]] || fail "down should wrap"
[[ "$(ordo_menu_lines 2)" == 6 ]] || fail "menu line count"
ORDO_MENU_DETAIL="The first sign-up becomes the owner either way."
ORDO_MENU_COLOR=0
frame=$(ordo_menu_frame "Who can create an account?" 0 "Only the first account" "Anyone who can reach the server")
[[ "$frame" == *"The first sign-up becomes the owner either way."* ]] || fail "menu detail, got $frame"
[[ "$frame" == *"› Only the first account"* ]] || fail "guided highlight, got $frame"
[[ "$(ordo_menu_lines 2)" == 7 ]] || fail "detail line count"
ORDO_MENU_DETAIL=""

text=$(ordo_setup_summary /home/ubuntu/ordo 3000 false false "" 0 0 0)
[[ "$text" == *"http://127.0.0.1:3000"* ]] || fail "summary address, got $text"
[[ "$text" == *"Only the first account"* ]] || fail "summary accounts, got $text"
[[ "$text" == *"Codes in the server log"* ]] || fail "summary mail, got $text"
[[ "$text" == *"Not yet"* ]] || fail "summary start, got $text"
[[ "$text" == *"Compiling the server can take a few minutes."* ]] || fail "summary next step, got $text"

: >"$tmp/guide-choices"
(
  ordo_setup_intro() { :; }
  ordo_kicker() { printf 'K %s\n' "$1"; }
  ordo_explain() { printf 'E %s\n' "$2"; }
  ordo_read_default() { printf '%s\n' "$2"; }
  ordo_choose() {
    printf '%s\n' "$*" >>"$tmp/guide-choices"
    printf '%s\n' "$1"
  }
  ordo_show_summary() { :; }
  ORDO_SETUP_DEST="/home/ubuntu/ordo"
  ordo_ask_setup >"$tmp/guide.out"
  [[ "${ORDO_SETUP_FLAGS[*]}" == "--yes --port 3000 --registration false --email-verification false --trust-proxy 0 --no-start" ]] ||
    fail "guided defaults, got ${ORDO_SETUP_FLAGS[*]}"
)
[[ "$(cat "$tmp/guide.out")" == *"3000 is fine if it is free."* ]] ||
  fail "port explanation missing, got $(cat "$tmp/guide.out")"
[[ "$(cat "$tmp/guide-choices")" == *"The first sign-up becomes the owner either way."* ]] ||
  fail "account explanation missing, got $(cat "$tmp/guide-choices")"

ordo_valid_port 3000 || fail "port 3000"
ordo_valid_port 080 || fail "port 080"
if ordo_valid_port 0; then fail "port 0"; fi
if ordo_valid_port 65536; then fail "port 65536"; fi
if ordo_valid_port abc; then fail "port abc"; fi
ordo_valid_hops 0 || fail "hops 0"
if ordo_valid_hops 33; then fail "hops 33"; fi

ordo_bind_setup_flags 8080 true false "" "" 0 0 0
[[ "${ORDO_SETUP_FLAGS[*]}" == "--yes --port 8080 --registration true --email-verification false --trust-proxy 0 --no-start" ]] ||
  fail "setup flags, got ${ORDO_SETUP_FLAGS[*]}"
ordo_bind_setup_flags 3000 false false "smtp://mail" "ordo <noreply@ordo.local>" 1 1 1 --port 9 --public
[[ "${ORDO_SETUP_FLAGS[*]}" == "--yes --registration false --email-verification false --smtp-url smtp://mail --smtp-from ordo <noreply@ordo.local> --trust-proxy 1 --start" ]] ||
  fail "setup flags with user args, got ${ORDO_SETUP_FLAGS[*]}"

ordo_without_release_args --yes --release v0.1.0 --port 1
[[ "${ORDO_FORWARDED[*]}" == "--yes --port 1" ]] || fail "strip --release, got ${ORDO_FORWARDED[*]}"
ordo_without_release_args --release=v0.1.0 --dry-run
[[ "${ORDO_FORWARDED[*]}" == "--dry-run" ]] || fail "strip --release=, got ${ORDO_FORWARDED[*]}"

if ordo_setup_skipped --yes; then
  :
else
  fail "--yes should skip setup questions"
fi
(
  CI=1
  ordo_setup_skipped
) || fail "CI should skip setup questions"

menu_tree=$(mktemp -d)
mkdir -p "$menu_tree/scripts"
printf 'promptChoiceMenu\n' >"$menu_tree/scripts/deploy-server.js"
ordo_delegate_setup "$menu_tree" || fail "a new deploy script should ask itself"
printf 'typed\n' >"$menu_tree/scripts/deploy-server.js"
if ordo_delegate_setup "$menu_tree"; then fail "an old deploy script should be asked here"; fi
rm -rf "$menu_tree"

script=$(mktemp)
printf '#!/bin/sh\necho WARN using --force\necho Update available\n' >"$script"
msg=$(ordo_run_pnpm_script "$script" 2>&1) || fail "a successful pnpm install should stay quiet, got $msg"
[[ -z "$msg" ]] || fail "pnpm installer noise leaked: $msg"
printf '#!/bin/sh\necho boom\nexit 1\n' >"$script"
status=0
msg=$(ordo_run_pnpm_script "$script" 2>&1) || status=$?
[[ "$status" -ne 0 ]] || fail "a failed pnpm install script should fail"
[[ "$msg" == *boom* ]] || fail "failure should show the installer log, got $msg"
rm -f "$script"

if ! command -v python3 >/dev/null 2>&1; then
  fail "python3 is required to test the arrow menu"
fi
python3 - "$root/install.sh" <<'PY' || fail "arrow keys should move the highlight"
import os, pty, select, sys

script = sys.argv[1]

def pick(keys):
    pid, fd = pty.fork()
    if pid == 0:
        os.execv(
            "/bin/bash",
            ["bash", "-c", f'source "{script}"; result=$(ordo_choose 0 Pick Alpha Beta); printf "RESULT:%s\\n" "$result"'],
        )
    buf = b""
    while b"Pick" not in buf:
        ready, _, _ = select.select([fd], [], [], 5)
        if not ready:
            os.kill(pid, 9)
            raise SystemExit("menu did not draw:\n" + buf.decode("utf8", "replace"))
        try:
            buf += os.read(fd, 4096)
        except OSError:
            break
    os.write(fd, keys)
    while True:
        ready, _, _ = select.select([fd], [], [], 5)
        if not ready:
            break
        try:
            chunk = os.read(fd, 4096)
        except OSError:
            break
        if not chunk:
            break
        buf += chunk
    _, status = os.waitpid(pid, 0)
    os.close(fd)
    code = os.waitstatus_to_exitcode(status)
    if code != 0:
        raise SystemExit(f"chooser exited {code}:\n" + buf.decode("utf8", "replace"))
    text = buf.decode("utf8", "replace")
    marker = "RESULT:"
    if marker not in text:
        raise SystemExit("chooser printed no result:\n" + text)
    return text.rsplit(marker, 1)[1].splitlines()[0].strip()

if pick(b"\r") != "0":
    raise SystemExit("enter should keep the first row")
if pick(b"\x1b[B\r") != "1":
    raise SystemExit("down should select the second row")
if pick(b"\x1b[A\r") != "1":
    raise SystemExit("up should wrap to the last row")
PY

(
  ordo_run_deploy() { printf '%s\n' "$*"; exit 0; }
  server=$(mktemp -d)
  mkdir -p "$server/scripts" "$server/apps/server"
  printf 'old\n' >"$server/scripts/deploy-server.js"
  got=$(ordo_exec_server "$server" 1 --yes)
  [[ "$got" == "$server --no-release --yes" ]] || fail "old release should skip its typed prompts, got $got"
  printf 'promptChoiceMenu\n' >"$server/scripts/deploy-server.js"
  got=$(ordo_exec_server "$server" 1 --port 8080)
  [[ "$got" == "$server --no-release --port 8080" ]] || fail "new release should ask itself, got $got"
  touch "$server/apps/server/.env"
  printf 'old\n' >"$server/scripts/deploy-server.js"
  got=$(ordo_exec_server "$server" 0)
  [[ "$got" == "$server" ]] || fail "an install that already exists should keep its own prompts, got $got"
  rm -rf "$server"
)

make_install() {
  local dir="$1"
  mkdir -p "$dir/scripts" "$dir/apps/server/prisma"
  printf 'packages:\n' >"$dir/pnpm-workspace.yaml"
  : >"$dir/scripts/deploy-server.js"
  printf 'local\n' >"$dir/apps/server/prisma/ordo.db"
}

msg=$(ORDO_DIR="$tmp/missing-ordo" ordo_uninstall --yes)
[[ "$msg" == *"Ordo is not installed"* ]] || fail "missing install, got $msg"

make_install "$tmp/installed"
msg=$(ORDO_DIR="$tmp/installed" ordo_uninstall --yes --dry-run)
[[ "$msg" == *"Would stop ordo and remove $tmp/installed"* ]] || fail "dry-run, got $msg"
[[ -f "$tmp/installed/apps/server/prisma/ordo.db" ]] || fail "dry-run removed the install"

msg=$(ORDO_DIR="$tmp/installed" ordo_uninstall --yes)
[[ "$msg" == *"Uninstalled Ordo from $tmp/installed"* ]] || fail "uninstall, got $msg"
[[ ! -d "$tmp/installed" ]] || fail "uninstall left the folder"

make_install "$tmp/foreign"
printf 'notes\n' >"$tmp/foreign/keep.txt"
rm -f "$tmp/foreign/pnpm-workspace.yaml"
status=0
msg=$(ORDO_DIR="$tmp/foreign" ordo_uninstall --yes 2>&1) || status=$?
[[ "$status" -ne 0 ]] || fail "a foreign folder should not be removed"
[[ -f "$tmp/foreign/keep.txt" ]] || fail "foreign folder was removed"
[[ "$msg" == *"not an Ordo install"* ]] || fail "foreign message, got $msg"

make_install "$tmp/checkout"
mkdir -p "$tmp/checkout/.git"
status=0
msg=$(ORDO_DIR="$tmp/checkout" ordo_uninstall --yes 2>&1) || status=$?
[[ "$status" -ne 0 ]] || fail "a git checkout should not be removed"
[[ -d "$tmp/checkout" ]] || fail "git checkout was removed"
[[ "$msg" == *"git checkout"* ]] || fail "git message, got $msg"

make_install "$tmp/home-root"
status=0
msg=$(HOME="$tmp/home-root" ORDO_DIR="$tmp/home-root" ordo_uninstall --yes 2>&1) || status=$?
[[ "$status" -ne 0 ]] || fail "HOME should not be removed"
[[ -d "$tmp/home-root" ]] || fail "HOME was removed"

make_install "$tmp/outside"
mkdir -p "$tmp/data"
printf 'secret\n' >"$tmp/data/ordo.db"
printf 'DATABASE_URL=file:%s\n' "$tmp/data/ordo.db" >"$tmp/outside/apps/server/.env"
msg=$(ORDO_DIR="$tmp/outside" ordo_uninstall --yes)
[[ "$msg" == *"Left the database at $tmp/data/ordo.db"* ]] || fail "outside database, got $msg"
[[ -f "$tmp/data/ordo.db" ]] || fail "outside database was removed"
[[ ! -d "$tmp/outside" ]] || fail "install with an outside database was kept"

make_install "$tmp/cancel"
(
  ordo_have_tty() { return 0; }
  ordo_ask_yes_no() { printf 'false\n'; }
  ORDO_DIR="$tmp/cancel" ordo_uninstall
) >"$tmp/cancel.out"
[[ -d "$tmp/cancel" ]] || fail "No should keep the install"
[[ "$(cat "$tmp/cancel.out")" == *"Uninstall cancelled."* ]] || fail "cancel message, got $(cat "$tmp/cancel.out")"

status=0
msg=$(
  ordo_have_tty() { return 1; }
  ORDO_DIR="$tmp/cancel" ordo_uninstall 2>&1
) || status=$?
[[ "$status" -ne 0 ]] || fail "uninstall without a terminal should stop"
[[ "$msg" == *"--yes"* ]] || fail "no-tty uninstall, got $msg"
[[ -d "$tmp/cancel" ]] || fail "no-tty uninstall removed the folder"

(
  ordo_ensure_node() { :; }
  ordo_ensure_pnpm() { :; }
  ordo_latest_tag() { printf 'v0.2.0\n'; }
  ordo_latest_pre_tag() { printf 'v0.3.0-beta.1\n'; }
  ordo_download_release() { fail "dry-run must not download"; }
  for flags in '--pre' '--release latest-pre'; do
    msg=$(ORDO_DIR="$tmp/fresh-dry" ordo_install_main --dry-run $flags)
    [[ "$msg" == *"v0.3.0-beta.1"* ]] || fail "fresh early-access selection: $msg"
    [[ ! -e "$tmp/fresh-dry" ]] || fail "dry-run created an install"
  done
  msg=$(ORDO_DIR="$tmp/fresh-dry" ordo_install_main --dry-run --release latest)
  [[ "$msg" == *"v0.2.0"* ]] || fail "fresh stable selection: $msg"
)

rm -rf "$tmp"
printf 'ok\n'
