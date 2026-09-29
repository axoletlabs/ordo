#!/usr/bin/env bash
set -euo pipefail
CHANNEL="${EXPO_UPDATES_CHANNEL:?An updates channel is required}"
if ! eas channel:view "$CHANNEL" --json --non-interactive >/dev/null; then
  # channel:create also creates and links the branch of the same name.
  eas channel:create "$CHANNEL" --non-interactive
fi
