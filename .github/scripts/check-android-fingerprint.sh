#!/usr/bin/env bash
# Compare this commit's Android fingerprint with the routing baseline and
# decide whether the push can OTA or must build an APK. Called by ci.yml's
# detect job; see docs/RELEASES.md "CI gates and native compatibility".
#
# Inputs (environment):
#   EVENT_BEFORE            github.event.before — all zeroes on a new branch
#   CURRENT_SHA             the commit being tested
#   GITHUB_RUN_ID           this run, excluded from in-flight baselines
#   ORDO_BUILD_BRANCH       stream branch (main or release/*)
#   EXPO_UPDATES_CHANNEL    channel baked into APKs on this stream
#   APP_VERSION             app version, for tag lookups on release/*
#   GITHUB_OUTPUT           step output file
#   GH_TOKEN, RUNNER_TEMP   provided by the runner
# Outputs (GITHUB_OUTPUT):
#   native_changed          true when an APK must be built
#   extra_runtime_versions  shipped APK runtimes a JS-only OTA must also target
#   baseline_sha            the baseline commit this comparison used
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [[ "${EVENT_BEFORE:-}" =~ ^0+$ ]]; then
  echo "native_changed=true" >> "$GITHUB_OUTPUT"
  echo "extra_runtime_versions=" >> "$GITHUB_OUTPUT"
  exit 0
fi

# Compare against an in-flight CI run on this branch (main or release/*)
# when one exists (an APK still building, or detect still running), else
# the last shipped APK on the same branch. Never compare one branch's APK
# to another's — the baked channel differs. Parent-commit comparison is
# wrong: a cancelled native bump would make later JS look unchanged vs
# parent and OTA a runtime that never got a binary. An in-flight APK *will*
# produce that binary, so a JS-only follow-up should OTA onto it instead of
# starting a second APK.
BASELINE_SHA="$(bash "$SCRIPT_DIR/apk-baseline-sha.sh" "$ORDO_BUILD_BRANCH" || true)"
if [[ -z "$BASELINE_SHA" ]]; then
  echo "No APK baseline on ${ORDO_BUILD_BRANCH}; treating as native-incompatible"
  echo "native_changed=true" >> "$GITHUB_OUTPUT"
  echo "extra_runtime_versions=" >> "$GITHUB_OUTPUT"
  exit 0
fi
echo "Fingerprint baseline SHA: $BASELINE_SHA"
echo "baseline_sha=$BASELINE_SHA" >> "$GITHUB_OUTPUT"
if [[ "$BASELINE_SHA" == "$CURRENT_SHA" ]]; then
  echo "This commit is the fingerprint baseline"
  echo "native_changed=false" >> "$GITHUB_OUTPUT"
  echo "extra_runtime_versions=" >> "$GITHUB_OUTPUT"
  exit 0
fi
if ! git cat-file -e "${BASELINE_SHA}^{commit}" 2>/dev/null; then
  echo "Baseline ${BASELINE_SHA} is not in this clone; requiring an APK"
  echo "native_changed=true" >> "$GITHUB_OUTPUT"
  echo "extra_runtime_versions=" >> "$GITHUB_OUTPUT"
  exit 0
fi

# Isolated worktree + a wrapper that process.exit()s after JSON so
# leftover autolinking children cannot wedge detect.
PREV_DIR="${RUNNER_TEMP}/fp-prev"
rm -rf "$PREV_DIR"
if ! git worktree add --detach "$PREV_DIR" "$BASELINE_SHA"; then
  echo "Could not check out baseline ${BASELINE_SHA}; requiring an APK"
  echo "native_changed=true" >> "$GITHUB_OUTPUT"
  echo "extra_runtime_versions=" >> "$GITHUB_OUTPUT"
  exit 0
fi
cleanup() { git worktree remove --force "$PREV_DIR" 2>/dev/null || true; }
trap cleanup EXIT

generate_fingerprint() {
  local dir="$1"
  local out="$2"
  echo "Installing $(git -C "$dir" rev-parse --short HEAD) in $dir"
  (cd "$dir" && pnpm install --frozen-lockfile)
  echo "Generating fingerprint for $(git -C "$dir" rev-parse --short HEAD)"
  # stdin closed: ExpoConfigLoader / autolinking inherit the Actions
  # pipe and can wait forever for EOF. timeout is a last resort if
  # createFingerprintAsync itself never resolves.
  (
    cd "$dir/apps/mobile"
    timeout --kill-after=5s 60s node "$SCRIPT_DIR/generate-android-fingerprint.js" --platform android \
      < /dev/null > "$out"
  )
  echo "Wrote $out ($(wc -c < "$out") bytes)"
}

generate_fingerprint "$PREV_DIR" /tmp/fingerprint-previous.json
generate_fingerprint "$GITHUB_WORKSPACE" /tmp/fingerprint-current.json

normalize_fingerprint() {
  jq -f "$SCRIPT_DIR/normalize-android-fingerprint.jq" "$1" > "$1.normalized"
}

# extra.ordo and packageJson:scripts change every JS commit / test file
# but do not affect native compatibility. Stripping them for routing
# avoids minting a new APK (and abandoning the previous runtime).
normalize_fingerprint /tmp/fingerprint-previous.json
normalize_fingerprint /tmp/fingerprint-current.json

extra_runtimes=()
current_hash="$(jq -r '.hash' /tmp/fingerprint-current.json)"
add_extra_runtime() {
  local runtime="$1"
  local sha="$2"
  [[ -z "$runtime" || "$runtime" == "null" ]] && return 0
  case " ${extra_runtimes[*]} " in
    *" $runtime "*) return 0 ;;
  esac
  echo "Compatible APK runtime ${runtime} from ${sha}"
  extra_runtimes+=("$runtime")
}
collect_runtime_if_compatible() {
  local sha="$1"
  local fp="$2"
  local hash embedded
  hash="$(jq -r '.hash' "$fp")"
  if [[ -z "$hash" || "$hash" == "null" ]]; then
    return 0
  fi
  # Detect hash matching is not enough: the APK may have baked
  # Gradle's post-compile fingerprint. Pin to that when it differs.
  if [[ "$hash" == "$current_hash" ]]; then
    embedded="$(bash "$SCRIPT_DIR/apk-embedded-runtime.sh" --sha "$sha" --branch "$ORDO_BUILD_BRANCH" || true)"
    if [[ -n "$embedded" && "$embedded" != "$current_hash" ]]; then
      add_extra_runtime "$embedded" "$sha"
    fi
    return 0
  fi
  normalize_fingerprint "$fp"
  if cmp -s /tmp/fingerprint-current.json.normalized "$fp.normalized"; then
    embedded="$(bash "$SCRIPT_DIR/apk-embedded-runtime.sh" --sha "$sha" --branch "$ORDO_BUILD_BRANCH" || true)"
    add_extra_runtime "$embedded" "$sha"
  else
    echo "Skipping APK ${sha}: native fingerprint differs"
  fi
}

if cmp -s /tmp/fingerprint-previous.json.normalized /tmp/fingerprint-current.json.normalized; then
  echo "native_changed=false" >> "$GITHUB_OUTPUT"
  # Shipped binaries first. An in-flight JS commit can share a
  # normalized fingerprint but a different raw hash — that hash is
  # not an APK runtime and must not block the last-APK scan.
  while read -r apk_sha; do
    [[ -z "$apk_sha" ]] && continue
    if [[ "$apk_sha" == "$CURRENT_SHA" || "$apk_sha" == "$BASELINE_SHA" ]]; then
      continue
    fi
    extra_dir="${RUNNER_TEMP}/fp-${apk_sha:0:8}"
    rm -rf "$extra_dir"
    if ! git cat-file -e "${apk_sha}^{commit}" 2>/dev/null; then
      echo "Skipping APK ${apk_sha}: commit is not in this clone"
      continue
    fi
    if ! git worktree add --detach "$extra_dir" "$apk_sha"; then
      echo "Skipping APK ${apk_sha}: worktree failed"
      continue
    fi
    if generate_fingerprint "$extra_dir" "/tmp/fingerprint-${apk_sha}.json"; then
      collect_runtime_if_compatible "$apk_sha" "/tmp/fingerprint-${apk_sha}.json"
    else
      echo "Skipping APK ${apk_sha}: fingerprint failed"
    fi
    git worktree remove --force "$extra_dir" 2>/dev/null || true
    if (( ${#extra_runtimes[@]} >= 1 )); then
      break
    fi
  done < <(bash "$SCRIPT_DIR/last-apk-shas.sh" "$ORDO_BUILD_BRANCH" 3 || true)
  # Upcoming APK (in-flight native bump) if its raw hash differs.
  collect_runtime_if_compatible "$BASELINE_SHA" /tmp/fingerprint-previous.json
else
  echo "native_changed=true" >> "$GITHUB_OUTPUT"
fi
echo "extra_runtime_versions=${extra_runtimes[*]}" >> "$GITHUB_OUTPUT"
