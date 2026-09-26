#!/usr/bin/env bash
# Install the Ordo server from a published GitHub Release.
#
#   curl -fsSL https://ordo.axolet.com/install | bash
#   curl -fsSL https://ordo.axolet.com/install | bash -s -- --yes
#   ORDO_DIR=/opt/ordo curl -fsSL https://ordo.axolet.com/install | bash
set -euo pipefail

ORDO_REPO_DEFAULT="axoletlabs/ordo"

ordo_die() {
  printf 'error: %s\n' "$1" >&2
  exit 1
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
Usage: install.sh [deploy-server flags]

  curl -fsSL https://ordo.axolet.com/install | bash
  curl -fsSL https://ordo.axolet.com/install | bash -s -- --yes
  curl -fsSL https://ordo.axolet.com/install | bash -s -- --yes --release v0.1.0

Installs a published GitHub Release into ~/ordo. Set ORDO_DIR to use another
folder. Node.js 22.13 or newer is required. Flags are passed through to
scripts/deploy-server. On a terminal, the arrow keys pick the release.
EOF
}

ordo_ensure_node() {
  command -v node >/dev/null 2>&1 || ordo_die "Node.js 22.13 or newer is required. https://nodejs.org"
  local version
  version=$(node -p 'process.versions.node')
  ordo_node_ok "$version" || ordo_die "Node.js 22.13 or newer is required (this is ${version})."
}

ordo_ensure_pnpm() {
  if command -v pnpm >/dev/null 2>&1; then
    return 0
  fi
  command -v corepack >/dev/null 2>&1 || ordo_die "pnpm is required. https://pnpm.io/installation"
  corepack enable
  corepack prepare pnpm@11.10.0 --activate
  command -v pnpm >/dev/null 2>&1 || ordo_die "pnpm is required. https://pnpm.io/installation"
}

ordo_latest_tag() {
  local repo="$1" url tag
  url=$(curl -fsSL -o /dev/null -w '%{url_effective}' "https://github.com/${repo}/releases/latest") ||
    ordo_die "Could not read the latest release of ${repo}."
  tag="${url##*/}"
  [[ "$tag" == v* ]] || ordo_die "No stable GitHub Release was found for ${repo}."
  printf '%s\n' "$tag"
}

ordo_download_release() {
  local dest="$1" tag="$2" repo="$3"
  local asset tmp url
  asset=$(ordo_asset_name "$tag")
  tmp=$(mktemp -d)
  trap 'rm -rf "$tmp"' RETURN
  url="https://github.com/${repo}/releases/download/${tag}/${asset}"
  printf 'Downloading %s\n' "$tag"
  curl -fsSL --retry 3 --retry-delay 2 -o "${tmp}/${asset}" "$url" ||
    ordo_die "Could not download ${url}"
  curl -fsSL --retry 3 --retry-delay 2 -o "${tmp}/${asset}.sha256" "${url}.sha256" ||
    ordo_die "Could not download the checksum for ${tag}."
  ordo_verify_sha256 "${tmp}/${asset}" "${tmp}/${asset}.sha256" ||
    ordo_die "Checksum mismatch for ${asset}."
  mkdir -p "$dest"
  tar -xzf "${tmp}/${asset}" -C "$dest" --strip-components=1
  ordo_is_ordo_tree "$dest" || ordo_die "The ${tag} archive did not contain the Ordo server."
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
    printf 'ordo is in %s\n' "$dest"
    ordo_run_deploy "$dest" "$@"
  fi
  if [[ -e "$dest" ]] && ! ordo_dir_empty "$dest"; then
    ordo_die "${dest} is not empty. Set ORDO_DIR to an empty folder."
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
      ordo_die "Pass --release with a pre-release tag, for example v0.1.0-beta.1."
    else
      ordo_die "--release expects a version like v0.1.0."
    fi
  else
    tag=$(ordo_latest_tag "$repo")
  fi

  printf 'Installing ordo %s into %s\n' "$tag" "$dest"
  ordo_download_release "$dest" "$tag" "$repo"
  ordo_run_deploy "$dest" "$@"
}

if [[ -z "${BASH_SOURCE[0]:-}" || "${BASH_SOURCE[0]}" == "$0" ]]; then
  ordo_install_main "$@"
fi
