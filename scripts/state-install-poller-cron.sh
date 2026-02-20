#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORKSPACE="$(cd "$SCRIPT_DIR/.." && pwd)"
RUNNER="$WORKSPACE/scripts/state-poller-runner.js"
NODE_BIN="$(command -v node || true)"
LOG_DIR="$WORKSPACE/memory"
CRON_LOG="$LOG_DIR/state-poller-cron.log"
CRON_EXPR="${STATE_POLLER_CRON_EXPR:-*/30 * * * *}"
TMP_CRON="$(mktemp)"

mkdir -p "$LOG_DIR"

if [ -z "$NODE_BIN" ]; then
  echo "ERROR: node binary not found in PATH." >&2
  exit 1
fi

if [ ! -f "$RUNNER" ]; then
  echo "ERROR: runner script not found at $RUNNER" >&2
  exit 1
fi

existing="$(crontab -l 2>/dev/null || true)"
cleaned="$(printf "%s\n" "$existing" | sed '/# >>> OPENCLAW_STATE_POLLER >>>/,/# <<< OPENCLAW_STATE_POLLER <<</d')"

{
  printf "%s\n" "$cleaned"
  cat <<CRONBLOCK
# >>> OPENCLAW_STATE_POLLER >>>
# Poll Calendar/Gmail into canonical state, promote review queue, and project managed sections.
$CRON_EXPR cd $WORKSPACE && $NODE_BIN $RUNNER $WORKSPACE >> $CRON_LOG 2>&1
# <<< OPENCLAW_STATE_POLLER <<<
CRONBLOCK
} > "$TMP_CRON"

if ! python3 - "$TMP_CRON" <<'PY'
import subprocess
import sys

path = sys.argv[1]
try:
    subprocess.run(["crontab", path], check=True, timeout=8)
except subprocess.TimeoutExpired:
    print("ERROR: crontab update timed out while installing state poller.", file=sys.stderr)
    sys.exit(124)
except subprocess.CalledProcessError as exc:
    print(f"ERROR: crontab update failed with code {exc.returncode}", file=sys.stderr)
    sys.exit(exc.returncode)
PY
then
  rm -f "$TMP_CRON"
  exit 1
fi

rm -f "$TMP_CRON"

echo "Installed OpenClaw state poller cron block."
crontab -l | sed -n '/# >>> OPENCLAW_STATE_POLLER >>>/,/# <<< OPENCLAW_STATE_POLLER <<</p'
