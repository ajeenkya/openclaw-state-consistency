# OpenClaw State Consistency Engine

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/Node.js-20%2B-green)](https://nodejs.org)

A canonical state store for OpenClaw agents. Validates incoming observations, resolves conflicts between sources (calendar vs. files vs. conversation), asks the user when confidence is low, and keeps an audit trail of every change.

**Status:** experimental. Built Feb 2026 while OpenClaw was the daily-driver agent stack. The patterns (confidence-based ingestion, single-writer canonical store, schema-validated observations) generalized to later projects; this repo stays public as the reference implementation.

## The problem

Agent memory files drift. Calendar says one thing, README says another, the user said a third in chat. The agent picks one and confidently reports it. Sometimes wrong. The original anchor was a real bug: my own OpenClaw agent wrote `Current conversation started: 2026-02-24` into memory on 2026-02-19, then reasoned forward from "Day 5 of the plan" when we were actually on Day 1.

## What it does

Every observation goes through a pipeline:

1. **Validate** against a JSON schema (well-formed entity, known source, valid value).
2. **Score** confidence based on source type (assertive conversation, calendar poll, user confirmation, etc.).
3. **Route** by domain threshold: auto-store if high, ask the user if medium, drop if low.
4. **Resolve** conflicts when two sources disagree, using deterministic rules + recency.
5. **Log** every change so you can debug when memory goes wrong.

## Quick start

```bash
git clone https://github.com/ajeenkya/openclaw-state-consistency.git
cd openclaw-state-consistency
npm install
npm run state:init
npm run state:migrate   # import existing OpenClaw memory if any
npm run state:status
```

## Confidence routing

Different source types get different treatment:

```javascript
"We are in Tahoe now"        // assertive       → confidence 0.9 → auto-store
"We might go to Tahoe"       // planning        → confidence 0.7 → confirm first
"Tahoe could be nice"        // hypothetical    → confidence 0.4 → drop
```

Per-domain thresholds tune the bar (financial info gets stricter than casual chat):

```json
{
  "travel":    { "auto_threshold": 0.85 },
  "family":    { "auto_threshold": 0.85 },
  "project":   { "auto_threshold": 0.90 },
  "financial": { "auto_threshold": 0.95 }
}
```

## Integration

The OpenClaw plugin (`npm run state:plugin:install`) hooks into the gateway and handles ingestion + confirmation automatically. For manual integration:

```bash
echo '{"entity_id":"user:test","state_key":"travel.location","state_value":"Tahoe","source_type":"conversation_assertive"}' \
  | node scripts/state-consistency.js ingest
```

Configuration env vars: `STATE_ENTITY_ID`, `STATE_TELEGRAM_TARGET`, `STATE_GOG_ACCOUNT`. See `docs/` for the rest.

## Architecture

Borrows from distributed systems:

- **Single writer.** Only the canonical store mutates memory.
- **Event sourcing.** Every change is appended to the log.
- **Schema validation.** Invalid observations go to a dead-letter queue instead of corrupting state.
- **Deterministic conflict resolution.** Same inputs always produce the same merge result.

## Tech

Node.js 20+, JSON schemas, file-based state store under `memory/`. Optional Telegram bot for medium-confidence confirmations. No external database.

## Docs

- [`docs/installation.md`](docs/installation.md): detailed setup
- [`docs/api.md`](docs/api.md): function reference
- [`docs/architecture.md`](docs/architecture.md): how it works under the hood

## License

MIT.

---

Built by [Ajeenkya Bhatalkar](https://ajeenkya.github.io).
