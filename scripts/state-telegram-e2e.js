#!/usr/bin/env node

"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const {
  ensureStateFiles,
  ingestObservation,
  loadState,
  renderHeartbeatProjection
} = require("./state-consistency");
const { syncReviewOnce } = require("./state-telegram-review");

const DEFAULT_ENTITY_ID = "user:primary";

function nowIso() {
  return new Date().toISOString();
}

function randomUuid() {
  if (crypto.randomUUID) {
    return crypto.randomUUID();
  }
  const hash = crypto.createHash("md5").update(`${Date.now()}-${Math.random()}`).digest("hex");
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-${hash.slice(12, 16)}-${hash.slice(16, 20)}-${hash.slice(20, 32)}`;
}

function parseArgs(argv) {
  const out = { _: [] };
  let key = null;
  for (const token of argv) {
    if (token.startsWith("--")) {
      key = token.slice(2);
      out[key] = true;
      continue;
    }
    if (key) {
      out[key] = token;
      key = null;
      continue;
    }
    out._.push(token);
  }
  return out;
}

function printJson(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function listCommittedFields(state, entityId) {
  const out = [];
  const entities = state?.entities || {};
  const filteredEntityIds = entityId ? [entityId] : Object.keys(entities);
  for (const id of filteredEntityIds) {
    const entityState = entities[id]?.state || {};
    for (const domain of Object.keys(entityState).sort()) {
      const domainState = entityState[domain] || {};
      for (const field of Object.keys(domainState).sort()) {
        out.push({
          entity_id: id,
          domain,
          field,
          value: domainState[field]?.value,
          confidence: domainState[field]?.confidence,
          source: domainState[field]?.source
        });
      }
    }
  }
  return out;
}

function pendingSummary(state, entityId) {
  return Object.values(state?.pending_confirmations || {})
    .filter((item) => !entityId || item.entity_id === entityId)
    .sort((a, b) => String(a.created_at || "").localeCompare(String(b.created_at || "")))
    .map((item) => ({
      prompt_id: item.prompt_id,
      entity_id: item.entity_id,
      domain: item.domain,
      field: item.observation_event?.field || "",
      candidate_value: item.observation_event?.candidate_value
    }));
}

function readReviewState(rootDir) {
  const filePath = path.join(rootDir, "memory", "state-telegram-review-state.json");
  if (!fs.existsSync(filePath)) {
    return {};
  }
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (_err) {
    return {};
  }
}

function getFieldRecord(state, entityId, fieldPath) {
  const dot = String(fieldPath || "").indexOf(".");
  if (dot <= 0) {
    return null;
  }
  const domain = fieldPath.slice(0, dot);
  const field = fieldPath.slice(dot + 1);
  return state?.entities?.[entityId]?.state?.[domain]?.[field] || null;
}

function usage() {
  process.stdout.write([
    "Usage: node scripts/state-telegram-e2e.js <command> [options]",
    "",
    "Commands:",
    "  guide",
    "  prepare   Seed one review-band observation and dispatch prompt to Telegram",
    "  status    Show pending/active runtime status",
    "  verify    Verify committed state field after Yes/No decision",
    "",
    "Common options:",
    "  --root <path>         Workspace root (default: cwd)",
    `  --entity-id <id>      Entity id (default: ${DEFAULT_ENTITY_ID})`,
    "",
    "prepare options:",
    "  --field <domain.field>   (default: travel.telegram_e2e)",
    "  --text <text>            (default: We are in Tahoe now.)",
    "  --target <telegram-id>   (optional; if set, dispatches question immediately)",
    "  --thread-id <id>         (optional)",
    "",
    "verify options:",
    "  --field <domain.field>   (required)",
    "  --expected <value>       (optional exact string match)"
  ].join("\n") + "\n");
}

function runGuide() {
  process.stdout.write([
    "Natural-language Telegram E2E flow:",
    "1. Run: npm run state:e2e:prepare -- --target <telegram_user_id>",
    "2. In Telegram, wait for: \"I detected a possible ... update...\" with Yes/No buttons.",
    "3. Tap Yes (or No).",
    "4. Run: npm run state:e2e:verify -- --field travel.telegram_e2e --expected \"We are in Tahoe now.\"",
    "5. Optional: npm run state:e2e:status",
    "",
    "Expected result:",
    "- The callback is handled by /state-confirm (no confused \"what should I confirm\" reply).",
    "- Canonical state in memory/state-tracker.json is updated.",
    "- Next pending check (if any) appears immediately with Yes/No."
  ].join("\n") + "\n");
}

function runPrepare(rootDir, args) {
  const entityId = args["entity-id"] || process.env.STATE_ENTITY_ID || DEFAULT_ENTITY_ID;
  const field = args.field || "travel.telegram_e2e";
  const domain = String(field).includes(".") ? String(field).slice(0, String(field).indexOf(".")) : "travel";
  const text = args.text || "We are in Tahoe now.";
  const target = args.target || process.env.STATE_TELEGRAM_TARGET || "";
  const threadId = args["thread-id"] || process.env.STATE_TELEGRAM_THREAD_ID || "";

  ensureStateFiles(rootDir);

  const observation = {
    event_id: randomUuid(),
    event_ts: nowIso(),
    domain,
    entity_id: entityId,
    field,
    candidate_value: text,
    intent: "assertive",
    source: {
      // Deliberately review-band reliability so we always get a confirmation prompt.
      type: "conversation_planning",
      ref: `e2e:prepare:${Date.now()}`
    },
    corroborators: []
  };

  const ingested = ingestObservation(rootDir, observation, { forceCommit: false });
  renderHeartbeatProjection(rootDir, { entity_id: entityId });

  let dispatchResult = null;
  if (target) {
    try {
      dispatchResult = syncReviewOnce(rootDir, {
        target,
        entity_id: entityId,
        thread_id: threadId,
        dry_run: false
      });
    } catch (error) {
      dispatchResult = {
        status: "error",
        message: error.message
      };
    }
  }

  const state = loadState(rootDir);
  printJson({
    status: "ok",
    command: "prepare",
    ingested_status: ingested.status,
    field,
    text,
    pending_count: Object.keys(state.pending_confirmations || {}).length,
    dispatched: dispatchResult,
    next_action: target
      ? "Tap Yes/No in Telegram, then run verify."
      : "Run again with --target to dispatch to Telegram, or rely on your scheduled review loop."
  });
  return 0;
}

function runStatus(rootDir, args) {
  const entityId = args["entity-id"] || process.env.STATE_ENTITY_ID || DEFAULT_ENTITY_ID;
  ensureStateFiles(rootDir);
  const state = loadState(rootDir);
  const reviewState = readReviewState(rootDir);

  printJson({
    status: "ok",
    command: "status",
    entity_id: entityId,
    pending_count: pendingSummary(state, entityId).length,
    pending: pendingSummary(state, entityId),
    active_prompt_id: reviewState.active_prompt_id || null,
    committed_fields: listCommittedFields(state, entityId).length
  });
  return 0;
}

function runVerify(rootDir, args) {
  const entityId = args["entity-id"] || process.env.STATE_ENTITY_ID || DEFAULT_ENTITY_ID;
  const field = args.field || "";
  if (!field) {
    printJson({ status: "error", message: "--field is required for verify" });
    return 2;
  }
  const expected = args.expected;

  ensureStateFiles(rootDir);
  const state = loadState(rootDir);
  const record = getFieldRecord(state, entityId, field);
  const pending = pendingSummary(state, entityId);

  const out = {
    status: "ok",
    command: "verify",
    entity_id: entityId,
    field,
    committed: Boolean(record),
    value: record?.value,
    source: record?.source || null,
    confidence: record?.confidence ?? null,
    pending_count: pending.length,
    pass: false
  };

  if (!record) {
    out.reason = "field_not_committed";
    printJson(out);
    return 1;
  }

  if (expected !== undefined && String(record.value) !== String(expected)) {
    out.reason = "value_mismatch";
    out.expected = expected;
    printJson(out);
    return 1;
  }

  out.pass = true;
  out.reason = "verified";
  printJson(out);
  return 0;
}

function main(argv) {
  const args = parseArgs(argv);
  const cmd = args._[0] || "guide";
  const rootDir = path.resolve(args.root || process.cwd());

  if (args.help || cmd === "help") {
    usage();
    return 0;
  }
  if (cmd === "guide") {
    runGuide();
    return 0;
  }
  if (cmd === "prepare") {
    return runPrepare(rootDir, args);
  }
  if (cmd === "status") {
    return runStatus(rootDir, args);
  }
  if (cmd === "verify") {
    return runVerify(rootDir, args);
  }

  usage();
  return 1;
}

if (require.main === module) {
  process.exitCode = main(process.argv.slice(2));
}

module.exports = {
  main
};
