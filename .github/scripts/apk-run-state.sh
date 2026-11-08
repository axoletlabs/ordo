#!/usr/bin/env bash
# Normalize CI job combinations before baseline selection or OTA waiting.
set -euo pipefail
REPO="${GITHUB_REPOSITORY:?}"
RUN_ID="${1:?run id}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
gh api "repos/${REPO}/actions/runs/${RUN_ID}/jobs" --jq '.jobs' |
  jq -r -f "$SCRIPT_DIR/ci-apk-state.jq"
