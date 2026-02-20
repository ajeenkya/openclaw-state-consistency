# OpenClaw State Consistency

Production-oriented state consistency engine for personal/team AI agents.

It provides:
- A canonical single-writer state store (`memory/state-tracker.json`)
- Strict schema-validated ingestion (`StateObservation`, `UserConfirmation`, `SignalEvent`)
- Deterministic conflict resolution and confidence-based commit/ask/tentative decisions
- Deterministic markdown projection into machine-managed zones
- Polling pipeline for calendar/email signals
- Telegram-native one-by-one confirmation loop

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
npm test
```

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

## License

MIT
