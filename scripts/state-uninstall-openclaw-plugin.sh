#!/usr/bin/env bash
set -euo pipefail

PLUGIN_ID="state-consistency-bridge"

if ! command -v openclaw >/dev/null 2>&1; then
  echo "ERROR: openclaw CLI not found in PATH." >&2
  exit 1
fi

openclaw plugins disable "$PLUGIN_ID" >/dev/null 2>&1 || true
openclaw plugins uninstall "$PLUGIN_ID" >/dev/null 2>&1 || true
openclaw config unset "plugins.entries.$PLUGIN_ID" >/dev/null 2>&1 || true

echo "Removed plugin: $PLUGIN_ID"
echo "Restart the OpenClaw gateway to fully unload plugin hooks and commands."
