# OpenClaw State Consistency

Production-oriented state consistency engine for personal/team AI agents.

It provides:
- A canonical single-writer state store (`memory/state-tracker.json`)
- Strict schema-validated ingestion (`StateObservation`, `UserConfirmation`, `SignalEvent`)
- Deterministic conflict resolution and confidence-based commit/ask/tentative decisions
- Deterministic markdown projection into machine-managed zones
- Polling pipeline for calendar/email signals
- Telegram-native one-by-one confirmation loop
- Main-chat bridge plugin for canonical state injection + control-message interception

## Why this exists

Personal AI agents routinely drift from reality when static docs, dynamic signals, and live chat context disagree. This toolkit makes state mutation explicit, validated, auditable, and reversible.

See architecture and rollout details in:
- `docs/state-consistency-solution.md`

## Quick start

```bash
npm install
npm run state:init
npm run state:migrate
npm run state:status
```

## Core commands

```bash
npm run state:poll
npm run state:review-queue
npm run state:pending
npm run state:telegram-review:run
npm run state:project
npm run state:health
npm run state:retry-dlq -- --limit 25
npm run state:plugin:install
npm run lint
npm run schema:check
npm test
```

## Ops safety

- `npm run state:health` returns operational health with:
  - `pending`, `tentative`, `dlq`, `last_poll`, `last_review`
- `npm run state:retry-dlq` retries due DLQ entries and marks each as:
  - `resolved`, `pending_retry`, or `failed_permanent`

## Scheduling

Poller (calendar/email -> canonical state -> projection):
```bash
npm run state:poller:install-cron
```

Telegram review loop (cron):
```bash
npm run state:telegram-review:install-cron
```

Telegram review loop (macOS launchd, lower latency):
```bash
npm run state:telegram-review:install-launchd
```

Main-chat bridge plugin (inject canonical state + intercept `/state-confirm` callbacks):
```bash
npm run state:plugin:install
```

After plugin install, restart the OpenClaw gateway.

## Main-chat integration

The plugin at `plugins/state-consistency-bridge` adds:
- `before_agent_start` canonical state injection into model context
- `/state-confirm` command handling (Yes/No button callbacks bypass normal LLM replies)
- Immediate next-pending prompt handoff with fresh Yes/No buttons

The Telegram review dispatcher now sends button callbacks as:
- `/state-confirm <promptId> yes`
- `/state-confirm <promptId> no`

This prevents the "What do you want me to confirm?" confusion path in main chat.

## Natural-language E2E harness

Manual Telegram test flow:
```bash
npm run state:e2e:guide
npm run state:e2e:prepare -- --target <telegram_user_id>
npm run state:e2e:verify -- --field travel.telegram_e2e --expected "We are in Tahoe now."
```

Status/debug helpers:
```bash
npm run state:e2e:status
```

## Configuration

Environment variables:
- `STATE_ENTITY_ID` (default: `user:primary`)
- `STATE_GOG_ACCOUNT`
- `STATE_POLLER_CRON_EXPR`
- `STATE_REVIEW_MAX_PENDING`
- `STATE_REVIEW_LIMIT`
- `STATE_REVIEW_MIN_CONFIDENCE`
- `STATE_TELEGRAM_TARGET` (required unless provided in `cron-config.json`)
- `STATE_TELEGRAM_THREAD_ID`
- `STATE_TELEGRAM_REVIEW_INTERVAL` (launchd)

## Notes

- The runtime is Node.js-first and uses Ajv for strict JSON Schema validation.
- Failed schema validation is sent to `memory/state-dlq.jsonl` with retry metadata.
- Defaults are intentionally conservative; adaptive autonomy should be enabled only after rollout gates pass.
- CI quality gates run on each PR/push to `main`: lint, schema check, and tests.

## License

MIT
