#!/usr/bin/env bash
set -euo pipefail

TMP_CRON="$(mktemp)"
existing="$(crontab -l 2>/dev/null || true)"

printf "%s\n" "$existing" | sed '/# >>> OPENCLAW_STATE_TELEGRAM_REVIEW >>>/,/# <<< OPENCLAW_STATE_TELEGRAM_REVIEW <<</d' > "$TMP_CRON"

if ! python3 - "$TMP_CRON" <<'PY'
import subprocess
import sys

path = sys.argv[1]
try:
    subprocess.run(["crontab", path], check=True, timeout=8)
except subprocess.TimeoutExpired:
    print("ERROR: crontab update timed out while uninstalling telegram review cron.", file=sys.stderr)
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
echo "Removed OpenClaw state telegram review cron block."
