#!/usr/bin/env bash
# Install the Ordo server from a published GitHub Release.
#
#   curl -fsSL https://ordo.axolet.com/install | bash
#   curl -fsSL https://ordo.axolet.com/install | bash -s -- --yes
#   ORDO_DIR=/opt/ordo curl -fsSL https://ordo.axolet.com/install | bash
set -euo pipefail

ORDO_REPO_DEFAULT="axoletlabs/ordo"

# Same pin as package.json "packageManager".
ORDO_PNPM_VERSION="11.10.0"

ordo_die() {
  printf '%s\n' "$1" >&2
  exit 1
}

ordo_node_missing() {
  printf '%s\n' \
    "Node.js is not installed." \
    "" \
    "Ordo needs Node.js 22.13 or newer." \
    "https://nodejs.org"
}

ordo_node_ok() {
  local version="$1" major minor
  IFS=. read -r major minor _ <<<"$version"
  major="${major:-0}"
  minor="${minor:-0}"
  if (( major > 22 )); then
    return 0
  fi
  if (( major == 22 && minor >= 13 )); then
    return 0
  fi
  return 1
}

ordo_wants_help() {
  local arg
  for arg in "$@"; do
    case "$arg" in
      -h | --help) return 0 ;;
    esac
  done
  return 1
}

ordo_release_from_args() {
  local prev="" arg
  for arg in "$@"; do
    case "$arg" in
      --release=*)
        printf '%s\n' "${arg#--release=}"
        return 0
        ;;
      --release)
        prev=1
        ;;
      *)
        if [[ "$prev" == 1 ]]; then
          printf '%s\n' "$arg"
          return 0
        fi
        prev=""
        ;;
    esac
  done
  return 1
}

# Prints a vX.Y.Z tag. Returns 1 for latest, 2 for latest-pre, 3 for junk.
ordo_normalize_tag() {
  local raw="$1" tag="$1"
  case "$raw" in
    "" | latest) return 1 ;;
    latest-pre) return 2 ;;
  esac
  [[ "$tag" == v* ]] || tag="v${tag}"
  if [[ ! "$tag" =~ ^v[0-9]+\.[0-9]+\.[0-9]+(-(alpha|beta|rc)(\.[0-9]+)?)?$ ]]; then
    return 3
  fi
  printf '%s\n' "$tag"
}

ordo_asset_name() {
  printf 'ordo-server-%s.tar.gz\n' "$1"
}

ordo_is_ordo_tree() {
  [[ -f "$1/pnpm-workspace.yaml" && -f "$1/scripts/deploy-server.js" ]]
}

ordo_dir_empty() {
  local any
  [[ -d "$1" ]] || return 0
  any=$(find "$1" -mindepth 1 -maxdepth 1 -print -quit 2>/dev/null || true)
  [[ -z "$any" ]]
}

ordo_verify_sha256() {
  local file="$1" sumfile="$2" expected actual
  expected=$(awk 'NF { print $1; exit }' "$sumfile")
  if command -v sha256sum >/dev/null 2>&1; then
    actual=$(sha256sum "$file" | awk '{ print $1 }')
  else
    actual=$(shasum -a 256 "$file" | awk '{ print $1 }')
  fi
  [[ -n "$expected" && "$expected" == "$actual" ]]
}

ordo_print_help() {
  cat <<'EOF'
Usage: install.sh [flags for the server installer]

  curl -fsSL https://ordo.axolet.com/install | bash
  curl -fsSL https://ordo.axolet.com/install | bash -s -- --yes
  curl -fsSL https://ordo.axolet.com/install | bash -s -- --yes --release v0.1.0

Installs the latest Ordo server release into ~/ordo.
Set ORDO_DIR to use another folder.
Needs Node.js 22.13 or newer.
If pnpm is missing, the arrow keys choose whether to install it.
On a terminal, move with the arrow keys and press enter.
Enter keeps a default port or SMTP URL.
EOF
}

ordo_ensure_node() {
  local version=""
  if ! command -v node >/dev/null 2>&1; then
    ordo_die "$(ordo_node_missing)"
  fi
  version=$(node -p 'process.versions.node' 2>/dev/null) || version=""
  if [[ -z "$version" || "$version" != [0-9]* ]]; then
    ordo_die "$(ordo_node_missing)"
  fi
  if ! ordo_node_ok "$version"; then
    ordo_die "$(printf '%s\n' \
      "This machine has Node.js ${version}." \
      "Ordo needs Node.js 22.13 or newer." \
      "https://nodejs.org")"
  fi
}

# Same directories as https://get.pnpm.io/install.sh
ordo_pnpm_home() {
  if [[ -n "${PNPM_HOME:-}" ]]; then
    printf '%s\n' "$PNPM_HOME"
  elif [[ -n "${XDG_DATA_HOME:-}" ]]; then
    printf '%s/pnpm\n' "$XDG_DATA_HOME"
  elif [[ "$(uname -s)" == "Darwin" ]]; then
    printf '%s/Library/pnpm\n' "$HOME"
  else
    printf '%s/.local/share/pnpm\n' "$HOME"
  fi
}

ordo_prepend_path() {
  local dir="$1"
  [[ -n "$dir" && -d "$dir" ]] || return 0
  case ":${PATH}:" in
    *":${dir}:"*) ;;
    *) export PATH="${dir}:${PATH}" ;;
  esac
}

ordo_have_tty() {
  [[ -r /dev/tty && -w /dev/tty ]]
}

# Prints 1 to install, 2 to leave it. Never installs on its own.
ordo_pnpm_choice() {
  local index=""
  if ! ordo_have_tty; then
    printf '2\n'
    return 0
  fi
  index=$(ordo_choose 0 "pnpm is not installed." \
    "Install pnpm ${ORDO_PNPM_VERSION}" \
    "I'll install it myself")
  if [[ "$index" == 0 ]]; then
    printf '1\n'
  else
    printf '2\n'
  fi
}

ordo_pnpm_how() {
  printf '%s\n' \
    "Install it, then run this again." \
    "" \
    "curl -fsSL https://get.pnpm.io/install.sh | env PNPM_VERSION=${ORDO_PNPM_VERSION} sh -" \
    "" \
    "https://pnpm.io/installation"
}

ordo_fetch_pnpm_script() {
  curl -fsSL --retry 3 --retry-delay 2 -o "$1" https://get.pnpm.io/install.sh
}

# The official installer prints its own --force warning and update notice.
# Keep that log for failures only.
ordo_run_pnpm_script() {
  local script="$1" log="" status=0
  log=$(mktemp)
  env PNPM_VERSION="$ORDO_PNPM_VERSION" \
    NO_UPDATE_NOTIFIER=1 \
    npm_config_update_notifier=false \
    sh "$script" </dev/null >"$log" 2>&1 || status=$?
  if [[ "$status" -ne 0 ]]; then
    cat "$log" >&2
    rm -f "$log"
    return "$status"
  fi
  rm -f "$log"
}

ordo_install_pnpm() {
  local script
  script=$(mktemp)
  if ! ordo_fetch_pnpm_script "$script"; then
    rm -f "$script"
    return 1
  fi
  # stdin is /dev/null so a curl | bash install does not lose the rest of this script.
  if ! ordo_run_pnpm_script "$script"; then
    rm -f "$script"
    return 1
  fi
  rm -f "$script"
}

ordo_ensure_pnpm() {
  local choice="" home=""
  if command -v pnpm >/dev/null 2>&1; then
    return 0
  fi
  [[ -n "${HOME:-}" ]] || ordo_die "HOME is not set, so pnpm cannot be installed."
  choice=$(ordo_pnpm_choice)
  if [[ "$choice" != "1" ]]; then
    ordo_die "$(printf '%s\n\n%s\n' "pnpm is not installed." "$(ordo_pnpm_how)")"
  fi
  home=$(ordo_pnpm_home)
  printf 'Installing pnpm %s\n' "$ORDO_PNPM_VERSION"
  if ! ordo_install_pnpm; then
    ordo_die "$(printf '%s\n\n%s\n' "Could not install pnpm." "$(ordo_pnpm_how)")"
  fi
  printf 'Installed pnpm %s\n' "$ORDO_PNPM_VERSION"
  ordo_prepend_path "$home"
  ordo_prepend_path "${home}/bin"
  hash -r 2>/dev/null || true
  if ! command -v pnpm >/dev/null 2>&1; then
    ordo_die "$(printf '%s\n' \
      "pnpm was installed, but this shell cannot find it." \
      "" \
      "Open a new terminal, or add this directory to PATH:" \
      "$home")"
  fi
}

ordo_latest_tag() {
  local repo="$1" url tag
  url=$(curl -fsSL -o /dev/null -w '%{url_effective}' "https://github.com/${repo}/releases/latest") ||
    ordo_die "Could not find the latest Ordo release."
  tag="${url##*/}"
  [[ "$tag" == v* ]] || ordo_die "There is no stable Ordo release yet."
  printf '%s\n' "$tag"
}

ordo_download_release() {
  local dest="$1" tag="$2" repo="$3"
  local asset tmp url
  asset=$(ordo_asset_name "$tag")
  tmp=$(mktemp -d)
  trap 'rm -rf "$tmp"' RETURN
  url="https://github.com/${repo}/releases/download/${tag}/${asset}"
  printf 'Downloading Ordo %s\n' "$tag"
  curl -fsSL --retry 3 --retry-delay 2 -o "${tmp}/${asset}" "$url" ||
    ordo_die "Could not download Ordo ${tag}."
  curl -fsSL --retry 3 --retry-delay 2 -o "${tmp}/${asset}.sha256" "${url}.sha256" ||
    ordo_die "Could not download the checksum for ${tag}."
  ordo_verify_sha256 "${tmp}/${asset}" "${tmp}/${asset}.sha256" ||
    ordo_die "The download for ${tag} did not match its checksum."
  mkdir -p "$dest"
  tar -xzf "${tmp}/${asset}" -C "$dest" --strip-components=1
  if ! ordo_is_ordo_tree "$dest"; then
    rm -rf "$tmp"
    trap - RETURN
    ordo_die "The ${tag} download is not an Ordo server."
  fi
  rm -rf "$tmp"
  trap - RETURN
}

ordo_paint() {
  local code="$1" text="$2"
  if [[ "${ORDO_MENU_COLOR:-0}" == 1 && -n "$code" ]]; then
    printf '\033[%sm%s\033[0m' "$code" "$text"
  else
    printf '%s' "$text"
  fi
}

# Title, blank line, one row per option, blank line, hint.
ordo_menu_lines() {
  printf '%s\n' "$(( $1 + 4 ))"
}

ordo_menu_frame() {
  local title="$1" selected="$2" index=0
  shift 2
  ordo_paint "1" "$title"
  printf '\n\n'
  while [[ $# -gt 0 ]]; do
    if [[ "$index" -eq "$selected" ]]; then
      printf '  '
      ordo_paint "36" "›"
      printf ' '
      ordo_paint "1" "$1"
      printf '\n'
    else
      printf '    '
      ordo_paint "2" "$1"
      printf '\n'
    fi
    index=$((index + 1))
    shift
  done
  printf '\n  '
  ordo_paint "2" "↑↓ move    enter select"
  printf '\n'
}

ordo_choice_step() {
  local index="$1" count="$2" dir="$3"
  if [[ "$dir" == "up" ]]; then
    if [[ "$index" -le 0 ]]; then
      printf '%s\n' "$((count - 1))"
    else
      printf '%s\n' "$((index - 1))"
    fi
  else
    printf '%s\n' "$(( (index + 1) % count ))"
  fi
}

ordo_menu_stop() {
  printf '\033[?25h' >/dev/tty 2>/dev/null || true
  if [[ -n "${ORDO_STTY_SAVED:-}" ]]; then
    stty "$ORDO_STTY_SAVED" </dev/tty 2>/dev/null || true
    ORDO_STTY_SAVED=""
  fi
}

ordo_menu_on_int() {
  ordo_menu_stop
  trap - INT TERM EXIT
  exit 130
}

# Prints the selected index. Draws on /dev/tty so the caller can capture stdout.
ordo_choose() {
  local selected="$1" title="$2" key="" rest="" drawn=0 count=0
  local options
  shift 2
  options=("$@")
  count=${#options[@]}
  [[ "$count" -gt 0 ]] || return 1
  if [[ -z "${NO_COLOR:-}" ]]; then
    ORDO_MENU_COLOR=1
  else
    ORDO_MENU_COLOR=0
  fi
  ORDO_STTY_SAVED=$(stty -g </dev/tty)
  trap ordo_menu_on_int INT TERM
  trap ordo_menu_stop EXIT
  stty -echo -icanon min 1 time 0 </dev/tty
  printf '\033[?25l' >/dev/tty
  while true; do
    if [[ "$drawn" -gt 0 ]]; then
      printf '\033[%sA\033[J' "$drawn" >/dev/tty
    fi
    ordo_menu_frame "$title" "$selected" "${options[@]}" >/dev/tty
    drawn=$(ordo_menu_lines "$count")
    key=""
    IFS= read -rsn1 key </dev/tty || key=""
    if [[ "$key" == $'\033' ]]; then
      stty min 0 time 1 </dev/tty
      rest=""
      IFS= read -rsn2 rest </dev/tty || true
      stty min 1 time 0 </dev/tty
      key="${key}${rest}"
    fi
    case "$key" in
      $'\033[A' | $'\033OA') selected=$(ordo_choice_step "$selected" "$count" up) ;;
      $'\033[B' | $'\033OB') selected=$(ordo_choice_step "$selected" "$count" down) ;;
      "" | $'\n' | $'\r') break ;;
    esac
  done
  trap - INT TERM EXIT
  ordo_menu_stop
  printf '%s\n' "$selected"
}

ordo_read_default() {
  local prompt="$1" fallback="$2" answer=""
  printf '%s' "$prompt" >/dev/tty
  IFS= read -r answer </dev/tty || answer=""
  answer="${answer#"${answer%%[![:space:]]*}"}"
  answer="${answer%"${answer##*[![:space:]]}"}"
  if [[ -z "$answer" ]]; then
    printf '%s\n' "$fallback"
  else
    printf '%s\n' "$answer"
  fi
}

ordo_valid_port() {
  [[ "$1" =~ ^[0-9]+$ ]] || return 1
  [[ "$((10#$1))" -ge 1 && "$((10#$1))" -le 65535 ]]
}

ordo_valid_hops() {
  [[ "$1" =~ ^[0-9]+$ ]] || return 1
  [[ "$((10#$1))" -ge 0 && "$((10#$1))" -le 32 ]]
}

ordo_ask_yes_no() {
  local title="$1" selected="$2" index=""
  index=$(ordo_choose "$selected" "$title" "Yes" "No")
  if [[ "$index" == 0 ]]; then
    printf 'true\n'
  else
    printf 'false\n'
  fi
}

ordo_arg_present() {
  local name="$1" arg
  shift
  for arg in "$@"; do
    case "$arg" in
      "$name" | "${name}="*) return 0 ;;
    esac
  done
  return 1
}

ordo_setup_skipped() {
  local arg
  if ! ordo_have_tty; then
    return 0
  fi
  if [[ "${CI:-}" == "true" || "${CI:-}" == "1" ]]; then
    return 0
  fi
  for arg in "$@"; do
    case "$arg" in
      -y | --yes | --non-interactive | --from-git | --pull) return 0 ;;
    esac
  done
  return 1
}

ordo_wants_from_git() {
  ordo_arg_present --from-git "$@" || ordo_arg_present --pull "$@"
}

ordo_without_release_args() {
  local skip=0 arg
  ORDO_FORWARDED=()
  for arg in "$@"; do
    if [[ "$skip" == 1 ]]; then
      skip=0
      continue
    fi
    case "$arg" in
      --release) skip=1 ;;
      --release=*) ;;
      *) ORDO_FORWARDED+=("$arg") ;;
    esac
  done
}

ordo_bind_setup_flags() {
  local port="$1" registration="$2" email="$3" smtp="$4" smtp_from="$5"
  local trust="$6" public="$7" start="$8"
  shift 8
  ORDO_SETUP_FLAGS=(--yes)
  ordo_arg_present --port "$@" || ORDO_SETUP_FLAGS+=(--port "$port")
  ordo_arg_present --registration "$@" || ORDO_SETUP_FLAGS+=(--registration "$registration")
  ordo_arg_present --email-verification "$@" || ORDO_SETUP_FLAGS+=(--email-verification "$email")
  if [[ -n "$smtp" ]] && ! ordo_arg_present --smtp-url "$@"; then
    ORDO_SETUP_FLAGS+=(--smtp-url "$smtp")
    if [[ -n "$smtp_from" ]] && ! ordo_arg_present --smtp-from "$@"; then
      ORDO_SETUP_FLAGS+=(--smtp-from "$smtp_from")
    fi
  fi
  ordo_arg_present --trust-proxy "$@" || ORDO_SETUP_FLAGS+=(--trust-proxy "$trust")
  if [[ "$public" == 1 ]] && ! ordo_arg_present --public "$@"; then
    ORDO_SETUP_FLAGS+=(--public)
  fi
  if ! ordo_arg_present --start "$@" && ! ordo_arg_present --no-start "$@"; then
    if [[ "$start" == 1 ]]; then
      ORDO_SETUP_FLAGS+=(--start)
    else
      ORDO_SETUP_FLAGS+=(--no-start)
    fi
  fi
}

ordo_ask_setup() {
  local port="3000" registration="false" email="false" smtp="" smtp_from=""
  local trust="0" public="0" start="0" answer=""
  printf '\n' >/dev/tty
  if ! ordo_arg_present --port "$@"; then
    port=$(ordo_read_default "HTTP port [3000] " "3000")
    ordo_valid_port "$port" || ordo_die "The HTTP port needs to be a number from 1 to 65535."
  fi
  if ! ordo_arg_present --registration "$@"; then
    registration=$(ordo_ask_yes_no "Allow new sign-ups after the first account?" 1)
  fi
  if ! ordo_arg_present --email-verification "$@"; then
    email=$(ordo_ask_yes_no "Require email verification?" 1)
  fi
  if ! ordo_arg_present --smtp-url "$@"; then
    smtp=$(ordo_read_default "SMTP URL (empty = print one-time codes in the console) " "")
    if [[ -n "$smtp" ]] && ! ordo_arg_present --smtp-from "$@"; then
      smtp_from=$(ordo_read_default "SMTP from address [ordo <noreply@ordo.local>] " "ordo <noreply@ordo.local>")
    fi
  fi
  if ! ordo_arg_present --trust-proxy "$@" && ! ordo_arg_present --public "$@"; then
    answer=$(ordo_ask_yes_no "Behind nginx, Caddy, or Cloudflare?" 1)
    if [[ "$answer" == true ]]; then
      trust=$(ordo_read_default "Reverse-proxy hops to trust [1] " "1")
      ordo_valid_hops "$trust" || ordo_die "Reverse-proxy hops need to be a number from 0 to 32."
    else
      answer=$(ordo_ask_yes_no "Listen on the LAN without a reverse proxy (0.0.0.0)?" 1)
      if [[ "$answer" == true ]]; then
        public=1
      fi
    fi
  fi
  if ! ordo_arg_present --start "$@" && ! ordo_arg_present --no-start "$@"; then
    answer=$(ordo_ask_yes_no "Start the server in the foreground when done?" 1)
    if [[ "$answer" == true ]]; then
      start=1
    fi
  fi
  ordo_bind_setup_flags "$port" "$registration" "$email" "$smtp" "$smtp_from" "$trust" "$public" "$start" "$@"
}

ordo_looks_installed() {
  local dest="$1"
  [[ -f "$dest/apps/server/.env" || -f "$dest/apps/server/.ordo-secret" || -f "$dest/apps/server/prisma/ordo.db" ]]
}

# A deploy script that names promptChoiceMenu already asks with the arrow keys.
ordo_delegate_setup() {
  local file="$1/scripts/deploy-server.js"
  [[ -f "$file" ]] && grep -q "promptChoiceMenu" "$file"
}

ordo_run_deploy() {
  local dest="$1"
  shift
  cd "$dest"
  if [[ -r /dev/tty ]]; then
    exec node ./scripts/deploy-server.js "$@" </dev/tty
  fi
  exec node ./scripts/deploy-server.js "$@"
}

ordo_run_deploy_args() {
  local dest="$1"
  shift
  if [[ $# -eq 0 ]]; then
    ordo_run_deploy "$dest"
  else
    ordo_run_deploy "$dest" "$@"
  fi
}

# fresh=1 means this script just unpacked the release, so do not download it again.
ordo_exec_server() {
  local dest="$1" fresh="$2"
  shift 2

  if ordo_wants_from_git "$@"; then
    ordo_run_deploy_args "$dest" "$@"
  fi

  if [[ "$fresh" == 1 ]]; then
    ordo_without_release_args "$@"
    if ordo_delegate_setup "$dest" || ordo_setup_skipped "$@" || ordo_looks_installed "$dest"; then
      ordo_run_deploy_args "$dest" --no-release ${ORDO_FORWARDED[@]+"${ORDO_FORWARDED[@]}"}
    fi
    ordo_ask_setup "$@"
    ordo_run_deploy_args "$dest" "${ORDO_SETUP_FLAGS[@]}" --no-release ${ORDO_FORWARDED[@]+"${ORDO_FORWARDED[@]}"}
  fi

  if ordo_delegate_setup "$dest" || ordo_setup_skipped "$@" || ordo_looks_installed "$dest"; then
    ordo_run_deploy_args "$dest" "$@"
  fi

  ordo_without_release_args "$@"
  ordo_ask_setup "$@"
  ordo_run_deploy_args "$dest" "${ORDO_SETUP_FLAGS[@]}" --no-release ${ORDO_FORWARDED[@]+"${ORDO_FORWARDED[@]}"}
}

ordo_install_main() {
  local repo="${ORDO_REPO:-$ORDO_REPO_DEFAULT}"
  local dest="${ORDO_DIR:-$HOME/ordo}"
  local raw="" tag="" status=0

  if ordo_wants_help "$@"; then
    ordo_print_help
    exit 0
  fi

  ordo_ensure_node
  ordo_ensure_pnpm

  if ordo_is_ordo_tree "$dest"; then
    printf 'Using %s\n' "$dest"
    ordo_exec_server "$dest" 0 "$@"
  fi
  if [[ -e "$dest" ]] && ! ordo_dir_empty "$dest"; then
    ordo_die "$(printf '%s\n' \
      "${dest} is not empty." \
      "" \
      "Set ORDO_DIR to an empty folder and run this again.")"
  fi

  if raw=$(ordo_release_from_args "$@"); then
    set +e
    tag=$(ordo_normalize_tag "$raw")
    status=$?
    set -e
    if [[ "$status" == 0 ]]; then
      :
    elif [[ "$status" == 1 ]]; then
      tag=$(ordo_latest_tag "$repo")
    elif [[ "$status" == 2 ]]; then
      ordo_die "--release needs a pre-release like v0.1.0-beta.1."
    else
      ordo_die "--release needs a version like v0.1.0."
    fi
  else
    tag=$(ordo_latest_tag "$repo")
  fi

  printf 'Installing Ordo %s into %s\n' "$tag" "$dest"
  ordo_download_release "$dest" "$tag" "$repo"
  ordo_exec_server "$dest" 1 "$@"
}

if [[ -z "${BASH_SOURCE[0]:-}" || "${BASH_SOURCE[0]}" == "$0" ]]; then
  ordo_install_main "$@"
fi
