#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
PLUGIN_DIR="$ROOT_DIR/plugins/state-consistency-bridge"
PLUGIN_ID="state-consistency-bridge"

if ! command -v openclaw >/dev/null 2>&1; then
  echo "ERROR: openclaw CLI not found in PATH." >&2
  exit 1
fi

if [ ! -f "$PLUGIN_DIR/openclaw.plugin.json" ]; then
  echo "ERROR: plugin manifest not found at $PLUGIN_DIR/openclaw.plugin.json" >&2
  exit 1
fi

openclaw plugins install -l "$PLUGIN_DIR"
openclaw plugins enable "$PLUGIN_ID" >/dev/null 2>&1 || true

# Point plugin config at this repository root so it can find state runtime files.
openclaw config set "plugins.entries.$PLUGIN_ID.config.rootDir" "$ROOT_DIR"
openclaw config set --json "plugins.entries.$PLUGIN_ID.config.injectContext" true
openclaw config set --json "plugins.entries.$PLUGIN_ID.config.includePending" true
openclaw config set --json "plugins.entries.$PLUGIN_ID.config.injectMaxFields" 32

echo "Installed plugin: $PLUGIN_ID"
echo "Configured rootDir: $ROOT_DIR"
echo "Restart the OpenClaw gateway to activate plugin hooks and commands."
