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
If pnpm is missing, you choose whether to install it.
On a terminal, the arrow keys pick the release.
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
  local answer=""
  if ! ordo_have_tty; then
    printf '2\n'
    return 0
  fi
  printf '%s\n' \
    "pnpm is not installed." \
    "" \
    "  1  Install pnpm ${ORDO_PNPM_VERSION}" \
    "  2  I'll install it myself" \
    "" >/dev/tty
  printf 'Choice: ' >/dev/tty
  IFS= read -r answer </dev/tty || answer=""
  answer="${answer#"${answer%%[![:space:]]*}"}"
  answer="${answer%"${answer##*[![:space:]]}"}"
  case "$answer" in
    1 | y | Y | yes | YES) printf '1\n' ;;
    *) printf '2\n' ;;
  esac
}

ordo_pnpm_how() {
  printf '%s\n' \
    "Install it, then run this again." \
    "" \
    "curl -fsSL https://get.pnpm.io/install.sh | env PNPM_VERSION=${ORDO_PNPM_VERSION} sh -" \
    "" \
    "https://pnpm.io/installation"
}

ordo_install_pnpm() {
  local script
  script=$(mktemp)
  if ! curl -fsSL --retry 3 --retry-delay 2 -o "$script" https://get.pnpm.io/install.sh; then
    rm -f "$script"
    return 1
  fi
  # stdin is /dev/null so a curl | bash install does not lose the rest of this script.
  if ! env PNPM_VERSION="$ORDO_PNPM_VERSION" sh "$script" </dev/null; then
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
  ordo_is_ordo_tree "$dest" || ordo_die "The ${tag} download is not an Ordo server."
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
    ordo_run_deploy "$dest" "$@"
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
  ordo_run_deploy "$dest" "$@"
}

if [[ -z "${BASH_SOURCE[0]:-}" || "${BASH_SOURCE[0]}" == "$0" ]]; then
  ordo_install_main "$@"
fi
