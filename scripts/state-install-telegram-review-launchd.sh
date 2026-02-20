#!/usr/bin/env bash
set -euo pipefail

LABEL="com.openclaw.state-telegram-review"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORKSPACE="$(cd "$SCRIPT_DIR/.." && pwd)"
RUNNER="$WORKSPACE/scripts/state-telegram-review.js"
NODE_BIN="$(command -v node || true)"
INTERVAL="${STATE_TELEGRAM_REVIEW_INTERVAL:-10}"
TARGET="${STATE_TELEGRAM_TARGET:-}"
THREAD_ID="${STATE_TELEGRAM_THREAD_ID:-}"
PLIST_DIR="$HOME/Library/LaunchAgents"
PLIST_PATH="$PLIST_DIR/$LABEL.plist"
LOG_FILE="$WORKSPACE/memory/state-telegram-review.launchd.log"

mkdir -p "$PLIST_DIR" "$WORKSPACE/memory"

if [ -z "$NODE_BIN" ]; then
  echo "ERROR: node binary not found in PATH." >&2
  exit 1
fi

if [ ! -f "$RUNNER" ]; then
  echo "ERROR: runner script not found at $RUNNER" >&2
  exit 1
fi

EXTRA_ARGS=""
if [ -n "$TARGET" ]; then
  EXTRA_ARGS="$EXTRA_ARGS <string>--target</string><string>$TARGET</string>"
fi
if [ -n "$THREAD_ID" ]; then
  EXTRA_ARGS="$EXTRA_ARGS <string>--thread-id</string><string>$THREAD_ID</string>"
fi

cat > "$PLIST_PATH" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>$NODE_BIN</string>
    <string>$RUNNER</string>
    <string>--root</string>
    <string>$WORKSPACE</string>
    $EXTRA_ARGS
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>StartInterval</key>
  <integer>$INTERVAL</integer>
  <key>WorkingDirectory</key>
  <string>$WORKSPACE</string>
  <key>StandardOutPath</key>
  <string>$LOG_FILE</string>
  <key>StandardErrorPath</key>
  <string>$LOG_FILE</string>
</dict>
</plist>
PLIST

launchctl bootout "gui/$(id -u)" "$PLIST_PATH" >/dev/null 2>&1 || true
launchctl bootstrap "gui/$(id -u)" "$PLIST_PATH"
launchctl kickstart -k "gui/$(id -u)/$LABEL"

echo "Installed launchd job $LABEL (interval=${INTERVAL}s)"
echo "Plist: $PLIST_PATH"
